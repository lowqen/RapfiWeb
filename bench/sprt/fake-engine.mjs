/**
 * 시험용 가짜 Gomocup 엔진 — 러너의 오류 처리를 일부러 건드린다(runner.test.mjs).
 *
 *   node bench/sprt/fake-engine.mjs [--seed N] [--crash-at K] [--hang-at K] [--illegal-at K] [--spam LINES] [--slow MS] [--speed NPS] [--totals NPS]
 *
 * 수는 시드 고정 난수로 빈 칸에 둔다(규칙을 모른다 — 다섯이 나면 그건 우연이다). K 는 이 프로세스가
 * 받은 BOARD 의 순번(1부터)이다. --spam 은 수마다 그만큼의 MESSAGE 줄을 먼저 찍는다 — 러너가 stdout 을
 * 읽지 않으면 파이프 버퍼가 차서 이 엔진이 write 에서 멈춘다(데드락 시험). --speed 는 수마다 Rapfi 꼴의 요약 줄
 * (`MESSAGE Speed N | Depth 5-7 | … | Time 10ms`)을 찍는다 — 러너의 탐색 통계 시험. --totals 는 멀티 빌드처럼
 * `INFO DEPTH · SELDEPTH · TOTALNODES · TOTALTIME`(10ms 에 NPS 만큼)과 **엉터리** 요약 줄(Speed 159)을 함께 찍는다.
 */
import { createInterface } from "node:readline";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const crashAt = arg("crash-at", 0);
const hangAt = arg("hang-at", 0);
const illegalAt = arg("illegal-at", 0);
const spam = arg("spam", 0);
const slow = arg("slow", 0);
const speed = arg("speed", 0);
const totals = arg("totals", 0);
let seed = arg("seed", 1) >>> 0;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const out = (l) => process.stdout.write(l + "\n");
let boards = 0;
let block = null;

function onBoard(rows) {
  boards++;
  const taken = new Set(rows.map((r) => r.split(",").slice(0, 2).join(",")));
  if (crashAt && boards === crashAt) process.exit(3);
  if (hangAt && boards === hangAt) return; // 답하지 않는다
  if (illegalAt && boards === illegalAt && rows.length)
    return reply(rows[0].split(",").slice(0, 2).join(","));
  const free = [];
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 15; x++) if (!taken.has(`${x},${y}`)) free.push(`${x},${y}`);
  const pick = free[Math.floor(rnd() * free.length)];
  reply(pick);
}

function reply(move) {
  const filler = "x".repeat(100);
  for (let i = 0; i < spam; i++) out(`MESSAGE spam ${i} ${filler}`);
  if (speed) out(`MESSAGE Speed ${speed} | Depth 5-7 | Eval 0 | Node 1K | Time 10ms`);
  if (totals) {
    for (const l of [
      "INFO DEPTH 9",
      "INFO SELDEPTH 12",
      `INFO TOTALNODES ${totals / 100}`,
      "INFO TOTALTIME 10",
    ])
      out(l);
    out("MESSAGE Speed 159 | Depth 9-12 | Eval 0 | Node 1K | Time 10ms");
  }
  if (slow) setTimeout(() => out(move), slow);
  else out(move);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (raw) => {
  const line = raw.trim();
  if (!line) return;
  if (block) {
    if (/^DONE$/i.test(line)) {
      const { kind, rows } = block;
      block = null;
      if (kind === "BOARD") onBoard(rows);
    } else block.rows.push(line);
    return;
  }
  const cmd = line.split(/\s+/)[0].toUpperCase();
  if (cmd === "START" || cmd === "RESTART") out("OK");
  else if (cmd === "ABOUT") out('name="fake", version="1"');
  else if (cmd === "BOARD" || cmd === "YXBOARD") block = { kind: cmd, rows: [] };
  else if (cmd === "YXSHOWFORBID") out("FORBID .");
  else if (cmd === "END") process.exit(0);
  // INFO 등은 무시
});
rl.on("close", () => process.exit(0));
