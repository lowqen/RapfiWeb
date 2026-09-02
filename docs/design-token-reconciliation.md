# 디자인 토큰 대조 — 앱과 웹이 같은 값을 내는가

> 판정 2026-09-02 · 기준값 `src/core/design/tokens.golden.json`
> 생성 `tools/tone-dump/ToneDump.java` (CI `tone-dump.yml`, run 33580619713)

## 결론 먼저

| | |
|---|---|
| 웹 이식이 앱과 **정확히** 같은 값을 내는가 | ✅ 아홉 램프 × 톤 101개 = 909개 전부 일치 |
| `Color.kt` 의 앵커 `Clay.tone(76) = #DAB673` | ✅ 맞다 |
| `Color.kt` 의 앵커 `Clay.tone(42) = #7B5E22` | ❌ **틀렸다.** 실제 값은 `#7E5D14` |
| W1 에서 어긋났던 이유 | Float/double 차이가 **아니었다.** 반올림 규칙을 잘못 옮긴 것 |

## 1. 무엇을 기준으로 삼았나

Kotlin 컴파일러가 이 기계에도 CI 러너에도 없다. 그런데 문제되는 코드
(`Oklch.kt`)는 Kotlin 고유 기능을 하나도 쓰지 않는다:

- Kotlin 의 `Float` = IEEE binary32 = Java 의 `float`
- `kotlin.math` 의 `cos`/`sin`/`cbrt`/`pow` 는 `java.lang.Math` 로 위임한다
- `Float.pow(Float)` 는 `Math.pow(this.toDouble(), x.toDouble()).toFloat()` 이다

그래서 **Java 로 전사해 JDK 로 돌렸다**(`tools/tone-dump/ToneDump.java`).
전사가 맞다고 볼 근거는 `Color.kt` 자신이 못 박아 둔 값이다:

> The hue and chroma are chosen so that tone 76 lands on the desktop's own board
> (`#DCB35C` → `#DAB673`) …

덤프가 `#DAB673` 을 **정확히** 재현한다. 그러므로 이 덤프는 Kotlin 이 내는 값이다.

전사에서 놓치기 쉬운 셋을 그대로 옮겼다:

```java
// 1. 지수가 Float 로 선언돼 있으면 double 로 올라갈 때 2.4 가 아니다
(float) Math.pow((double) ((v + 0.055f) / 1.055f), (double) 2.4f)   // 2.4000000953674316

// 2. 1f/2.4f 는 Float 나눗셈이라 double 1/2.4 와 다르다
(float) Math.pow((double) v, (double) (1f / 2.4f))

// 3. Compose 의 sRGB Color 는 8비트로 패킹하며 **반올림**한다
int i = (int) (v * 255.0f + 0.5f);
```

## 2. W1 의 앵커 불일치 — 원인은 셋째였다

W1 커밋은 이렇게 적었다: 「톤 76 은 Float/double 차이로 설명된다 — 두 채널 모두
«정수 바로 아래»에서 잘린 값이라(181.83 / 114.87) Kotlin 의 Float 반올림이면 하나
위로 넘어간다」. **그 설명은 틀렸다.**

진짜 원인은 이식본의 `toHex` 가 **버림**을 썼다는 것이다:

```ts
Math.trunc(v * 255)          // ← W1. 181.83 -> 181(0xB5), 114.87 -> 114(0x72)
Math.floor(v * 255 + 0.5)    // ← 지금.  181.83 -> 182(0xB6), 114.87 -> 115(0x73)
```

Kotlin 쪽 `toHex()` 안에는 확실히 `(v * 255f).toInt()`(버림)가 있다. 그것만 보고
버림으로 옮긴 것인데, **그 시점에 값은 이미 8비트다.** Compose 의
`Color(red, green, blue)` 가 sRGB 색공간에서

```kotlin
((red * 255.0f + 0.5f).toInt() shl 16) or ((green * 255.0f + 0.5f).toInt() shl 8) or …
```

로 패킹하기 때문이다. `color.red` 는 그 8비트를 `k/255f` 로 되돌린 값이고,
`toHex` 의 버림은 그것을 다시 자르는 것이라 결과가 `k` 그대로다.
**실효 반올림은 Color 생성자에서 일어난다.**

두 채널이 *둘 다* 정확히 1씩 어긋났던 것이 Float 오차처럼 보이게 만들었지만,
Float 오차라면 방향이 한쪽으로 몰릴 이유가 없다. 체계적 편향은 규칙 차이의 신호다 —
그때 그렇게 읽었어야 했다.

고친 뒤 **909개 톤이 전부 정확히 일치한다.** double 로 계산하는 것은 문제가 되지
않는다: 출력이 8비트라 double/Float 차이는 «정수 경계의 0.5/255 안쪽»에서만 드러날 수
있고, 이 팔레트에서는 한 번도 드러나지 않는다.

## 3. `Clay.tone(42)` — 주석이 틀렸다

```
Color.kt 주석:  tone 42 on its grid (#7A5A2B -> #7B5E22)
실제 덤프:                                    #7E5D14
```

차이가 R 3 · G 1 · **B 20** 이다. 반올림으로도 Float 오차로도 설명되지 않는다.
그리고 이 톤·이 채도는 sRGB 색역 **안**이라 `oklch()` 의 채도 이분탐색이 개입하지도
않는다(직접 손으로 검산해도 `#7E5D14` 다). 즉 **코드가 아니라 주석이 틀렸다.**

가장 그럴듯한 경위: 램프의 `chroma` 를 톤 76 이 데스크톱 보드에 떨어지도록 맞춰
가면서 톤 42 쪽 값은 다시 계산하지 않은 것. 톤 76 앵커는 맞고 톤 42 앵커만 틀린
것이 그 그림과 맞는다.

**처리**

- 웹: 실제 값(`#7E5D14`)을 기준으로 삼는다. 「Kotlin 실제 값에 맞춘다」는 지시 그대로다.
- 앱: `Color.kt` 의 주석을 실제 값으로 고쳤다(RapfiDroid 별도 커밋).
  **코드는 건드리지 않았다** — 값을 바꾸면 이미 배포된 앱의 격자색이 달라진다.
  틀린 것은 설명이지 색이 아니다.

## 4. 앞으로

- `ramps.test.ts` 가 909개를 매 CI 마다 **정확히** 대조한다. ±1 허용은 없앴다.
- 램프의 `hue`/`chroma` 를 고치면 `tone-dump.yml` 을 다시 돌려 골든을 갱신해야 한다.
  갱신 없이 고치면 시험이 즉시 빨개진다 — 그게 이 파일이 있는 이유다.
- 계획서 §5 의 리스크 「TS `cbrt`/거듭제곱 부동소수 차이로 색이 1비트 어긋남」은
  **해소됐다.** 8비트 출력이 그 차이를 흡수한다.
