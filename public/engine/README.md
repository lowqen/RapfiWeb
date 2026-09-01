# public/engine/

여기는 **비어 있는 것이 정상이다.**

`tools/build_engine_wasm.sh` 가 만드는 산출물이 들어올 자리다:

```
rapfi-single-simd128.js     ~38 KB    ← 배포 경로
rapfi-single-simd128.wasm  ~1.2 MB
rapfi-single-simd128.data  ~40 MB     ← 가중치 프리로드. 계획서 §4 대로 줄일 것
package.json                          ← { "type": "commonjs" } (upstream 글루는 CJS)
```

`.js` 와 `.wasm` 은 커밋한다(앱이 `libengine.so` 를 커밋한 이유와 같다 — 클론 직후
바로 실행). `.data` 와 나머지 가중치는 **커밋하지 않고** 릴리스 자산으로 나른다.

지금 비어 있는 이유: W1 은 스캐폴딩이고, 엔진 산출물은 W3 에서 붙인다.
없는 파일을 받으러 가서 콘솔에 404 를 남기지 않도록 `engineStore` 는 자동 기동하지 않는다.
