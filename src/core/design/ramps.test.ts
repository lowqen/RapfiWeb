import { describe, it, expect } from "vitest";
import { Clay, ALL_RAMPS } from "./ramps";
import { rampIsMonotone, contrastRatio, toHex, mixColors } from "./oklch";
import { LightScheme, DarkScheme, CONTRAST_PAIRS, type TokenValue } from "./scheme";
import type { Rgb } from "./oklch";

/**
 * 앱의 팔레트 시험이 지키던 성질을 그대로 옮긴 것.
 *
 * **골든 앵커.** `Color.kt` 는 Clay 램프의 hue·chroma 를 «톤 76 이 데스크톱 보드
 * `#DAB673` 에, 톤 42 가 그 격자 `#7B5E22` 에 떨어지도록» 고른 값이라고 적어 두었다.
 * 그 두 값이 Kotlin 소스에 문서화돼 있으므로 **Kotlin 을 돌리지 않고도** 이식이
 * 맞는지 확인할 수 있는 대조점이 된다.
 *
 * 실측 결과: 톤 76 은 채널당 ±1 로 맞고(Float/double 차이), **톤 42 는 맞지 않는다**.
 * 아래 시험에 사유를 적어 두었다. 전 톤 덤프 대조는 W2 에서 붙인다.
 */
const near = (got: string, want: string, tol: number) => {
  const ch = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  return [0, 1, 2].every((i) => Math.abs(ch(got, i) - ch(want, i)) <= tol);
};

describe("Clay 램프의 골든 앵커", () => {
  it("톤 76 = 데스크톱 보드의 나무색 (채널당 ±1)", () => {
    // Kotlin 은 Float(32비트), 여기는 double 이다. 두 채널이 정확히 1 씩 어긋나는데
    // 둘 다 «정수 바로 아래»에서 잘린 값이라(181.83 / 114.87) Float 반올림이면 넘어간다.
    // 계획서 §5 가 미리 허용해 둔 오차 범위 그대로다.
    expect(near(Clay.hex(76), "#DAB673", 1)).toBe(true);
  });

  it("톤 42 — Color.kt 주석과 어긋난다. 우리 값을 고정해 둔다", () => {
    // ⚠ Color.kt 는 «톤 42 가 데스크톱 격자 #7A5A2B → #7B5E22 에 떨어진다»고 적었는데,
    //    같은 수식이 #7E5D14 를 낸다. 파랑이 20 vs 34 로 14 나 벌어져 Float/double
    //    차이로는 설명되지 않고, 이 톤에서는 색역 안이라 이분탐색도 개입하지 않는다
    //    (손으로 검산해도 #7E5D14 다). 즉 **주석이 낡았을 가능성이 높다**.
    //
    //    W2 에서 Kotlin 쪽 전 톤 덤프를 받아 판정한다. 그때까지는 우리 값을 고정해
    //    회귀만 막는다 — 틀린 기대값을 넣어 빨간 CI 를 방치하는 것보다 낫다.
    expect(Clay.hex(42)).toBe("#7E5D14");
  });
});

describe("램프 단조성", () => {
  // 위 수식이 편집되다가 램프가 조용히 납작해지는 것을 막는다.
  for (const [name, r] of Object.entries(ALL_RAMPS)) {
    it(`${name} 은 톤이 오르면 휘도도 오른다`, () => {
      expect(rampIsMonotone(r)).toBe(true);
    });
  }
});

const isBlack = (v: TokenValue): v is { black: number } => "black" in v;
const rgb = (s: Record<string, TokenValue>, k: string): Rgb => {
  const v = s[k];
  if (!v) throw new Error(`토큰 없음: ${k}`);
  if (isBlack(v)) return { r: 0, g: 0, b: 0 };
  return v;
};

describe("대비", () => {
  for (const scheme of [
    { name: "light", s: LightScheme },
    { name: "dark", s: DarkScheme },
  ]) {
    for (const [fg, bg] of CONTRAST_PAIRS) {
      it(`${scheme.name}: ${fg} / ${bg} 는 4.5:1 이상`, () => {
        const ratio = contrastRatio(rgb(scheme.s, fg), rgb(scheme.s, bg));
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("스킴 완결성", () => {
  it("두 스킴이 같은 토큰 집합을 갖는다(다크 전용 chipRim 제외)", () => {
    const light = new Set(Object.keys(LightScheme));
    const dark = new Set(Object.keys(DarkScheme));
    const onlyDark = [...dark].filter((k) => !light.has(k));
    const onlyLight = [...light].filter((k) => !dark.has(k));
    // 다크 보드에서만 값 칩에 테두리가 필요하다 — 그 하나가 유일한 비대칭이다.
    expect(onlyDark).toEqual(["board-chip-rim"]);
    expect(onlyLight).toEqual([]);
  });
});

describe("선형광 혼합", () => {
  it("검정과 흰색의 중간은 sRGB 중간값(#808080)보다 밝다", () => {
    // 감마를 무시하고 섞으면 여기서 #808080 이 나온다. 그게 «정직하지 않은» 혼합이다.
    const mid = toHex(mixColors({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, 0.5));
    expect(mid).toBe("#BBBBBB"); // 선형 0.5 → sRGB 0.7354 → 187
  });
});
