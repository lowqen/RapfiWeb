/** openings.mjs 검사 —  node --test bench/sprt/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SYMMETRIES, canonicalKey, loadOpenings, standardOpenings } from "./openings.mjs";

test("26개 표준 개시는 대칭으로 서로 다르다", () => {
  const std = standardOpenings();
  assert.equal(Object.keys(std).length, 26);
  assert.equal(new Set(Object.values(std).map(canonicalKey)).size, 26);
});

test("대칭 변환 · 같은 색 안의 순서 바꿈은 같은 키, 색이 바뀌면 다른 키", () => {
  const pos = [
    [7, 7],
    [7, 6],
    [8, 6],
    [6, 8],
    [9, 7],
  ];
  for (const t of SYMMETRIES) assert.equal(canonicalKey(pos.map(t)), canonicalKey(pos));
  const reordered = [pos[2], pos[3], pos[0], pos[1], pos[4]]; // 흑 순서 바꿈(흑은 짝수 자리)
  assert.equal(canonicalKey(reordered), canonicalKey(pos));
  const swapped = [pos[1], pos[0], pos[3], pos[2]]; // 흑 · 백이 바뀜
  assert.notEqual(canonicalKey(swapped), canonicalKey(pos.slice(0, 4)));
});

test("개시 파일 읽기 — 형식이 틀리거나 이름이 겹치면 거절", () => {
  const ok = loadOpenings({ openings: [{ name: "a", moves: [[7, 7]] }] });
  assert.deepEqual(ok, { a: [[7, 7]] });
  assert.throws(() => loadOpenings({ openings: [] }));
  assert.throws(() => loadOpenings({ openings: [{ name: "a", moves: [] }] }));
  assert.throws(() =>
    loadOpenings({
      openings: [
        { name: "a", moves: [[7, 7]] },
        { name: "a", moves: [[7, 7]] },
      ],
    }),
  );
});
