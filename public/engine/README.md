# public/engine/

Rapfi WebAssembly 산출물 — **네 변형**이 같은 빌드(릴리스 `engine-3c94c2a9-w8`)에서 나온다.

`w8` 은 `a3` 에 `tools/patches/w8-export-fs.patch` 하나를 얹었다 — 글루가 Emscripten `FS` 를
내보내(`EXPORTED_RUNTIME_METHODS` 에 `'FS'`) 엔진 DB 파일 `rapfi.db` 를 워커가 메모리 FS 로
넣고 꺼낼 수 있게 한다(W8, `src/features/database/`). 탐색 코드는 그대로라 NPS · BENCH 는 `a3` 와 같다.

```
rapfi-multi-simd128-relaxed.js/.wasm   멀티스레드 + relaxed SIMD — 격리 + relaxed 를 아는 브라우저(Chromium 114+)에서 먼저
rapfi-multi-simd128.js/.wasm           멀티스레드 — 격리된 환경
rapfi-single-simd128-relaxed.js/.wasm  단일 스레드 + relaxed SIMD — 격리가 안 될 때
rapfi-single-simd128.js/.wasm          단일 스레드 — 마지막 물러설 곳(SIMD 만 있으면 된다)
rapfi.data                  ~20 MB     ← 커밋하지 않는다(릴리스 자산). **모든 변형이 함께 쓴다.** 렌주 가중치만
engine-manifest.json                   ← 릴리스 자산. 같은 내용이 src/engine/engine-manifest.json 으로 커밋된다
ENGINE_VERSION.txt                     빌드 기록(업스트림 커밋·Emscripten 판·가중치 해시)
package.json                           { "type": "commonjs" } (upstream 글루는 CJS)
```

`.js` 와 `.wasm` 은 커밋한다(앱이 `libengine.so` 를 커밋한 이유와 같다 — 클론 직후
바로 실행). **모두 같은 빌드의 짝이어야 한다** — 글루(.js)에 데이터 패키지 목록(가중치
파일별 위치)이 박혀 있어, 다른 빌드의 `.data` 와 섞이면 가중치를 엉뚱하게 잘라 읽는다.
빌드 스크립트가 네 글루의 목록과 변형별 `.data` 가 모두 같음을 확인한 뒤 `rapfi.data`
하나로 낸다. 새 릴리스를 내면 여기의 `.js`/`.wasm` 여덟 개와
`src/engine/engine-manifest.json` 을 함께 바꾼다. CI·배포는 릴리스에서 받은 뒤
`scripts/verify-engine.ts` 로 그 짝을 검증한다(`web.yml`·`deploy.yml`).

## 가중치는 앱이 받는다

글루가 `.data` 를 스스로 받지 않는다. 엔진 워커가 기동하자마자 `rapfi.data?v=<해시>` 를
**Cache Storage 에서 꺼내거나 내려받아 SHA-256 을 확인하고**, 글루에
`getPreloadedPackage` 로 넘긴다(`src/engine/weights-cache.ts`). 그래서

- 재방문·엔진 전환(멀티 → 단일 폴백)에 20MB 를 다시 받지 않는다
- 해시가 매니페스트와 다르면(새 버전·손상) 지우고 다시 받고, 새로 받은 것도 틀리면 뜨지 않는다

## 어느 변형이 뜨는가

앱이 정한다(`src/engine/engine-client.ts` `detectCapabilities` · `planVariants`):
**relaxed 멀티 → 멀티 → relaxed 단일 → 단일** 순으로 띄워 보고, 기동 핸드셰이크나 **예열
탐색**에서 실패하면 다음으로 물러선다. relaxed 명령은 명세상 구현 정의라, 릴리스 게이트가
러너에서 relaxed 의 BENCH 해시 = 일반 SIMD 해시를 확인한다(`engine-release.yml`).
`?relaxed=0` 으로 relaxed 를 끌 수 있다(진단용).

멀티 변형의 엔진 스레드는 엔진 워커 번들을 다시 여는데, 그때 글루를 이 폴더에서 찾는다
(`engine-worker.ts` 「pthread 가드」 — relaxed 멀티는 제 번들 `engine-worker-relaxed.ts`) —
엔진 경로를 바꾸면 `VITE_ENGINE_BASE_URL` 도 함께 바꾼다.

엔진은 **자동으로 뜨지 않는다** — 20MB 가중치를 아무도 요청하지 않았는데 받아 오지 않기
위해서다. 가중치 선적재와 예열은 사용자가 엔진을 띄운 **그 기동 안에서** 돈다.
