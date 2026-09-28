/**
 * W0c 정적 서버 — 같은 파일을 **두 접두사**로 낸다. 의존성 없음.
 *
 *   /iso/…    COOP same-origin + COEP require-corp + CORP same-origin
 *             → crossOriginIsolated = true, SharedArrayBuffer 사용 가능
 *   /plain/…  헤더 없음 → 지금 배포본(public/_headers)과 같은 조건(대조군)
 *
 *   /…/spike/w0c/*   이 폴더
 *   /…/engine/*      ENGINE_DIR (기본 out/engine — 빌드 스크립트의 산출 위치)
 *
 * 헤더를 **모든 응답**(HTML·워커 스크립트·wasm·data)에 붙인다. 전용 워커와 pthread
 * 워커는 자기 스크립트 응답의 헤더로 격리가 정해지는 브라우저가 있어, 문서에만
 * 붙이면 「페이지는 격리됐는데 워커는 아니다」가 된다.
 *
 * 사용: node spike/w0c/serve.mjs [port]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const ROOT = resolve(HERE, "../..");
const ENGINE_DIR = resolve(process.env.ENGINE_DIR ?? join(ROOT, "out/engine"));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
};

export function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = decodeURIComponent(url.pathname);
      const m = /^\/(iso|plain)(\/.*)$/.exec(path);
      if (!m) {
        res.writeHead(404).end("접두사(/iso 또는 /plain)가 필요합니다");
        return;
      }
      if (m[1] === "iso") {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      }
      res.setHeader("Cache-Control", "no-store");

      const rest = normalize(m[2]).replace(/\\/g, "/");
      let file;
      if (rest.startsWith("/engine/")) file = join(ENGINE_DIR, rest.slice("/engine/".length));
      else if (rest.startsWith("/spike/w0c/")) file = join(HERE, rest.slice("/spike/w0c/".length));
      else {
        res.writeHead(404).end("없음");
        return;
      }
      if (!file.startsWith(ENGINE_DIR) && !file.startsWith(HERE)) {
        res.writeHead(403).end("금지");
        return;
      }
      await stat(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end("없음");
    }
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 8788);
  await startServer(port);
  console.log(`W0c 서버: http://localhost:${port}/iso/spike/w0c/page.html (엔진: ${ENGINE_DIR})`);
}
