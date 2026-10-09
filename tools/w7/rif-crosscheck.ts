/**
 * W7 실제 파일 대조 · 실측 — **로컬 전용**(RenjuNet 자료는 저장소에 둘 수 없다).
 *
 *   pnpm exec tsx tools/w7/rif-crosscheck.ts <renjunet_*.rif> [<renju_stats.pack>]
 *
 * 1. 웹 변환기(`src/core/rif`)로 `.rif` 를 브라우저와 같은 조각(1MB) 스트림으로 변환하며 시간과
 *    메모리(V8 힙 + ArrayBuffer — 웹 워커와 같은 엔진)를 잰다.
 * 2. 데스크톱 팩(`rifdb/rif_pack.py` 의 `renju_stats.pack`)이 있으면 **국면마다** 대조한다: 데스크톱의
 *    문자열 키(돌 배치)를 수순으로 되살려 웹 팩에서 찾고, 판 수 · 흑승 · 무 · 백승과 다음 수(자식
 *    국면별 판 수)가 같은지. 데스크톱 쪽은 `rifkey.py`(국면 키의 첫 구현)가 센 것이다.
 *
 * 종료 코드 0 = 모두 같다.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { RifStreamParser } from "../../src/core/rif/rif-parse.ts";
import { buildPack, packBytes, rifInput } from "../../src/core/rif/pack.ts";
import { lookup } from "../../src/core/rif/query.ts";
import { canonicalHash } from "../../src/core/rif/zobrist.ts";
import { move, type Move } from "../../src/core/model/move.ts";

const [rifPath, deskPath] = process.argv.slice(2);
if (!rifPath || !existsSync(rifPath)) {
  console.error("사용법: tsx tools/w7/rif-crosscheck.ts <renjunet_*.rif> [<renju_stats.pack>]");
  process.exit(2);
}

let peak = 0;
let phase = "parse";
const phasePeak: Record<string, number> = {};
/** 단계가 바뀌는 순간 GC 를 강제한 뒤의 양 — 수거할 수 없는(살아 있는) 메모리. */
const live: Record<string, number> = {};
const liveNow = (label: string) => {
  global.gc?.();
  const m = process.memoryUsage();
  live[label] = m.heapUsed + m.arrayBuffers;
};
const sample = () => {
  const m = process.memoryUsage();
  const v = m.heapUsed + m.arrayBuffers;
  peak = Math.max(peak, v);
  phasePeak[phase] = Math.max(phasePeak[phase] ?? 0, v);
};
const MB = (b: number) => `${(b / 1048576).toFixed(1)}MB`;
const timer = setInterval(sample, 20);

// ── 1. 변환 ─────────────────────────────────────────────────────────────
global.gc?.();
const base = process.memoryUsage();
const baseline = base.heapUsed + base.arrayBuffers;
const t0 = performance.now();
const parser = new RifStreamParser(undefined, statSync(rifPath).size);
for await (const chunk of createReadStream(rifPath, { highWaterMark: 1 << 20 })) {
  parser.pushBytes(chunk as Buffer);
  sample();
}
const parsed = parser.finish();
liveNow("parse 끝");
const tParse = performance.now() - t0;
sample();
const pack = buildPack(
  rifInput(parsed, { name: basename(rifPath), size: statSync(rifPath).size }, tParse),
  {
    onProgress: (ph, f, part) => {
      if (ph !== phase || f === 1) liveNow(`${ph}#${part}${f === 1 ? " 끝" : ""}`);
      phase = ph;
      sample();
    },
  },
);
sample();
clearInterval(timer);
const total = performance.now() - t0;
console.log(
  `변환: 대국 ${pack.games.id.length.toLocaleString()} (버림 ${JSON.stringify(parsed.skipped)}) · ` +
    `국면 ${pack.pos.n.length.toLocaleString()} · 다음 수 ${pack.edges.n.length.toLocaleString()} · ` +
    `모양 ${pack.shapes.length.toLocaleString()} · 선수 ${pack.players.length.toLocaleString()}`,
);
console.log(
  `시간: 파싱 ${tParse.toFixed(0)}ms · 집계 ${pack.stats.buildMs.toFixed(0)}ms · 합계 ${(total / 1000).toFixed(1)}초`,
);
console.log(
  `단계별 피크(시작 대비): ${Object.entries(phasePeak)
    .map(([k, v]) => `${k} ${MB(v - baseline)}`)
    .join(" · ")}`,
);
console.log(
  `살아 있는 양(GC 뒤, 시작 대비): ${Object.entries(live)
    .map(([k, v]) => `${k} ${MB(v - baseline)}`)
    .join(" · ")}`,
);
console.log(
  `메모리: 변환 중 V8 힙+버퍼 피크 ${MB(peak - baseline)}(시작 대비) · 타입드 배열 회계 피크 ${MB(pack.stats.peakBytes)} · 팩 ${MB(packBytes(pack))}`,
);

// ── 2. 데스크톱 팩 대조 ─────────────────────────────────────────────────
if (!deskPath) process.exit(0);
const buf = readFileSync(deskPath);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
if (buf.toString("latin1", 0, 4) !== "RJS1") throw new Error("RJS1 팩이 아닙니다");
const npos = dv.getUint32(8, true);
const nslots = dv.getUint32(12, true);
const totalGames = dv.getUint32(16, true);
const maxPlies = dv.getUint32(20, true);
const minGames = dv.getUint32(24, true);
console.log(
  `데스크톱 팩: 국면 ${npos.toLocaleString()} · 대국 ${totalGames.toLocaleString()} · ≤${maxPlies}수 · ≥${minGames}판`,
);
const recBase = 64 + nslots * 12;

/** 키 `"15f10bg9wh8b"` → 수순(흑 · 백 번갈아). 키의 좌표는 정규 프레임 그대로다. */
function linefromKey(key: string): Move[] {
  const re = /([a-o])(\d+)([bw])/g;
  const blacks: Move[] = [];
  const whites: Move[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 2; // 앞의 "15"
  while ((m = re.exec(key))) {
    const mv = move(m[1]!.charCodeAt(0) - 97, 15 - Number(m[2]));
    (m[3] === "b" ? blacks : whites).push(mv);
  }
  const out: Move[] = [];
  for (let i = 0; i < blacks.length + whites.length; i++)
    out.push(i % 2 === 0 ? blacks[i >> 1]! : whites[i >> 1]!);
  return out;
}
const childKey = (line: readonly Move[], m: Move) => {
  const c = canonicalHash([...line, m]);
  return `${c.hi}:${c.lo}`;
};

let checked = 0;
let missing = 0;
let countDiff = 0;
let nextDiff = 0;
const examples: string[] = [];
for (let s = 0; s < nslots; s++) {
  const off = dv.getUint32(64 + s * 12 + 8, true);
  if (off === 0) continue;
  let p = recBase + off;
  const klen = dv.getUint16(p, true);
  const key = buf.toString("ascii", p + 2, p + 2 + klen);
  p += 2 + klen;
  const [n, b, d, w] = [0, 1, 2, 3].map((i) => dv.getUint32(p + i * 4, true));
  p += 16;
  const nnext = dv.getUint8(p++);
  const line = linefromKey(key);
  const deskNext = new Map<string, number>();
  for (let k = 0; k < nnext; k++) {
    const x = dv.getUint8(p);
    const y = dv.getUint8(p + 1);
    const en = dv.getUint32(p + 2, true);
    p += 18;
    const ck = childKey(line, move(x, y));
    deskNext.set(ck, (deskNext.get(ck) ?? 0) + en);
  }
  checked++;
  const mine = lookup(pack, line);
  if (!mine) {
    missing++;
    if (examples.length < 5) examples.push(`없음: ${key}`);
    continue;
  }
  if (mine.n !== n || mine.b !== b || mine.d !== d || mine.w !== w) {
    countDiff++;
    if (examples.length < 5)
      examples.push(
        `판 수: ${key} 데스크톱 ${[n, b, d, w]} / 웹 ${[mine.n, mine.b, mine.d, mine.w]}`,
      );
  }
  const webNext = new Map<string, number>();
  for (const nx of mine.next) {
    const ck = childKey(line, nx.move);
    webNext.set(ck, (webNext.get(ck) ?? 0) + nx.n);
  }
  const same =
    webNext.size === deskNext.size && [...deskNext].every(([k, v]) => webNext.get(k) === v);
  if (!same) {
    nextDiff++;
    if (examples.length < 5)
      examples.push(`다음 수: ${key} 데스크톱 ${deskNext.size}곳 / 웹 ${webNext.size}곳`);
  }
}
console.log(
  `국면별 대조: ${checked.toLocaleString()}개 — 웹에 없음 ${missing} · 판 수 다름 ${countDiff} · 다음 수 다름 ${nextDiff}` +
    ` · 국면 수 웹 ${pack.pos.n.length.toLocaleString()} / 데스크톱 ${npos.toLocaleString()}`,
);
for (const e of examples) console.log(`  ${e}`);
const ok =
  missing === 0 &&
  countDiff === 0 &&
  nextDiff === 0 &&
  pack.pos.n.length === npos &&
  pack.games.id.length === totalGames;
console.log(ok ? "대조 통과 — 웹 팩이 데스크톱 팩과 국면마다 같다" : "대조 실패");
process.exit(ok ? 0 : 1);
