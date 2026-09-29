import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

/**
 * 교차 출처 격리 헤더 — `public/_headers` 와 **같은 두 줄**이다. 멀티스레드 엔진
 * (multi-simd128)은 SharedArrayBuffer 가 있어야 돌고, 그것은 이 헤더로 격리됐을 때만
 * 열린다(docs/W0c-결과.md). 개발 서버·미리보기도 배포와 같은 엔진을 띄우도록 붙인다.
 * 격리가 안 되는 곳에서는 앱이 단일 스레드 엔진으로 물러선다.
 *
 * 단일 스레드만으로 개발하려면 `RAPFIWEB_ISOLATE=0 pnpm dev`.
 */
const ISOLATION_HEADERS =
  process.env.RAPFIWEB_ISOLATE === "0"
    ? {}
    : {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      };

export default defineConfig({
  server: { headers: ISOLATION_HEADERS },
  preview: { headers: ISOLATION_HEADERS },
  // GitHub Pages 는 저장소 이름이 경로에 붙는다(https://lowqen.github.io/RapfiWeb/).
  // 기본값은 "/" 로 두어 로컬 개발·스모크가 그대로 돌고, 배포 잡만 이 값을 준다.
  base: process.env.RAPFIWEB_BASE ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  worker: {
    // **클래식(IIFE)이다.** upstream 글루는 `-sMODULARIZE=1 -sEXPORT_NAME=Rapfi` 만
    // 쓰고 EXPORT_ES6 는 쓰지 않아 ESM 이 아니라 전역을 정의하는 스크립트다.
    // 그것을 읽는 방법은 `importScripts` 뿐이고, `importScripts` 는 **클래식
    // 워커에만** 있다. 모듈 워커에서는 Emscripten 의 환경 감지가
    // `typeof importScripts == "function"` 으로 워커임을 판별하지 못해
    // `.data` 로딩 경로부터 어긋난다. W0-1 이 통과시킨 구성이 클래식이었고,
    // 검증된 쪽을 따른다.
    format: "iife",
  },
  build: {
    target: "es2022",
    sourcemap: true,
    // .wasm/.data 는 우리가 public/engine 에 그대로 둔다 — 번들러가 손대면
    // Emscripten 글루의 locateFile 규약이 깨진다.
    assetsInlineLimit: 0,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
