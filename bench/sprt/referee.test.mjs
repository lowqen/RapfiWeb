/** referee.mjs 검사 —  node --test bench/sprt/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BLACK, Board, WHITE, judgeMove } from "./referee.mjs";

/** 흑 수열 · 백 수열을 번갈아 끼운다 */
const interleave = (blacks, whites) => blacks.flatMap((b, i) => (whites[i] ? [b, whites[i]] : [b]));

test("흑 정확히 다섯은 승, 백 다섯은 승", async () => {
  const b = new Board(
    interleave(
      [
        [3, 7],
        [4, 7],
        [5, 7],
        [6, 7],
      ],
      [
        [3, 9],
        [4, 9],
        [5, 9],
        [6, 9],
      ],
    ),
  );
  assert.deepEqual(await judgeMove(b, [7, 7]), { winner: BLACK, reason: "five" });
  const w = new Board(
    interleave(
      [
        [3, 7],
        [4, 7],
        [5, 7],
        [6, 6],
        [0, 0],
      ],
      [
        [3, 9],
        [4, 9],
        [5, 9],
        [6, 9],
      ],
    ),
  );
  assert.deepEqual(await judgeMove(w, [7, 9]), { winner: WHITE, reason: "five" });
});

test("흑 장목은 금수 — 심판이 없어도 잡는다. 백 장목은 승", async () => {
  // 흑 ○○○ _ ○○ → 가운데에 두면 여섯
  const blacks = [
    [2, 7],
    [3, 7],
    [4, 7],
    [6, 7],
    [7, 7],
  ];
  const whites = [
    [2, 9],
    [3, 9],
    [4, 9],
    [6, 9],
    [7, 9],
  ];
  const b = new Board(interleave(blacks, whites));
  assert.deepEqual(await judgeMove(b, [5, 7]), { winner: WHITE, reason: "forbidden(overline)" });

  // 같은 모양을 백이 가지면(흑은 흩어 둠) 여섯이어도 백 승
  const scattered = [
    [0, 0],
    [14, 0],
    [0, 14],
    [14, 14],
    [0, 7],
    [14, 7],
  ];
  const w = new Board(interleave(scattered, blacks));
  assert.equal(w.toMove, WHITE);
  assert.deepEqual(await judgeMove(w, [5, 7]), { winner: WHITE, reason: "five" });
});

test("다섯은 금수보다 앞선다 — 심판이 금수라 해도 정확히 다섯이면 흑 승", async () => {
  const b = new Board(
    interleave(
      [
        [3, 7],
        [4, 7],
        [5, 7],
        [6, 7],
      ],
      [
        [3, 9],
        [4, 9],
        [5, 9],
        [6, 9],
      ],
    ),
  );
  const judge = { forbidden: async () => [[7, 7]] };
  assert.deepEqual(await judgeMove(b, [7, 7], judge), { winner: BLACK, reason: "five" });
});

test("심판이 금수라 한 자리에 흑이 두면 흑 패, 아니면 계속", async () => {
  const b = new Board([
    [7, 7],
    [7, 6],
    [8, 6],
  ]);
  b.place([0, 0]);
  const judge = { forbidden: async (moves) => (moves.length === 4 ? [[9, 9]] : []) };
  assert.equal(await judgeMove(new Board(b.moves), [10, 10], judge), null);
  assert.deepEqual(await judgeMove(new Board(b.moves), [9, 9], judge), {
    winner: WHITE,
    reason: "forbidden",
  });
});

test("판 밖 · 둔 자리는 둔 쪽 패, 수 제한은 비김", async () => {
  const b = new Board([
    [7, 7],
    [7, 6],
    [8, 6],
  ]);
  assert.deepEqual(await judgeMove(b, [7, 7]), { winner: BLACK, reason: "illegal" });
  assert.deepEqual(await judgeMove(b, [15, 0]), { winner: BLACK, reason: "illegal" });
  assert.equal(b.moves.length, 3);
  assert.deepEqual(await judgeMove(b, [0, 0], {}, 4), { winner: null, reason: "max-plies" });
});
