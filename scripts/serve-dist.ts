/**
 * 스모크가 띄우는 정적 서버 — 빌드된 `dist/` 를 배포와 같은 헤더(`isolation.ts` 의 SITE_HEADERS)로,
 * SPA 폴백까지(없는 파일 · 확장자 없는 경로는 index.html).
 *
 * vite preview 를 쓰지 않는 이유는 종료 처리를 우리가 확실히 쥐고 있어야 CI 가 매달리지 않기 때문이다.
 * 예전에는 스모크마다 이 서버를 베껴 두어 MIME 표가 조금씩 달랐다(어느 것은 .data · .map 이 없었고,
 * 모두 글꼴을 octet-stream 으로 냈다). 이제 이것 하나다.
 */
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_HEADERS } from "./isolation.ts";

export const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".map": "application/json",
};

/**
 * 시험이 내용에 기대지 않도록 배포 파일 대신 내는 고정 자료 — 경로 → 파일.
 *
 * 공식 커리큘럼(`public/joseki/curriculum.json`)은 관리자가 스튜디오로 수시로 고쳐 싣는 **내용**이다. 스모크가
 * 그 파일을 그대로 읽으면 기능은 멀쩡한데 레슨을 고쳤다는 이유로 빨갛게 난다(2026-10-12 «curriculum
 * 2026.10.12» 커밋이 실제로 그랬다). 기능은 고정 자료로 보고, 배포 파일의 내용은 단위 시험
 * (`curriculum.test.ts` — 스키마 · 영어 · 스튜디오 검사 · 배포 글꼴)이 본다.
 */
export const CURRICULUM_FIXTURE: Readonly<Record<string, string>> = {
  "/joseki/curriculum.json": join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures/curriculum.json",
  ),
};

/**
 * `dist/` 를 `port` 에 띄운다. 돌려받은 서버는 스모크 끝에 `close()` 한다.
 * `overrides` 의 경로는 dist 대신 그 파일로 답한다(`CURRICULUM_FIXTURE`).
 */
export async function serveDist(
  port: number,
  overrides: Readonly<Record<string, string>> = {},
): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = decodeURIComponent(url.pathname);
    let file = overrides[path] ?? join(DIST, path);
    if (!existsSync(file) || extname(file) === "") file = join(DIST, "index.html");
    try {
      const body = readFileSync(file);
      res.writeHead(200, {
        ...SITE_HEADERS,
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(port, r));
  return server;
}
