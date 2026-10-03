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
