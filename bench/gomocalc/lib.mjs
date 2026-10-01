/**
 * 벤치 공용 — COOP/COEP 정적 서버와 Playwright 로 호스트 페이지를 모는 손.
 * 파서는 **이 파일 안에서만** 쓴다. 앱의 `src/engine/engine-protocol.ts` 는 건드리지도
 * 불러오지도 않는다(측정이 앱 파서를 오염시키지 않도록, 그리고 앱 파서의 버그가 측정을
 * 오염시키지 않도록).
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
};

/** bench/gomocalc 를 루트로, 격리 헤더를 늘 붙여 서비스한다. */
export function serve(port) {
  const root = HERE;
  const server = createServer(async (req, res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Cache-Control", "no-store");
    try {
      const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
      const file = resolve(join(root, path));
      if (!file.startsWith(root)) throw new Error("밖");
      const s = await stat(file);
      if (!s.isFile()) throw new Error("파일 아님");
      res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
      res.end(await readFile(file));
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

/** 페이지 안의 bench 를 부르는 얇은 손. */
export class Host {
  constructor(page) {
    this.page = page;
    this.cursor = 0;
  }
  async load(engine, variant) {
    const dataName = engine === "gomocalc" ? "rapfi.data" : null;
    return this.page.evaluate(
      ([d, v, n]) => window.bench.load(d, v, n),
      [`/engines/${engine}/`, variant, dataName],
    );
  }
  send(cmd) {
    return this.page.evaluate((c) => window.bench.send(c), cmd);
  }
  post(cmd) {
    return this.page.evaluate((c) => window.bench.post(c), cmd);
  }
  memoryBytes() {
    return this.page.evaluate(() => window.bench.memoryBytes());
  }
  /** 지금까지 쌓인 줄을 커서 이후로 전부 가져온다. */
  async drain() {
    const lines = await this.page.evaluate((from) => window.bench.lines.slice(from), this.cursor);
    this.cursor += lines.length;
    return lines;
  }
  /** `pred(line)` 이 참인 줄이 올 때까지. 그 사이의 줄을 모두 돌려준다. */
  async until(pred, timeoutMs, what) {
    const got = [];
    const t0 = Date.now();
    for (;;) {
      const batch = await this.drain();
      for (let i = 0; i < batch.length; i++) {
        got.push(batch[i]);
        if (pred(batch[i].line)) {
          // 뒤에 딸려 온 줄은 다음 호출이 받도록 커서를 되돌린다.
          this.cursor -= batch.length - i - 1;
          return got;
        }
      }
      if (Date.now() - t0 > timeoutMs) {
        const tail = got.slice(-8).map((l) => l.line);
        throw new Error(
          `${what}: ${timeoutMs}ms 안에 오지 않았습니다. 마지막 줄: ${tail.join(" | ")}`,
        );
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  now() {
    return this.page.evaluate(() => performance.now());
  }
}

/** 좌표 한 줄(`7,8`) — 탐색이 끝났다는 표시. */
export const isMove = (l) => /^\d+,\d+$/.test(l);

/**
 * Rapfi 출력에서 벤치가 쓰는 것만 뽑는다.
 *   INFO DEPTH / SELDEPTH / TOTALNODES / TOTALTIME / SPEED / EVAL / WINRATE / BESTLINE / PV
 *   MESSAGE Depth 15-22 | Eval 123 | Time 1469ms | …   (사람이 읽는 줄 — 참고용)
 */
export function parseInfo(line) {
  const m = /^INFO (\w+) (.*)$/.exec(line);
  if (!m) return null;
  const key = m[1].toUpperCase();
  const raw = m[2].trim();
  const num = Number(raw);
  return { key, raw, num: Number.isFinite(num) ? num : null };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 수순 → `YXBOARD` 블록 한 덩어리. 1 = 둘 차례인 쪽의 돌, 2 = 상대 돌.
 * **한 번의 sendCommand 로** 보내야 한다 — 단일 빌드는 받자마자 한 바퀴 돌리므로
 * 줄 단위로 나누면 빈 판이 세워지고 좌표 줄이 명령으로 읽힌다(engine-worker.ts 주석).
 */
export function boardBlock(moves) {
  const toMove = moves.length % 2; // 0 = 흑 차례
  const rows = moves.map(([x, y], i) => `${x},${y},${i % 2 === toMove ? 1 : 2}`);
  return ["YXBOARD", ...rows, "DONE"].join("\n");
}

/** 사람이 읽는 좌표(h8). y 는 위에서 아래로 자라므로 표기는 15-y. */
export const label = ([x, y]) => `${"abcdefghijklmno"[x]}${15 - y}`;

/** `+M9` / `-M9` → ±9, 숫자면 null. */
export function mateOf(raw) {
  const m = /^([+-])M(\d+)$/i.exec(raw ?? "");
  return m ? (m[1] === "-" ? -1 : 1) * Number(m[2]) : null;
}

/**
 * 탐색 한 번. 국면을 세우고 `YXNBEST 1` 로 걸고 좌표가 올 때까지 받는다.
 *
 * 깊이 도달 시간은 **처음 보고된 시각**으로 적는다 — Rapfi 는 한 깊이를 끝낼 때와
 * 그 깊이 안에서 최선수가 바뀔 때 모두 `INFO DEPTH` 를 낸다.
 * 두 시계를 함께 둔다: 엔진이 말한 TOTALTIME 과 명령을 보낸 뒤의 벽시계.
 *
 * 멀티 빌드는 좌표를 찍은 뒤에도 탐색 스레드가 잠깐 stdin 을 읽는다(앱의 입력 경합,
 * docs/W0c-결과.md). 그래서 끝나면 `settleMs` 만큼 쉰 뒤 돌아온다.
 */
export async function search(host, moves, { timeMs, clearHash = true, settleMs = 150 }) {
  if (clearHash) await host.post("YXHASHCLEAR");
  await host.post(`INFO TIMEOUT_TURN ${timeMs}`);
  await host.post(boardBlock(moves));
  host.cursor = (await host.page.evaluate(() => window.bench.lines.length)) | 0;
  const tSend = await host.now();
  await host.post("YXNBEST 1");
  const lines = await host.until(isMove, timeMs + 60_000, `탐색(${moves.length}수 국면)`);
  await sleep(settleMs);

  const depthAt = new Map(); // depth → { engineMs, wallMs, nodes }
  let rec = {};
  let last = null;
  let summary = null;
  for (const { t, line } of lines) {
    const info = parseInfo(line);
    if (info) {
      switch (info.key) {
        case "PV":
          if (info.raw === "DONE") {
            if (rec.depth != null) {
              last = { ...rec };
              if (!depthAt.has(rec.depth)) {
                depthAt.set(rec.depth, {
                  engineMs: rec.totaltime ?? null,
                  wallMs: Math.round(t - tSend),
                  nodes: rec.totalnodes ?? null,
                  eval: rec.eval ?? null,
                });
              }
            }
            rec = {};
          }
          break;
        case "DEPTH":
        case "SELDEPTH":
        case "TOTALNODES":
        case "TOTALTIME":
        case "SPEED":
        case "WINRATE":
          rec[info.key.toLowerCase()] = info.num;
          break;
        case "EVAL":
          rec.eval = info.raw;
          break;
        case "BESTLINE":
          rec.bestline = (info.raw.match(/\d+,\d+/g) ?? []).map((s) => s.split(",").map(Number));
          break;
      }
      continue;
    }
    // MESSAGE Speed 33960 | Depth 14-24 | Eval -399 | Node 67K | Time 1976ms
    const sm =
      /^MESSAGE Speed (\d+) \| Depth (\d+)-(\d+) \| Eval (\S+) \| Node (\S+) \| Time (\d+)ms/.exec(
        line,
      );
    if (sm) {
      summary = {
        speed: Number(sm[1]),
        depth: Number(sm[2]),
        selDepth: Number(sm[3]),
        eval: sm[4],
        timeMs: Number(sm[6]),
      };
    }
  }
  const moveLine = lines[lines.length - 1];
  const move = moveLine.line.split(",").map(Number);
  return {
    move,
    wallMs: Math.round(moveLine.t - tSend),
    nodes: last?.totalnodes ?? null,
    engineMs: last?.totaltime ?? null,
    nps: summary?.speed ?? last?.speed ?? null,
    depth: summary?.depth ?? last?.depth ?? null,
    selDepth: summary?.selDepth ?? last?.seldepth ?? null,
    eval: summary?.eval ?? last?.eval ?? null,
    winrate: last?.winrate ?? null,
    bestline: last?.bestline ?? [],
    depthAt: Object.fromEntries([...depthAt.entries()].sort((a, b) => a[0] - b[0])),
  };
}

/** 규칙·보드·해시를 세운다. START 의 OK 를 기다린다. */
export async function setup(host, { hashMb = 128 } = {}) {
  await host.post("INFO SHOW_DETAIL 3");
  // 규칙을 START 보다 먼저 — 렌주 가중치만 구운 빌드가 없는 가중치를 찾지 않게.
  await host.post("INFO RULE 4");
  host.cursor = (await host.page.evaluate(() => window.bench.lines.length)) | 0;
  await host.post("START 15");
  await host.until((l) => l === "OK", 30_000, "START → OK");
  await sleep(150);
  await host.post(`INFO HASH_SIZE ${hashMb * 1024}`);
  await host.post("INFO TIMEOUT_MATCH 0");
}

// ── 판 검사(국면 생성기용) ────────────────────────────────────────────

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** 15×15 판. 0 빈칸, 1 흑, 2 백. */
export function boardOf(moves) {
  const b = Array.from({ length: 15 }, () => new Array(15).fill(0));
  moves.forEach(([x, y], i) => (b[y][x] = i % 2 === 0 ? 1 : 2));
  return b;
}

const at = (b, x, y) => (x < 0 || y < 0 || x > 14 || y > 14 ? -1 : b[y][x]);

/** (x,y) 에 놓인 돌이 5 이상을 이루는가. */
export function makesFive(b, x, y) {
  const c = b[y][x];
  for (const [dx, dy] of DIRS) {
    let n = 1;
    for (let k = 1; at(b, x + k * dx, y + k * dy) === c; k++) n++;
    for (let k = 1; at(b, x - k * dx, y - k * dy) === c; k++) n++;
    if (n >= 5) return true;
  }
  return false;
}

/**
 * (x,y) 에 놓인 돌이 **사(四)** 를 만드는가 — 그 돌을 품은 다섯 칸 창 가운데 같은
 * 색 넷 + 빈칸 하나인 창이 있으면 사다(상대가 그 빈칸을 막아야 한다). 렌주 금수·
 * 장목 세부는 보지 않는다 — VCF/VCT 를 **가르는** 용도로만 쓴다.
 */
export function makesFour(b, x, y) {
  const c = b[y][x];
  for (const [dx, dy] of DIRS) {
    for (let s = -4; s <= 0; s++) {
      let mine = 0;
      let empty = 0;
      for (let k = 0; k < 5; k++) {
        const v = at(b, x + (s + k) * dx, y + (s + k) * dy);
        if (v === c) mine++;
        else if (v === 0) empty++;
      }
      if (mine === 4 && empty === 1) return true;
    }
  }
  return false;
}

/**
 * 필승 수순이 VCF(공격 수가 전부 사)인가 VCT(삼이 섞임)인가.
 *
 * Rapfi 의 BESTLINE 은 필승 거리보다 **대개 3수 짧다**(실측: +M11 에 8수, +M9 에 6수 —
 * 끝의 뻔한 사·막기·오목을 적지 않는다). 그래서 거리 − 3 까지 적힌 수순이면 판정하고,
 * 적힌 공격 수가 둘 이상일 때만 판정한다(+M1·+M3 같은 코앞의 오목은 수읽기 부하가 없다).
 */
export function classifyWin(moves, line, mateDist) {
  if (line.length < Math.max(3, mateDist - 3)) return "unknown";
  const b = boardOf(moves);
  let color = moves.length % 2 === 0 ? 1 : 2;
  let allFours = true;
  for (let i = 0; i < line.length; i++) {
    const [x, y] = line[i];
    if (b[y][x] !== 0) return "unknown";
    b[y][x] = color;
    if (i % 2 === 0) {
      if (makesFive(b, x, y)) return allFours ? "VCF" : "VCT";
      if (!makesFour(b, x, y)) allFours = false;
    }
    color = 3 - color;
  }
  return allFours ? "VCF" : "VCT";
}
