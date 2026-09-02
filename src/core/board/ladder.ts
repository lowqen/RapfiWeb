import {
  mixColors,
  srgbToLinear,
  linearToSrgb,
  toHex,
  contrastRatio,
  type Rgb,
} from "../design/oklch";

/**
 * 보드 위 값 라벨의 색 규칙 — `TagPalette` / `LadderStops` 의 이식본.
 *
 * **데스크톱의 양극은 그대로, 데스크톱의 무지개는 버리고.** `winrate2colorstr`
 * (main.c:1195)는 `hue = (100 - winrate) * 1.8` 로 HSV 를 훑는다: 이기면 빨강,
 * 지면 청록, 그 사이는 초록을 지나는 색상 스윕이다. 두 극은 Yixin 사용자가 외운
 * 것이라 정확히 지킨다 — 따뜻하면 이기는 수, 차가우면 지는 수. 스윕은 지키지
 * 않는다: 색상 램프는 순서를 나르지 못하고(무지개의 가장 밝은 곳은 *가운데*다),
 * 그래서 50%(=«모르겠다»)가 보드에서 가장 시끄러운 것이 돼 버렸다.
 *
 * 대신 **명도가 순위를 지고 색상이 어느 편인지만 말한다.** 사다리는 깊은 페트롤
 * 블루(짐) → 슬레이트(막상막하) → 선명한 버밀리언(이김)으로 가면서 꾸준히 밝아진다.
 * 그래서 흑백으로 인쇄해도 순서가 살아남고, 두 극은 Oklch 에서 거의 보색이다.
 *
 * 칩은 어둡고 글자는 희다. 화면당 칩이 백 개인 상황에서 옅은 채움은 금색 나무와
 * 같은 명도에 앉아, 후보 대부분이 모이는 «막상막하» 구간이 가장 안 읽히게 된다.
 */

/** 사다리의 다섯 앵커, 어두운(짐) 쪽부터. */
export const LADDER_STOPS: readonly string[] = [
  "#04315C", // 0%   깊은 페트롤 블루 — 가장 어둡고, 그래서 가장 나쁨
  "#104E5A", // 25%  짙은 청록 — 데스크톱의 지는 청록을 깊게
  "#515863", // 50%  슬레이트 — «아직 모름» 에 가장 조용한 색
  "#AB451C", // 75%  녹슨 주황 — 분명히 좋음
  "#DA2533", // 100% 버밀리언 — 데스크톱의 이기는 빨강, 반대편 블루의 거의 보색
];

const hexToRgb = (hex: string): Rgb => ({
  r: parseInt(hex.slice(1, 3), 16) / 255,
  g: parseInt(hex.slice(3, 5), 16) / 255,
  b: parseInt(hex.slice(5, 7), 16) / 255,
});

const STOPS_RGB = LADDER_STOPS.map(hexToRgb);

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 0..1 위치의 사다리 색. **선형 sRGB 에서** 섞는다.
 *
 * 감마를 제거하고 섞는 것이 혼합의 중간이 탁해지지 않게 하는 방법이고, 이 설계가
 * 기대는 두 번째 성질이 따라온다: 휘도는 선형 성분의 선형 함수이므로 두 앵커의
 * 혼합은 항상 두 휘도 **사이**에 떨어진다. 앵커가 단조면 사다리 전체가 단조다.
 */
export function ladderColor(position: number): Rgb {
  const t = clamp(position, 0, 1) * (STOPS_RGB.length - 1);
  const i = clamp(Math.floor(t), 0, STOPS_RGB.length - 2);
  return mixColors(STOPS_RGB[i]!, STOPS_RGB[i + 1]!, t - i);
}

export const ladderHex = (position: number): string => toHex(ladderColor(position));

/** 칩 하나의 채움과 글자. 셋이 아니라 둘이다 — 링은 다크 보드에서만 붙는다. */
export interface TagColors {
  fill: string;
  ink: string;
  bold: boolean;
}

/**
 * 데스크톱의 다섯 색 설정(settings.txt 39–43행)은 raw HSV 채도가 아니라
 * **사다리 위의 위치**로 살아남는다. 그래서 PC `settings.txt` 를 불러와도
 * 그 사용자가 맞춰 둔 순서가 유지된다.
 */
export interface TagPalette {
  losingSaturation: number;
  winningSaturation: number;
  minRateSaturation: number;
  maxRateSaturation: number;
  value: number;
}

export const DEFAULT_PALETTE: TagPalette = {
  losingSaturation: 0,
  winningSaturation: 83,
  minRateSaturation: 20,
  maxRateSaturation: 80,
  value: 100,
};

const pct = (v: number) => clamp(Math.round(v), 0, 100) / 100;

const rateFloor = (p: TagPalette) => Math.min(pct(p.minRateSaturation), pct(p.maxRateSaturation));
const rateReach = (p: TagPalette) => Math.max(pct(p.minRateSaturation), pct(p.maxRateSaturation));

/**
 * 램프의 가파르기. 예전에는 «막상막하가 아니게 되는 순간» 더해지는 바닥값이었고,
 * 그래서 50%와 51% 사이에 눈에 보이는 이음매가 생겼다. 지수로 바꾸면 같은 일
 * (붐비는 가운데를 벌리는 것)을 연속적으로 한다.
 */
function rateGamma(p: TagPalette): number {
  const reach = rateReach(p);
  if (reach <= 0) return 1;
  return clamp(1 - 2 * (rateFloor(p) / reach), 0.15, 1);
}

/**
 * 승률의 사다리 위치.
 *
 * 비교할 만한 후보는 거의 전부 50% 근처 몇 점 안에 앉으므로, 승률에 선형인 램프는
 * 색의 대부분을 아무도 읽지 않는 구간에 쓴다. 지수가 그것을 굽힌다: 50%에서
 * 처음 벗어나는 몇 점이 가장 크게 움직이고, 90→100% 구간(이미 답이 정해진 곳)이
 * 압축된다.
 */
export function ratePosition(p: TagPalette, percent: number): number {
  const offset = clamp(Math.round(percent), 0, 100) / 100 - 0.5;
  if (offset === 0) return 0.5;
  const reach = rateReach(p) * Math.pow(Math.abs(offset) * 2, rateGamma(p));
  return clamp(0.5 + Math.sign(offset) * (reach / 2), 0, 1);
}

/**
 * 증명된 승리의 자리. `winningSaturation` 이 그것을 깊게 하지만, 퍼센트가 쓰는
 * 범위 *안쪽*으로는 절대 들어오지 못한다 — 사실이 숫자보다 약해 보이면 안 된다.
 */
export const winPosition = (p: TagPalette): number =>
  0.5 + Math.max(pct(p.winningSaturation), rateReach(p)) / 2;

export const losePosition = (p: TagPalette): number =>
  0.5 - Math.max(pct(p.losingSaturation), rateReach(p)) / 2;

/** `colorValue`(43행)가 사다리 전체를 어둡게 한다 — PC 와 똑같이. */
function dim(p: TagPalette, c: Rgb): Rgb {
  const factor = clamp(p.value / 100, 0.4, 1);
  if (factor >= 1) return c;
  // 인코딩된 숫자가 아니라 **빛**을 곱한다 — 색을 어둡게 하는 정직한 방법.
  const ch = (v: number) => linearToSrgb(srgbToLinear(v) * factor);
  return { r: ch(c.r), g: ch(c.g), b: ch(c.b) };
}

const WHITE: Rgb = { r: 1, g: 1, b: 1 };

export function chip(p: TagPalette, position: number, bold = false): TagColors {
  return { fill: toHex(dim(p, ladderColor(position))), ink: "#FFFFFF", bold };
}

/** 무승부는 반쪽 승리가 아니다 — 슬레이트와 같은 순위에서 옆으로 비켜선 초록. */
export const DRAW_FILL = "#2E623B";
/** 보드 텍스트는 값이 아니라 메모다 — 사다리 밖의 양피지와 잉크. */
export const NOTE_COLORS: TagColors = { fill: "#F2E7D3", ink: "#57452C", bold: false };

export type TagKind = "win" | "lose" | "rate";

export function colorsForTag(p: TagPalette, kind: TagKind, winRatePct?: number): TagColors {
  switch (kind) {
    case "win":
      return chip(p, winPosition(p), true);
    case "lose":
      return chip(p, losePosition(p), true);
    case "rate":
      return chip(p, ratePosition(p, winRatePct ?? 50));
  }
}

/** 흰 글씨가 이 칩 위에서 4.5:1 을 넘는가. 시험이 사다리 전 구간에서 확인한다. */
export const inkContrast = (fillHex: string): number => contrastRatio(WHITE, hexToRgb(fillHex));
