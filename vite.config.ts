import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { CSP_KEYS, ISOLATION_KEYS, omit, siteHeaders } from "./scripts/headers";
import { studioPlugin } from "./scripts/studio-plugin";

/**
 * 헤더는 `public/_headers` 의 `/*` 블록을 그대로 쓴다(`scripts/headers.ts` — 원본은 그 파일 하나).
 * 교차 출처 격리(COOP/COEP)가 있어야 멀티스레드 엔진(multi-simd128)이 SharedArrayBuffer 를 얻는다
 * (docs/W0c-결과.md). 격리가 안 되는 곳에서는 앱이 단일 스레드 엔진으로 물러선다.
 *
 * - 미리보기(`pnpm preview`)는 배포와 **똑같다** — CSP 까지.
 * - 개발 서버는 CSP 를 뺀다. Vite 개발 클라이언트와 React Refresh 가 인라인 스크립트와 `<style>` 을
 *   쓰므로 프로덕션 정책 아래서는 돌지 않는다. CSP 의 시험은 빌드 결과를 띄우는 스모크가 맡는다.
 *
 * 단일 스레드만으로 개발하려면 `RAPFIWEB_ISOLATE=0 pnpm dev`(COOP/COEP 만 빠진다).
 */
const SITE = siteHeaders();
const HEADERS = process.env.RAPFIWEB_ISOLATE === "0" ? omit(SITE, ISOLATION_KEYS) : SITE;

export default defineConfig(({ command }) => ({
  server: { headers: omit(HEADERS, CSP_KEYS) },
  preview: { headers: HEADERS },
  // GitHub Pages 는 저장소 이름이 경로에 붙는다(https://lowqen.github.io/RapfiWeb/).
  // 기본값은 "/" 로 두어 로컬 개발·스모크가 그대로 돌고, 배포 잡만 이 값을 준다.
  base: process.env.RAPFIWEB_BASE ?? "/",
  // studioPlugin: 커리큘럼 스튜디오의 «저장소에 저장»(개발 서버에만 — scripts/studio-plugin.ts).
  plugins: [react(), studioPlugin()],
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
  // 프로덕션 번들에서 console · debugger 를 걷는다(지금은 0건 — 실수로 들어올 것에 대한 보험).
  // 개발 서버 · 시험(vitest)에는 걸지 않는다.
  esbuild: command === "build" ? { drop: ["console", "debugger"] } : {},
  build: {
    target: "es2022",
    // .map 은 만들되 번들에 `sourceMappingURL` 로 잇지 않는다. 배포(deploy.yml)는 .map 을 CI
    // 아티팩트로 옮기고 배포본에서 지운다 — 원본 TS 가 소스 탭에 그대로 보이던 것을 막고, 프로덕션
    // 오류 스택은 아티팩트의 맵으로 맞춰 본다(docs/보안-강화-계획.md F2).
    sourcemap: "hidden",
    // .wasm/.data 는 우리가 public/engine 에 그대로 둔다 — 번들러가 손대면
    // Emscripten 글루의 locateFile 규약이 깨진다.
    assetsInlineLimit: 0,
  },
  test: {
    environment: "node",
    // scripts/ 는 헤더 정책 시험(headers.test.ts) — 스모크 스크립트 자체는 시험 파일이 아니다.
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
}));
