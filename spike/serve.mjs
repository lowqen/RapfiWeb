/**
 * COOP/COEP 를 붙여 주는 최소 정적 서버. 의존성 없음.
 *
 *   node serve.mjs [port]
 *
 * 이 두 헤더가 없으면 SharedArrayBuffer 생성자는 있어도 `crossOriginIsolated`
 * 가 false 라 실제로는 못 쓴다. 즉 이 서버가 W0-1 주 경로의 전제조건이고,
 * 동시에 계획서 §8 이 Cloudflare Pages `_headers` 로 하려는 일의 축소판이다.
 *
 * `/bench-manifest.json` 은 out/bench 의 목록을 만들어 준다 — 가중치 파일 이름이
 * Networks 커밋에 따라 달라지므로 하드코딩하지 않는다.
 */
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const ROOT = resolve(HERE, "..");
const BENCH_DIR = resolve(process.env.BENCH_DIR ?? join(ROOT, "out/bench"));
const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".toml": "text/plain; charset=utf-8",
  ".bin": "application/octet-stream",
  ".lz4": "application/octet-stream",
  ".data": "application/octet-stream",
};

const server = createServer(async (req, res) => {
  // 헤더는 무조건 붙인다. 하나라도 빠지면 격리가 깨지고, 그 실패는
  // "SAB 가 없다"가 아니라 "왜인지 워커가 멈춘다"로 나타난다.
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");

  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === "/bench-manifest.json") {
      const names = (await readdir(BENCH_DIR)).filter((n) => !n.endsWith(".txt"));
      res.writeHead(200, { "Content-Type": MIME[".json"] });
      res.end(JSON.stringify(names));
      return;
    }
    if (pathname === "/") pathname = "/spike/harness.html";

    const target = resolve(ROOT, "." + normalize(pathname));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const info = await stat(target);
    if (!info.isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
      "Content-Length": info.size,
    });
    res.end(await readFile(target));
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(port, () => {
  console.log(`serve: http://localhost:${port}/  (root=${ROOT}, bench=${BENCH_DIR})`);
});
