/*
 * Oklch.kt / Color.kt 의 **값을 확정하기 위한** 덤프.
 *
 * 왜 Java 인가: 이 기계에도 CI 러너에도 Kotlin 컴파일러가 없지만 JDK 는 있다.
 * 그리고 문제되는 코드는 Kotlin 고유 기능을 쓰지 않는다 —
 *
 *   - Kotlin 의 Float 는 IEEE binary32 = Java 의 float 다.
 *   - kotlin.math 의 cos/sin/cbrt/pow 는 java.lang.Math 로 그대로 위임한다.
 *     특히 Float.pow(Float) 는 Math.pow(this.toDouble(), x.toDouble()).toFloat() 이라,
 *     2.4f 가 지수로 쓰일 때 실제 지수는 2.4 가 아니라 2.4000000953674316 이다.
 *     이 파일은 그 성질까지 그대로 옮긴다.
 *   - Compose 의 Color(Float,Float,Float) 는 sRGB 색공간에서 채널을 **8비트로 패킹**하며
 *     (v * 255f + 0.5f).toInt() — 즉 **반올림**이다. 이것이 이 덤프의 핵심이다(아래).
 *
 * 그래서 이 파일의 출력은 Kotlin 이 내는 값과 같다고 볼 근거가 있다. 그 근거를
 * 검증할 자리가 하나 있는데, Color.kt 가 「톤 76 = #DAB673」이라고 못 박아 둔 것이다.
 * 이 프로그램이 그 값을 재현하면 전사(轉寫)가 맞다고 볼 수 있다.
 *
 *   java tools/tone-dump/ToneDump.java > src/core/design/tokens.golden.json
 */
import java.util.LinkedHashMap;
import java.util.Map;

public final class ToneDump {

    // ── Oklch.kt 전사 ────────────────────────────────────────────────

    static float clamp01(float v) {
        return v < 0f ? 0f : (v > 1f ? 1f : v);
    }

    /** Kotlin: ((lStar + 16f) / 116f).pow(3f) — pow 는 double 로 올라갔다 내려온다. */
    static float lightnessForTone(int tone) {
        float lStar = (float) tone;
        float y = (lStar > 8f)
                ? (float) Math.pow((double) ((lStar + 16f) / 116f), (double) 3f)
                : lStar / 903.2963f;
        return (float) Math.cbrt((double) y);
    }

    static float[] oklabToLinear(float l, float a, float b) {
        float lp = l + 0.3963377774f * a + 0.2158037573f * b;
        float mp = l - 0.1055613458f * a - 0.0638541728f * b;
        float sp = l - 0.0894841775f * a - 1.2914855480f * b;
        float ll = lp * lp * lp;
        float mm = mp * mp * mp;
        float ss = sp * sp * sp;
        return new float[] {
            4.0767416621f * ll - 3.3077115913f * mm + 0.2309699292f * ss,
            -1.2684380046f * ll + 2.6097574011f * mm - 0.3413193965f * ss,
            -0.0041960863f * ll - 0.7034186147f * mm + 1.7076147010f * ss,
        };
    }

    static boolean inGamut(float[] rgb) {
        for (float v : rgb) {
            if (!(v >= -0.0005f && v <= 1.0005f)) return false;
        }
        return true;
    }

    /** Kotlin: ((v + 0.055f) / 1.055f).pow(2.4f) — 지수는 2.4f.toDouble() 이다. */
    static float srgbToLinear(float c) {
        float v = clamp01(c);
        return v <= 0.04045f
                ? v / 12.92f
                : (float) Math.pow((double) ((v + 0.055f) / 1.055f), (double) 2.4f);
    }

    /** Kotlin: 1.055f * v.pow(1f / 2.4f) - 0.055f — 1f/2.4f 는 **Float 나눗셈**이다. */
    static float linearToSrgb(float c) {
        float v = clamp01(c);
        return v <= 0.0031308f
                ? v * 12.92f
                : 1.055f * (float) Math.pow((double) v, (double) (1f / 2.4f)) - 0.055f;
    }

    static float[] linearToColor(float[] rgb) {
        return new float[] { linearToSrgb(rgb[0]), linearToSrgb(rgb[1]), linearToSrgb(rgb[2]) };
    }

    static float[] oklch(float lightness, float chroma, float hueDegrees) {
        float l = clamp01(lightness);
        if (chroma <= 0f) return linearToColor(oklabToLinear(l, 0f, 0f));
        double rad = Math.toRadians((double) hueDegrees);
        float ca = (float) Math.cos(rad);
        float cb = (float) Math.sin(rad);
        float lo = 0f;
        float hi = chroma;
        if (inGamut(oklabToLinear(l, ca * hi, cb * hi))) {
            return linearToColor(oklabToLinear(l, ca * hi, cb * hi));
        }
        for (int i = 0; i < 18; i++) {
            float mid = (lo + hi) / 2f;
            if (inGamut(oklabToLinear(l, ca * mid, cb * mid))) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        return linearToColor(oklabToLinear(l, ca * lo, cb * lo));
    }

    // ── Compose 의 Color 패킹 ────────────────────────────────────────
    //
    // androidx.compose.ui.graphics.Color(red, green, blue, alpha, colorSpace) 는
    // sRGB 일 때 채널을 8비트 ARGB 로 패킹한다:
    //
    //     ((red * 255.0f + 0.5f).toInt() shl 16) or ...
    //
    // 그러므로 Color 를 만드는 순간 이미 8비트이고, color.red 는 그 8비트를 되돌린
    // 값이다. 즉 toHex() 의 (v * 255f).toInt()(버림)는 이미 k/255 인 값을 다시 자르는
    // 것이라 결과가 k 그대로다 — **실효 반올림은 여기서 일어난다.**
    //
    // 이 사실이 웹 이식의 버그를 설명한다. 우리 toHex 는 버림만 했고
    // 181.83 -> 181(0xB5), 114.87 -> 114(0x72) 가 나왔다. 반올림하면 182(0xB6),
    // 115(0x73) — Color.kt 가 적어 둔 #DAB673 과 정확히 같다.
    static int pack8(float v) {
        int i = (int) (v * 255.0f + 0.5f);
        return i < 0 ? 0 : (i > 255 ? 255 : i);
    }

    static String hex(float[] rgb) {
        return String.format("#%02X%02X%02X", pack8(rgb[0]), pack8(rgb[1]), pack8(rgb[2]));
    }

    // ── Color.kt 의 아홉 램프 ────────────────────────────────────────

    record Ramp(String name, float hue, float chroma) {}

    static final Ramp[] RAMPS = {
        new Ramp("Ink", 74f, 0.020f),
        new Ramp("Neutral", 74f, 0.007f),
        new Ramp("NeutralVariant", 74f, 0.016f),
        new Ramp("Sage", 148f, 0.060f),
        new Ramp("Clay", 82f, 0.095f),
        new Ramp("WoodNight", 82f, 0.050f),
        new Ramp("Signal", 27f, 0.130f),
        new Ramp("ResultBlue", 245f, 0.085f),
        new Ramp("ResultGreen", 155f, 0.085f),
    };

    static String q(String s) {
        return "\"" + s + "\"";
    }

    public static void main(String[] args) {
        Map<String, String[]> out = new LinkedHashMap<>();
        for (Ramp r : RAMPS) {
            String[] tones = new String[101];
            for (int t = 0; t <= 100; t++) {
                tones[t] = hex(oklch(lightnessForTone(t), r.chroma(), r.hue()));
            }
            out.put(r.name(), tones);
        }

        StringBuilder sb = new StringBuilder();
        sb.append("{\n");
        sb.append("  \"_\": [\n");
        sb.append("    \"Color.kt 의 아홉 램프를 톤 0..100 전부 덤프한 것. 웹 이식의 기준값이다.\",\n");
        sb.append("    \"생성: java tools/tone-dump/ToneDump.java  (.github/workflows/tone-dump.yml)\",\n");
        sb.append("    \"근거: Kotlin Float = Java float, kotlin.math = java.lang.Math,\",\n");
        sb.append("    \"      Compose 의 sRGB Color 는 (v*255f + 0.5f).toInt() 로 8비트 패킹한다(반올림).\",\n");
        sb.append("    \"검증점: Color.kt 가 못 박은 Clay 톤 76 = #DAB673 을 이 덤프가 재현하는가.\"\n");
        sb.append("  ],\n");
        sb.append("  \"anchors\": {\n");
        sb.append("    \"Clay.tone(76)\": ").append(q(out.get("Clay")[76])).append(",\n");
        sb.append("    \"Clay.tone(42)\": ").append(q(out.get("Clay")[42])).append("\n");
        sb.append("  },\n");
        sb.append("  \"ramps\": {\n");
        int ri = 0;
        for (Map.Entry<String, String[]> e : out.entrySet()) {
            sb.append("    ").append(q(e.getKey())).append(": [");
            for (int t = 0; t <= 100; t++) {
                if (t % 10 == 0) sb.append("\n      ");
                sb.append(q(e.getValue()[t]));
                if (t < 100) sb.append(", ");
            }
            sb.append("\n    ]").append(++ri < out.size() ? "," : "").append("\n");
        }
        sb.append("  }\n}\n");
        System.out.print(sb);

        System.err.println("검증점 Clay.tone(76) = " + out.get("Clay")[76] + "  (Color.kt 주석: #DAB673)");
        System.err.println("검증점 Clay.tone(42) = " + out.get("Clay")[42] + "  (Color.kt 주석: #7B5E22)");
    }
}
