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
 * 맞는지 확인할 수 있는 진짜 대조점이다.
 * (전 톤 덤프 대조는 W2 에서 Kotlin 쪽 덤프를 받아 붙인다.)
 */
describe("Clay 램프의 골든 앵커", () => {
  it("톤 76 = 데스크톱 보드의 나무색", () => {
    expect(Clay.hex(76)).toBe("#DAB673");
  });

  it("톤 42 = 데스크톱 보드의 격자색", () => {
    expect(Clay.hex(42)).toBe("#7B5E22");
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
