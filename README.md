# RapfiWeb

**[RapfiDroid](https://github.com/lowqen/RapfiDroid) 의 웹 이식.** 서버 없이 브라우저
안에서 Rapfi 엔진을 돌리고, 앱의 분석·연구 기능과 새 «오프닝 정석» 기능을 얹는다.

> **현재 상태: W0 스파이크.** 나머지 설계 전체가 딛고 선 전제 셋을 실측으로
> 확인하는 중이며, 앱 코드는 아직 없다. 계획서는
> [`gomoku-dev/test-yixin/docs/웹_이식_계획.md`](https://github.com/lowqen/gomoku-dev/blob/main/test-yixin/docs/%EC%9B%B9_%EC%9D%B4%EC%8B%9D_%EA%B3%84%ED%9A%8D.md).

## W0 스파이크가 확인하는 것

| # | 질문 | 통과 기준 |
|---|---|---|
| **W0-1** | 브라우저에서 Rapfi 에 **stdin 을 줄 수 있는가** | SAB + `Atomics.wait` 또는 폴백 중 하나로 piskvork 양방향 통신 성공 |
| **W0-2** | Emscripten 4종 빌드가 되는가 | single / single-simd128 / multi / multi-simd128 전부 산출물 생성 |
| **W0-3** | 웹 엔진이 **같은 답**을 내는가 | 4종 모두 `BENCH` 해시 = `e240ab16` (x86 호스트 · 안드로이드 검증값) |

W0-1 이 가장 불확실하다. Rapfi 는 piskvork 프로토콜을 stdin **블로킹 읽기**로
소비하는데 브라우저에는 stdin 이 없고, Emscripten 이 주는 훅은 동기 함수라
"아직 입력이 없다"를 표현할 방법이 없다(null 은 EOF 다). 워커 스레드에서
`Atomics.wait` 로 소비자를 진짜로 재우는 것이 주 경로다.

## 돌리는 법

전부 리눅스에서 돈다. 이 저장소의 CI(`.github/workflows/w0-spike.yml`)가 하는 일이
곧 아래 그대로다.

```bash
# 1) 엔진 4종 빌드 + 검증 게이트 (emsdk 를 알아서 받는다)
bash tools/build_engine_wasm.sh

# 2) W0-3 — BENCH 해시
node spike/node-bench.mjs multi-simd128

# 3) W0-1 — node worker_threads 로 먼저(싸다)
node spike/node-protocol.mjs multi-simd128

# 4) W0-1 — 진짜 브라우저로
npm install && npx playwright install chromium
node spike/serve.mjs 8787 &
node spike/browser-test.mjs multi-simd128 8787
```

손으로 눈으로 보려면 `node spike/serve.mjs` 후
<http://localhost:8787/spike/harness.html>. 페이지 위쪽 막대가 탐색 중에도
매끄럽게 움직이면 메인 스레드가 막히지 않은 것이다.

## 라이선스

이 저장소의 코드는 **BSD-2-Clause**. 배포물에 Rapfi 엔진(**GPL-3.0-or-later**)이
포함되므로 배포되는 웹앱 전체는 GPL-3.0-or-later 다 — RapfiDroid 와 같은 구조다.

**RenjuNet 파생 자료는 어떤 이유로도 이 저장소에 들어오지 않는다.** 라이선스가
그 내용물 또는 파생물을 웹사이트·온라인 시스템에 올리는 것을 금지하고, 웹앱에서는
커밋이 곧 게시다. 실전 통계는 사용자가 자기 `.rif` 를 브라우저에 넣어 **브라우저
안에서** 만들고, 결과는 그 기기를 벗어나지 않는다.
