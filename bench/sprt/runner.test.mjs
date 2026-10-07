/**
 * 러너 통합 시험 — 진짜 runner.mjs 를 가짜 엔진(fake-engine.mjs)으로 돌려 오류 처리를 확인한다.
 *   node --test bench/sprt/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(HERE, "runner.mjs");
const FAKE = `node "${resolve(HERE, "fake-engine.mjs")}"`;

function run(a, b, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), "sprt-"));
  const out = join(dir, "games.jsonl");
  try {
    const r = spawnSync(
      process.execPath,
      [
        RUNNER,
        "--a",
        a,
        "--b",
        b,
        "--referee",
        "none",
        "--max-plies",
        "30",
        "--out",
        out,
        ...extra,
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    const games = (() => {
      try {
        return readFileSync(out, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    })();
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, games };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const noLeak = (r) => assert.match(r.stdout, /남은 엔진 0 · 남은 자식 핸들 0/, r.stdout + r.stderr);

test("정상 — 수 제한 비김까지 두고, 쌍이 모두 오각으로 들어간다", () => {
  const r = run(`${FAKE} --seed 1`, `${FAKE} --seed 2`, ["--games", "4", "--tc", "turn=200"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.games.length, 4);
  assert.match(r.stdout, /오각\(쌍 2\)/);
  noLeak(r);
});

test("출력 폭주 — 수마다 ~1MB 를 찍어도 파이프가 막히지 않는다", () => {
  const r = run(`${FAKE} --seed 3 --spam 10000`, `${FAKE} --seed 4 --spam 10000`, [
    "--games",
    "2",
    "--tc",
    "turn=2000",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.games.length, 2);
  assert.ok(
    r.games.every((g) => g.reason !== "timeout"),
    JSON.stringify(r.games.map((g) => g.reason)),
  );
  noLeak(r);
});

test("크래시 — 그 판은 크래시 낸 쪽이 지고, 다음 판은 새 프로세스로 이어 간다", () => {
  const r = run(`${FAKE} --seed 5 --crash-at 3`, `${FAKE} --seed 6`, [
    "--games",
    "4",
    "--tc",
    "turn=200",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.games.length, 4);
  for (const g of r.games) {
    assert.equal(g.reason, "crash");
    assert.equal(g.loser, "A");
  }
  noLeak(r);
});

test("멈춤 — 수당 시간 + 유예를 넘기면 시간 초과 패, 멈춘 프로세스는 죽이고 갈아 끼운다", () => {
  const r = run(`${FAKE} --seed 7`, `${FAKE} --seed 8 --hang-at 3`, [
    "--games",
    "2",
    "--tc",
    "turn=100,grace=300",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.games.length, 2);
  for (const g of r.games) {
    assert.equal(g.reason, "timeout");
    assert.equal(g.loser, "B");
  }
  noLeak(r);
});

test("불법 수 — 이미 돌이 있는 자리를 두면 둔 쪽 패", () => {
  const r = run(`${FAKE} --seed 9 --illegal-at 3`, `${FAKE} --seed 10`, [
    "--games",
    "2",
    "--tc",
    "turn=200",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(
    r.games.some((g) => g.reason === "illegal" && g.loser === "A"),
    JSON.stringify(r.games),
  );
  noLeak(r);
});

test("띄울 수 없는 엔진 — 치명적 오류로 1 을 돌려준다(매달리지 않는다)", () => {
  const r = run("no-such-engine-xyz", `${FAKE}`, ["--games", "2"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /띄우지 못했습니다/);
  noLeak(r);
});

test("엔진별 시간 제어 — 같은 느린 엔진이 넉넉한 A 는 버티고 빠듯한 B 는 시간 초과로 진다", () => {
  const slow = `${FAKE} --slow 300`;
  const r = run(slow, slow, ["--games", "2", "--a-tc", "turn=2000", "--b-tc", "turn=50,grace=100"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.games.length, 2);
  for (const g of r.games) {
    assert.equal(g.reason, "timeout");
    assert.equal(g.loser, "B");
  }
  assert.match(r.stdout, /A 수당 2000ms · 유예 2000ms \/ B 수당 50ms · 유예 100ms/);
  noLeak(r);
});

test("시간 예산 — 넘으면 새 쌍을 시작하지 않고, 시작한 쌍은 마저 두고 끝낸다", () => {
  const r = run(`${FAKE} --seed 11 --slow 30`, `${FAKE} --seed 12 --slow 30`, [
    "--games",
    "200",
    "--tc",
    "turn=500",
    "--max-minutes",
    "0.02",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.games.length > 0 && r.games.length < 200, String(r.games.length));
  assert.equal(r.games.length % 2, 0, "쌍이 반쪽으로 남지 않는다");
  assert.match(r.stdout, /시간 예산에서 멈춤/);
  noLeak(r);
});

test("SPRT 결정 — 경계를 넘은 순간을 보고하고, 시작한 쌍을 마저 둔 뒤에도 결정으로 남는다", () => {
  // α=β=0.49 면 경계가 ±0.04 — 몇 쌍 만에 넘는다(어느 쪽이든)
  const r = run(`${FAKE} --seed 21`, `${FAKE} --seed 22`, [
    "--games",
    "400",
    "--tc",
    "turn=200",
    "--alpha",
    "0.49",
    "--beta",
    "0.49",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.games.length < 400, String(r.games.length));
  assert.match(r.stdout, /→ H[01] 채택 — A 가 elo [≥≤] -?\d+ 쪽 \(\d+판에서 경계를 넘음/);
  assert.doesNotMatch(r.stdout, /결정 전/);
  noLeak(r);
});

test("고정 판 수(--fixed) — SPRT 가 경계를 넘어도 --games 까지 두고, 결정은 그 순간으로 남는다", () => {
  const r = run(`${FAKE} --seed 21`, `${FAKE} --seed 22`, [
    "--games",
    "40",
    "--tc",
    "turn=200",
    "--alpha",
    "0.49",
    "--beta",
    "0.49",
    "--fixed",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.games.length, 40);
  assert.match(r.stdout, /고정 판 수\(--fixed\)라 40판까지 계속 둡니다/);
  assert.match(r.stdout, /\d+판에서 경계를 넘음 · LLR -?[\d.]+; 고정 판 수로 끝까지 둔 뒤/);
  noLeak(r);
});

test("탐색 통계 — 엔진의 요약 줄(MESSAGE Speed …)에서 엔진별 NPS · 깊이를 모은다(예열 수는 빼고)", () => {
  const r = run(`${FAKE} --seed 31 --speed 20000`, `${FAKE} --seed 32 --speed 10000`, [
    "--games",
    "2",
    "--tc",
    "turn=200",
  ]);
  assert.equal(r.status, 0, r.stderr);
  const plies = r.games.reduce((n, g) => n + g.plies, 0);
  const a = /탐색 A A: (\d+)수 · NPS 20,000 · 깊이 5\.00\(선택 7\.00\) · 수당 10ms/.exec(r.stdout);
  const b = /탐색 B B: (\d+)수 · NPS 10,000 · 깊이 5\.00/.exec(r.stdout);
  assert.ok(a && b, r.stdout);
  // 개시 3수는 엔진이 두지 않았다. 판마다 끝의 수(승리 · 수 제한)까지 포함해 대국 수만 센다.
  assert.equal(Number(a[1]) + Number(b[1]), plies - 3 * r.games.length);
  noLeak(r);
});

test("탐색 통계 — INFO TOTALNODES · TOTALTIME 이 있으면 그것을 쓴다(멀티 빌드의 엉터리 Speed 줄은 버린다)", () => {
  const r = run(`${FAKE} --seed 41 --totals 30000`, `${FAKE} --seed 42 --speed 10000`, [
    "--games",
    "2",
    "--tc",
    "turn=200",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /탐색 A A: \d+수 · NPS 30,000 · 깊이 9\.00\(선택 12\.00\)/, r.stdout);
  assert.match(r.stdout, /탐색 B B: \d+수 · NPS 10,000 · 깊이 5\.00/, r.stdout);
  noLeak(r);
});
