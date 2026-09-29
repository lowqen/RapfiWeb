# W0c 결과 — 멀티스레드 변형이 브라우저에서 도는가

> 2026-09-29 · CI `w0-c-threads.yml` run 36454127910 · 36455763870 · **36457914206(최종)**
> 엔진 `dhbloo/rapfi` `3c94c2a9` · Emscripten 6.0.8 (clang++ 24.0.0) · ubuntu-latest
> 하네스 `spike/w0c/` (`node spike/w0c/run.mjs`) · 스레드 조절 계획서 1단계

## 판정

| # | 질문 | 판정 |
|---|---|---|
| 1 | 멀티 변형이 브라우저에서 기동·왕복하는가 | ✅ chromium · firefox · webkit 셋 다 — **COOP/COEP 격리 아래에서** |
| 2 | 앱처럼 **전용 워커 안에서** 띄울 수 있는가 | ✅ **pthread 가드 한 줄**로 된다(아래). 가드 없이는 W0 와 똑같이 무응답 |
| 3 | 탐색 중 정지가 닿는가 | ✅ `YXSTOP` → 좌표 **1~9ms**(지금은 조각 경계 ≤ 500ms). 탐색 명령이 호출자를 붙드는 시간 **0ms** |
| 4 | 멀티 빌드가 1 스레드에서 손해를 보는가 | ✅ 아니다 — 단일 빌드와 잡음 범위 안에서 같다 |
| 5 | 격리 없이(지금 배포 헤더) 도는가 | ❌ 셋 다 무응답 — **헤더가 필수**다 |
| 6 | 코어를 늘리면 빨라지는가(4t · 8t) | ❓ **판정 못 함** — 잰 기계가 모두 2코어였다(아래 한계) |
| 7 | 실제 Safari · iOS · Cloudflare 헤더 | ❓ 안 쟀다 — Playwright WebKit(리눅스)만 |

**결론: 계획서 2단계 이후로 갈 수 있다.** 멀티 변형은 앱의 지금 구조(엔진 전용 워커)를
그대로 둔 채 붙는다. 남은 미지수(6·7)는 **4코어 이상 실기기**에서만 풀리고, 그러려면
COOP/COEP 를 켠 HTTPS 미리보기 배포가 필요하다.

## 최종 런 원자료 (run 36457914206)

속도는 `INFO TOTALNODES × 1000 / INFO TOTALTIME`(노드/초), 같은 조건 2회 중 큰 값.
탐색 3초, 같은 3수 국면, 매번 `YXHASHCLEAR`.

| 브라우저 | 변형 | 실행 | 격리 | 결과 | 1t | 2t | 4t | 8t | 탐색 명령 차단 | YXSTOP | 호스트 최대 지연 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| chromium | single | worker | O | ✅ | 88,090 | — | 50,020¹ | — | 2,978ms | — | 3,937ms |
| chromium | multi | page | O | ✅ | 87,574 | 101,126 | 100,382 | — | 0ms | 1ms | 100ms |
| chromium | multi | worker | O | ❌ 무응답 | | | | | | | |
| chromium | multi | **worker-pthread** | O | ✅ | 88,962 | 88,194 | 108,600 | — | 0ms | 1ms | 60ms |
| chromium | multi | page | **X** | ❌ 무응답 | | | | | | | |
| firefox | single | worker | O | ✅ | 5,586 | — | 5,621 | — | 3,889ms | — | 5,192ms |
| firefox | multi | page | O | ✅ | 5,201 | 5,845 | 14,837² | — | 0ms | 9ms | 129ms |
| firefox | multi | worker | O | ❌ 무응답 | | | | | | | |
| firefox | multi | **worker-pthread** | O | ✅ | 5,201 | 6,003 | 9,012 | — | 0ms | 8ms | 129ms |
| firefox | multi | page | **X** | ❌ 무응답 | | | | | | | |
| webkit | single | worker | O | ✅ | 56,608 | — | 56,558 | — | 2,423ms | — | 3,115ms |
| webkit | multi | page | O | ✅ | 59,439 | 68,544 | 70,312 | 80,297 | 0ms | 2ms | 279ms |
| webkit | multi | worker | O | ❌ 무응답 | | | | | | | |
| webkit | multi | **worker-pthread** | O | ✅ | 58,765 | 66,830 | 74,351 | 85,955 | 0ms | 2ms | 105ms |
| webkit | multi | page | **X** | ❌ 무응답 | | | | | | | |

¹ 단일 빌드는 `THREAD_NUM 4` 를 무시한다 — 같은 조건 두 번이 88K 와 50K 로 갈렸다. **러너 잡음의 크기**다.
² 2회가 14,837 / 7,635 — 역시 잡음.

## 워커에서 죽던 이유 — W0 의 미해결 항목

W0 기록: 「헤드리스 Chromium 워커에서 멀티 변형은 기동은 되는데 전 단계 시간 초과」.
글루(`rapfi-multi-simd128.js`)를 덤프해 원인을 확정했다(Emscripten 6.0.8):

```js
ba && (_scriptName = self.location.href)            // 워커 안이면 = 호스트 워커의 주소
new Worker(_scriptName, { name: "em-pthread" })     // 엔진 스레드마다
isPthread && Rapfi();                               // 글루 끝 — pthread 부트스트랩
```

`importScripts` 로 읽힌 글루에게 `self.location` 은 **호스트 워커 파일**이다. 그래서 엔진
스레드가 글루가 아니라 호스트 워커를 띄우고, 부트스트랩이 한 번도 돌지 않는다 —
팩토리는 resolve 되는데 명령은 영원히 무응답. 모양이 W0 와 똑같다.

이 판의 글루에는 **`mainScriptUrlOrBlob` 가 없다**(grep 0건). 1차 런의 「워커 + 글루 주소
명시」 조합은 그래서 아무것도 바꾸지 못했다 — 가설이 틀린 것이 아니라 수단이 없었다.

### 해법: pthread 로 뜨면 글루만 읽고 비킨다

엔진 스레드는 호스트 워커를 **같은 주소로**, `name: "em-pthread"` 를 달고 연다. 그러면
호스트 워커 머리에서 그 이름을 보고 글루만 `importScripts` 하면 된다 — 글루 끝의
`isPthread && Rapfi()` 가 스레드를 세운다. 호스트 코드(onmessage 등)는 걸지 않는다.

```js
if (self.name === "em-pthread") {
  importScripts(GLUE_URL);   // 여기서 끝 — 글루가 제 onmessage 를 건다
} else {
  /* 원래의 엔진 워커 */
}
```

`spike/w0c/worker.js` 는 글루 주소를 워커 URL 쿼리(`?glue=`)로 넘겼다. 앱의
`engine-worker.ts` 는 번들이라 쿼리 대신 **엔진 기본 주소 + 변형 이름**(이미 워커가
아는 값)으로 글루 주소를 만들면 된다.

## 측정 방법에서 배운 것

- **탐색 끝 요약 줄은 늘 오지 않는다.** 멀티 스레드 탐색은 `MESSAGE Speed …` 없이
  `MESSAGE Bestline …` 으로 끝나기도 한다. 2차 런은 그때 **앞 탐색의** 줄을 집어 4스레드
  속도를 113 으로 적었다 → 최종 런은 `TOTALNODES/TOTALTIME` 으로 직접 잰다. 앱의
  분석 집계(`engine-aggregator.ts`)는 이미 두 줄을 다 보므로 영향이 없다.
- **1차 런의 초당 100~200 은 하네스 오류**였다(위와 같은 원인). 실제는 수만 단위다.
- **단일 빌드는 탐색 동안 호스트 스레드를 통째로 붙든다**(2.4~3.9초). 멀티는 0ms 이고
  호스트 최대 지연이 60~280ms — 그 지연은 엔진이 아니라 러너의 부하다(격리 없는 대조군도
  비슷했다).

## 한계 — 이것은 재지 못했다

1. **4스레드 이상의 효과.** GitHub 러너가 **2 vCPU**(비공개 저장소)이고, 이 저장소를 만든
   PC 도 Celeron N4500 **2코어**다. 그 위에서 4t · 8t 는 코어를 나눠 쓸 뿐이고, 같은 조건이
   40% 흔들리는 잡음 속에서 2t/1t 도 런마다 1.0~2.1 로 갈렸다. **멀티가 느려지지는 않는다**
   까지만 말할 수 있다.
2. **실제 Safari · iOS.** Playwright WebKit(리눅스 빌드, UA Safari 26.5)만 돌았다.
3. **Cloudflare Pages 에서의 헤더.** 로컬 서버(`spike/w0c/serve.mjs`)로만 켰다.
4. **Firefox 절대 속도.** CI 에서 chromium 의 1/15 수준(5K vs 88K)이었다 — 두 변형이
   똑같이 느려 멀티의 문제는 아니다. 원인은 따로 볼 일이다.

## 다음 — 스레드 조절 계획서 기준

- **2단계(엔진 선택)로 간다.** 선택 조건: `WebAssembly SIMD && crossOriginIsolated &&
  SharedArrayBuffer`. 실행 방식은 **지금의 엔진 워커 그대로 + pthread 가드**다 — 페이지
  메인 스레드로 옮길 이유가 없어졌다.
- **3단계**의 전제가 확인됐다: 멀티에서 탐색 명령은 즉시 돌아오고 `YXSTOP` 이 수 ms 에
  닿는다 → 조각 나누기(`sliceMs`)를 끄고, 탐색의 끝은 **좌표 줄**로 판정한다(요약 줄은
  빠질 수 있다).
- **6·7 을 풀려면** COOP/COEP 를 켠 HTTPS 미리보기 배포에서 4코어 이상 실기기로
  `spike/w0c` 를 돌려야 한다(`crossOriginIsolated` 는 HTTPS 또는 localhost 에서만 켜진다 —
  같은 망의 휴대폰에서 PC 의 http 로는 안 된다). 헤더를 켜면 다른 출처 자원이 막히므로
  배포 전에 외부 자원이 없는지 다시 확인한다(지금은 없다 — 시스템 글꼴·자체 아이콘).
- **CI 아티팩트 저장 한도가 차 있다.** 세 런 모두 결과·엔진 업로드가 「Artifact storage
  quota has been hit」로 실패했다(원자료는 그래서 로그에 찍었다). 한도는 계정 단위라
  다른 저장소의 오래된 아티팩트를 지워야 풀린다.
