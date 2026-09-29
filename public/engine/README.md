# public/engine/

Rapfi WebAssembly 산출물 — **두 변형**이 같은 빌드(릴리스 `engine-3c94c2a9-mt`)에서 나온다.

```
rapfi-multi-simd128.js     ~45 KB   멀티스레드 (pthread) — 교차 출처 격리된 환경에서 먼저 쓴다
rapfi-multi-simd128.wasm  ~1.2 MB
rapfi-multi-simd128.data   ~20 MB   ← 커밋하지 않는다(릴리스 자산). 렌주 가중치만
rapfi-single-simd128.js    ~38 KB   단일 스레드 — 격리가 안 되거나 멀티 기동에 실패하면
rapfi-single-simd128.wasm ~1.2 MB
rapfi-single-simd128.data  ~20 MB   ← 커밋하지 않는다(릴리스 자산). 멀티의 것과 바이트까지 같다
ENGINE_VERSION.txt                  빌드 기록(업스트림 커밋·Emscripten 판)
package.json                        { "type": "commonjs" } (upstream 글루는 CJS)
```

`.js` 와 `.wasm` 은 커밋한다(앱이 `libengine.so` 를 커밋한 이유와 같다 — 클론 직후
바로 실행). **셋은 같은 빌드의 짝이어야 한다** — 글루(.js)에 데이터 패키지 목록이 박혀
있어, 다른 빌드의 `.data` 와 섞이면 뜨자마자 죽는다. 그래서 새 릴리스를 내면 네 파일을
함께 바꾼다. CI·배포는 릴리스에서 세 파일을 모두 받아 덮어쓴다(`web.yml`·`deploy.yml`).

어느 변형을 띄울지는 앱이 정한다(`src/engine/engine-client.ts` `detectCapabilities`,
`docs/W0c-결과.md`). 멀티 변형의 엔진 스레드는 엔진 워커 번들을 다시 여는데, 그때 글루를
**`/engine/rapfi-multi-simd128.js`** 에서 찾는다(`engine-worker.ts` 「pthread 가드」) —
엔진 경로를 바꾸면 `VITE_ENGINE_BASE_URL` 도 함께 바꾼다.

엔진은 **자동으로 뜨지 않는다** — 20MB 가중치를 아무도 요청하지 않았는데 받아 오지 않기
위해서다.
