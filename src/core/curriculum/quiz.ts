import { sameMove, type Move } from "../model/move";
import type { JosekiNode } from "../joseki/tree";

/**
 * 커리큘럼 학습(퀴즈) 판정 — 순수 함수(docs/공식-정석-설계.md §5). 화면은 이 상태를 들고 있다가
 * 판을 누를 때마다 `answer` 로 다음 상태를 받는다.
 *
 *   - 학습자 차례에 **추천 수**(주 변화 `[0]`)나 **좋은 수**(`!!` `!` `!?`, 함정 아님)를 두면 정답 —
 *     그 갈래로 나아가고, 상대의 주 변화 수를 저절로 둔다.
 *   - **알려진 나쁜 수**(`?!` `?` `??`)나 **함정수**(`role: "trap"`)면 오답 — 그 갈래의 해설과 응징 수
 *     (그 마디의 `[0]`)를 보여 주고 같은 자리에서 다시.
 *   - 트리에 없는 수면 «정석 밖» — 다시.
 *   - 학습자 수마다 첫 시도에 맞혔는지 센다(점수). 두 번 틀리면 힌트(추천 수 자리)를 연다.
 */

export type QuizSide = "black" | "white";

export type QuizFeedback =
  | { kind: "start" }
  | { kind: "correct"; node: JosekiNode; alternative: boolean }
  | { kind: "mistake"; node: JosekiNode; refute: Move | null }
  | { kind: "outside"; move: Move }
  | { kind: "done" };

export interface QuizState {
  side: QuizSide;
  /** 지금 마디(뿌리에서 자식 번호). */
  path: number[];
  /** 학습자가 이미 둔 수(맞힌 것)의 수. */
  answered: number;
  /** 그중 첫 시도에 맞힌 수. */
  firstTry: number;
  /** 학습자가 둘 수 전체(주 변화 기준) — 진행 막대와 점수의 분모. */
  total: number;
  /** 지금 자리에서 틀린 횟수. */
  misses: number;
  /** 힌트를 열었다(지금 자리). */
  hint: boolean;
  feedback: QuizFeedback;
  done: boolean;
}

const GOOD = new Set(["!!", "!", "!?"]);
const BAD = new Set(["?!", "?", "??"]);

const nodeAt = (root: JosekiNode, path: readonly number[]): JosekiNode => {
  let n = root;
  for (const i of path) n = n.children[i] ?? n;
  return n;
};

/** 이 자식이 학습자에게 «정답»인가. */
export function acceptable(child: JosekiNode, index: number): boolean {
  if (child.role === "trap") return false;
  if (child.mark && BAD.has(child.mark)) return false;
  return index === 0 || (child.mark !== undefined && GOOD.has(child.mark));
}

const learnerToMove = (side: QuizSide, ply: number) => (ply % 2 === 0) === (side === "black");

/** 주 변화에서 학습자가 둘 수의 수. */
export function learnerCount(
  root: JosekiNode,
  side: QuizSide,
  from: readonly number[] = [],
): number {
  let n = nodeAt(root, from);
  let ply = from.length;
  let count = 0;
  while (n.children[0]) {
    if (learnerToMove(side, ply)) count++;
    n = n.children[0];
    ply++;
  }
  return count;
}

/** 상대 차례면 주 변화 수를 저절로 둔다 — 학습자 차례이거나 끝이 될 때까지. */
function autoplay(root: JosekiNode, s: QuizState): QuizState {
  const path = [...s.path];
  for (;;) {
    const n = nodeAt(root, path);
    if (n.children.length === 0) {
      return { ...s, path, done: true };
    }
    if (learnerToMove(s.side, path.length)) return { ...s, path };
    path.push(0);
  }
}

export function startQuiz(root: JosekiNode, side: QuizSide): QuizState {
  const s: QuizState = {
    side,
    path: [],
    answered: 0,
    firstTry: 0,
    total: learnerCount(root, side),
    misses: 0,
    hint: false,
    feedback: { kind: "start" },
    done: false,
  };
  return autoplay(root, s);
}

/** 지금 자리의 추천 수(힌트). */
export function expected(root: JosekiNode, s: QuizState): Move | null {
  return nodeAt(root, s.path).children[0]?.move ?? null;
}

/** 학습자가 판을 눌렀다. */
export function answer(root: JosekiNode, s: QuizState, m: Move): QuizState {
  if (s.done) return s;
  const here = nodeAt(root, s.path);
  const i = here.children.findIndex((c) => c.move && sameMove(c.move, m));
  const child = i >= 0 ? here.children[i]! : null;
  if (child && acceptable(child, i)) {
    const next: QuizState = {
      ...s,
      path: [...s.path, i],
      answered: s.answered + 1,
      firstTry: s.firstTry + (s.misses === 0 ? 1 : 0),
      // 다른 좋은 수로 가면 그 갈래의 학습자 수로 분모를 다시 센다.
      total: i === 0 ? s.total : s.answered + 1 + learnerCount(root, s.side, [...s.path, i]),
      misses: 0,
      hint: false,
      feedback: { kind: "correct", node: child, alternative: i !== 0 },
    };
    const after = autoplay(root, next);
    return after.done ? { ...after, feedback: next.feedback } : after;
  }
  const misses = s.misses + 1;
  const feedback: QuizFeedback = child
    ? { kind: "mistake", node: child, refute: child.children[0]?.move ?? null }
    : { kind: "outside", move: m };
  return { ...s, misses, hint: s.hint || misses >= 2, feedback };
}

export const showHint = (s: QuizState): QuizState => ({ ...s, hint: true });

/** 점수(0..100) — 첫 시도에 맞힌 비율. */
export const scoreOf = (s: QuizState): number =>
  s.answered === 0 ? 0 : Math.round((s.firstTry / s.answered) * 100);
