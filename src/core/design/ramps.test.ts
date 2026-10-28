import { describe, it, expect } from "vitest";
import { ALL_RAMPS } from "./ramps";
import { rampIsMonotone, contrastRatio, toHex, mixColors } from "./oklch";
import { LightScheme, DarkScheme, CONTRAST_PAIRS, type TokenValue } from "./scheme";
import type { Rgb } from "./oklch";
import golden from "./tokens.golden.json";

/**
 * 앱의 팔레트 시험이 지키던 성질 + **앱이 실제로 내는 값과의 대조**.
 *
 * 기준값 `tokens.golden.json` 은 `tools/tone-dump/ToneDump.java` 가 낸 것이다
 * (Oklch.kt 를 Java 로 전사 — Kotlin Float = Java float, kotlin.math = java.lang.Math).
 * 전사가 맞다는 근거는 `Color.kt` 가 못 박아 둔 `Clay.tone(76) = #DAB673` 을 그 덤프가
 * **정확히 재현**한다는 것이다.
 *
 * W1 에서는 이 대조가 ±1 을 허용했는데, 이제 **정확히 같아야 한다.**
 * 어긋나던 이유가 Float/double 차이가 아니라 반올림 규칙을 잘못 옮긴 것이었기 때문이다
 * (`oklch.ts` 의 `toHex` 주석, `docs/design-token-reconciliation.md`).
 */
describe("Kotlin 덤프와 정확 대조 (9램프 × 톤 101)", () => {
  const ramps = golden.ramps as Record<string, string[]>;

  it("덤프가 Color.kt 의 문서화된 앵커를 재현한다", () => {
    // 이 하나가 전사(轉寫)의 신뢰 근거다. 여기가 깨지면 덤프부터 의심해야 한다.
    expect(golden.anchors["Clay.tone(76)"]).toBe("#DAB673");
  });

  for (const [name, ramp] of Object.entries(ALL_RAMPS)) {
    it(`${name} — 톤 0..100 전부 일치`, () => {
      const want = ramps[name];
      expect(want, `덤프에 ${name} 이 없다`).toBeDefined();
      const mismatches: string[] = [];
      for (let t = 0; t <= 100; t++) {
        const got = ramp.hex(t);
        if (got !== want![t]) mismatches.push(`tone ${t}: ${got} ≠ ${want![t]}`);
      }
      expect(mismatches).toEqual([]);
    });
  }
});

describe("Clay 앵커 — Color.kt 주석의 두 값", () => {
  const clay = (golden.ramps as Record<string, string[]>)["Clay"]!;

  it("톤 76 = 데스크톱 보드의 나무색 #DAB673 — 주석과 일치", () => {
    expect(clay[76]).toBe("#DAB673");
  });

  it("톤 42 = #7E5D14 — 주석의 #7B5E22 는 틀렸다", () => {
    // Kotlin 이 실제로 내는 값이 #7E5D14 다(위 덤프). 주석은 낡았다.
    // 판정 근거와 처리는 docs/design-token-reconciliation.md 에 적었고,
    // Zenyth 쪽 주석도 고쳤다.
    expect(clay[42]).toBe("#7E5D14");
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
    expect(mid).toBe("#BCBCBC"); // 선형 0.5 → sRGB 0.7354 → 187.5 → 반올림 188
  });
});
