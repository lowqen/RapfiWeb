/**
 * `core/designsystem/theme/Oklch.kt` 의 이식본.
 *
 * 팔레트는 **고른 것이 아니라 유도된 것**이다. 색상(hue)과 채도(chroma) 두 숫자와
 * 톤 하나에서 한 가족이 통째로 나온다. 그래서 앱을 다시 칠하려면 hue 를 한 번
 * 고치면 되고, 여기 하드코딩된 hex 는 없다.
 *
 * 톤은 **Material 번호 = CIE L\*** 다. 0 이 검정, 100 이 흰색, 50 이 사람이 절반으로
 * 보는 회색. Oklab 자신의 L 과는 다른 곡선이라 가정하지 않고 변환한다 —
 * 중성색에서 Oklab L 은 상대 휘도의 세제곱근이라는 항등식 하나에 기댄다.
 *
 * **Kotlin 은 Float(32비트)로 계산하고 여기는 double 이다.** 그런데 출력이 8비트라
 * 그 차이는 «정수 경계의 0.5/255 안쪽»에서만 드러날 수 있고, 아홉 램프 × 톤 101개
 * 전부에서 실제로 드러나지 않는다 — `ramps.test.ts` 가 Kotlin 덤프와 **정확히**
 * 대조한다. 대신 반올림 규칙은 Compose 를 따라야 한다(`toHex` 주석 참고).
 */

/** 0..1 의 sRGB 세 채널. 알파는 따로 다룬다(보드 스킨의 그림자만 알파를 쓴다). */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function srgbToLinear(c: number): number {
  const v = clamp01(c);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const v = clamp01(c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** 상대 휘도(WCAG): 선형 sRGB 의 Y. */
export function luminanceOf(c: Rgb): number {
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
}

/** WCAG 대비비, 1..21. 테마 자신의 시험이 모든 글자/배경 쌍을 4.5:1 위로 지킨다. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Material 톤(CIE L\*) → Oklab 명도.
 *
 * L\* 는 상대 휘도 Y 로 정의되고, 중성색에서 Oklab 의 L 은 그 Y 의 세제곱근이다
 * (세 원뿔 응답이 같고 가중치 합이 1이므로). 근사가 아니라 항등식이라 피팅으로
 * 대체하면 안 된다.
 */
export function lightnessForTone(tone: number): number {
  const lStar = tone;
  const y = lStar > 8 ? Math.pow((lStar + 16) / 116, 3) : lStar / 903.2963;
  return Math.cbrt(y);
}

function oklabToLinear(l: number, a: number, b: number): [number, number, number] {
  const lp = l + 0.3963377774 * a + 0.2158037573 * b;
  const mp = l - 0.1055613458 * a - 0.0638541728 * b;
  const sp = l - 0.0894841775 * a - 1.291485548 * b;
  const ll = lp * lp * lp;
  const mm = mp * mp * mp;
  const ss = sp * sp * sp;
  return [
    4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss,
    -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss,
    -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss,
  ];
}

const inGamut = (rgb: [number, number, number]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

const linearToColor = (rgb: [number, number, number]): Rgb => ({
  r: linearToSrgb(rgb[0]),
  g: linearToSrgb(rgb[1]),
  b: linearToSrgb(rgb[2]),
});

/**
 * Oklch → sRGB, **채도로 감마맵**한다. 이 명도에서 요청한 채도를 낼 수 없을 때
 * 채널별로 자르지 않는다(그러면 색상이 틀어지고 램프의 양끝이 납작해진다).
 * 채도를 줄여 맞추므로 색상과 명도는 정확히 지켜지고, 애초에 이 화면에 없던
 * 채도만 포기한다.
 */
export function oklch(lightness: number, chroma: number, hueDegrees: number): Rgb {
  const l = clamp01(lightness);
  if (chroma <= 0) return linearToColor(oklabToLinear(l, 0, 0));
  const rad = (hueDegrees * Math.PI) / 180;
  const ca = Math.cos(rad);
  const cb = Math.sin(rad);
  let lo = 0;
  let hi = chroma;
  if (inGamut(oklabToLinear(l, ca * hi, cb * hi))) {
    return linearToColor(oklabToLinear(l, ca * hi, cb * hi));
  }
  for (let i = 0; i < 18; i++) {
    // 채도 1e-5 수준: 8비트 출력보다 곱다
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinear(l, ca * mid, cb * mid))) lo = mid;
    else hi = mid;
  }
  return linearToColor(oklabToLinear(l, ca * lo, cb * lo));
}

/** 두 색을 **선형광에서** 섞는다 — 정직한 혼합(`TagPalette` 와 같은 규칙). */
export function mixColors(from: Rgb, to: Rgb, fraction: number): Rgb {
  const f = clamp01(fraction);
  const mix = (a: number, b: number) => {
    const la = srgbToLinear(a);
    return linearToSrgb(la + (srgbToLinear(b) - la) * f);
  };
  return { r: mix(from.r, to.r), g: mix(from.g, to.g), b: mix(from.b, to.b) };
}

/**
 * 하나의 색 가족: 한 색상의 모든 그늘, Material 톤으로 부른다.
 *
 * `chroma` 는 약속이 아니라 **천장**이다 — 검정과 흰색 근처에서는 sRGB 색역에
 * 자리가 없으므로, 요청한 채도를 달라고 하고 색역 안에서 살아남는 만큼만 지킨다.
 */
export class TonalRamp {
  private readonly cache = new Map<number, Rgb>();

  constructor(
    readonly hue: number,
    readonly chroma: number,
  ) {}

  /** Material 톤 `tone` 의 그늘 (0 = 검정 … 100 = 흰색). */
  tone(tone: number): Rgb {
    const t = Math.min(100, Math.max(0, Math.round(tone)));
    const hit = this.cache.get(t);
    if (hit) return hit;
    const c = oklch(lightnessForTone(t), this.chroma, this.hue);
    this.cache.set(t, c);
    return c;
  }

  /** 톤의 `#RRGGBB`. */
  hex(tone: number): string {
    return toHex(this.tone(tone));
  }
}

export const ramp = (hue: number, chroma: number) => new TonalRamp(hue, chroma);

/**
 * `#RRGGBB` — **반올림이다.**
 *
 * 처음에는 Kotlin `toHex()` 안의 `(v * 255f).toInt()` 만 보고 버림으로 옮겼는데,
 * 그 시점에 값은 **이미 8비트**다. Compose 의 `Color(red, green, blue)` 가 sRGB
 * 색공간에서 채널을
 *
 *     ((red * 255.0f + 0.5f).toInt() shl 16) or …
 *
 * 로 패킹하기 때문이다. 실효 반올림은 거기서 일어나고, `toHex` 의 버림은 이미
 * k/255 인 값을 다시 자르는 것이라 아무 일도 하지 않는다.
 *
 * 이 한 줄 때문에 W1 의 골든 앵커가 `#DAB572` 로 나왔다(정답 `#DAB673`).
 * 181.83 과 114.87 이 둘 다 «정수 바로 아래»여서 Float/double 차이처럼 보였지만
 * 아니었다 — 반올림 규칙을 잘못 옮긴 것이다.
 * 자세히: `docs/design-token-reconciliation.md`
 */
export function toHex(c: Rgb): string {
  const ch = (v: number) =>
    Math.min(255, Math.max(0, Math.floor(v * 255 + 0.5)))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`.toUpperCase();
}

/** `#RRGGBBAA` — 알파가 있는 것은 보드 그림자·후광뿐이다. */
export function toHexAlpha(c: Rgb, alpha: number): string {
  const a = Math.min(255, Math.max(0, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, "0");
  return `${toHex(c)}${a}`.toUpperCase();
}

/** 위 수식이 편집되다가 램프가 조용히 납작해지는 것을 막는 보호대. */
export function rampIsMonotone(r: TonalRamp): boolean {
  const tones: number[] = [];
  for (let t = 0; t <= 100; t += 5) tones.push(luminanceOf(r.tone(t)));
  for (let i = 1; i < tones.length; i++) {
    const prev = tones[i - 1]!;
    const cur = tones[i]!;
    if (!(cur > prev - 1e-6)) return false;
  }
  return Math.abs(luminanceOf(r.tone(100)) - 1) < 0.02;
}
