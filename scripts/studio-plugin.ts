import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { formatCurriculum } from "../src/core/curriculum/format";

/**
 * 커리큘럼 스튜디오의 «저장소에 저장» — **개발 서버에만** 있는 길(`apply: "serve"`). 빌드 · 미리보기 · 배포본에는
 * 이 끝점이 없다. 그래서 배포된 사이트의 CSP(`connect-src 'self'`)를 넓히지 않고도, 관리자는 `pnpm studio` 로
 * 띄운 화면에서 고친 커리큘럼을 저장소 파일(`public/joseki/curriculum.json`)에 바로 쓴다. 커밋 · push 는
 * `pnpm curriculum:publish` 가 검사와 함께 한다(docs/공식-정석-관리.md).
 *
 *   GET  /__studio/curriculum  → `{ studio: true, version }` — 스튜디오가 이 길이 있는지 본다
 *   POST /__studio/curriculum  → 몸(JSON)을 형식만 보고 배포 글꼴로 쓴다. 내용 검사는 publish 가 한다
 *                                (반쯤 만든 것도 저장소에 남길 수 있게).
 *
 * 지키는 것: 이 컴퓨터(루프백)에서 온 요청만, `Origin` 이 있으면 이 서버와 같은 출처만, 몸은
 * `application/json`(다른 사이트의 폼 · 단순 요청으로는 못 보낸다) · 2MB 까지.
 */

const FILE = fileURLToPath(new URL("../public/joseki/curriculum.json", import.meta.url));
const LIMIT = 2 * 1024 * 1024;

const loopback = (a: string | undefined) =>
  a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";

function reply(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > LIMIT) {
        fail(new Error("too large"));
        req.destroy();
      } else parts.push(c);
    });
    req.on("end", () => ok(Buffer.concat(parts).toString("utf8")));
    req.on("error", fail);
  });
}

export function studioPlugin(): Plugin {
  return {
    name: "rapfi-curriculum-studio",
    apply: "serve",
    configureServer(server) {
      const path = `${server.config.base.replace(/\/$/, "")}/__studio/curriculum`;
      server.middlewares.use(path, (req, res) => {
        void (async () => {
          if (!loopback(req.socket.remoteAddress))
            return reply(res, 403, { error: "loopback only" });
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host)
            return reply(res, 403, { error: "cross-origin" });
          if (req.method === "GET") {
            let version = "";
            try {
              version =
                (JSON.parse(readFileSync(FILE, "utf8")) as { version?: string }).version ?? "";
            } catch {
              /* 파일이 없거나 깨졌어도 길은 있다 */
            }
            return reply(res, 200, { studio: true, version });
          }
          if (req.method !== "POST") return reply(res, 405, { error: "GET or POST" });
          if (!(req.headers["content-type"] ?? "").startsWith("application/json"))
            return reply(res, 415, { error: "application/json only" });
          let raw: unknown;
          try {
            raw = JSON.parse(await readBody(req));
          } catch {
            return reply(res, 400, { error: "not JSON" });
          }
          const r = raw as { format?: unknown; schema?: unknown; courses?: unknown };
          if (r.format !== "rapfiweb-curriculum" || r.schema !== 1 || !Array.isArray(r.courses))
            return reply(res, 400, { error: "not a rapfiweb-curriculum file" });
          // 반쯤 쓴 파일이 남지 않게 옆에 쓰고 바꿔 단다.
          const tmp = `${FILE}.part`;
          writeFileSync(tmp, formatCurriculum(raw));
          renameSync(tmp, FILE);
          server.config.logger.info(`[studio] wrote public/joseki/curriculum.json`, {
            timestamp: true,
          });
          return reply(res, 200, { ok: true });
        })().catch((e: unknown) => reply(res, 500, { error: String(e) }));
      });
    },
  };
}
