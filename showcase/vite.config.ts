import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

/**
 * 엔진 쇼케이스 — 앱(`src/`)과 따로 빌드되는 정적 한 장짜리 사이트.
 *
 *   pnpm showcase:dev     개발 서버
 *   pnpm showcase:build   타입 검사 + dist-showcase/
 *
 * `base: "./"` — 결과물을 어느 경로에 올려도(하위 폴더 · 파일 열기 미리보기) 자산 경로가 맞게.
 * 숫자는 모두 `showcase/src/data/` 에서 온다(대국 분석은 bench/sprt/match-report.mjs 가 만든 JSON).
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist-showcase", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
  },
  server: { port: 5180 },
  preview: { port: 5181 },
});
