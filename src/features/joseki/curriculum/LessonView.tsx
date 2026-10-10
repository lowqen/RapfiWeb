import { useEffect, useMemo, useRef, useState } from "react";
import { BoardCanvas } from "../../../core/board/BoardCanvas";
import { emptyRender, type BoardRender } from "../../../core/board/board-renderer";
import type { TagKind } from "../../../core/board/ladder";
import {
  answer,
  expected,
  scoreOf,
  showHint,
  startQuiz,
  type QuizState,
} from "../../../core/curriculum/quiz";
import { resolveNode, textOf, type Course, type Lesson } from "../../../core/curriculum/schema";
import { ROLE_LABEL, movesTo, nodeAt, type JosekiNode } from "../../../core/joseki/tree";
import { label, moveKey, sameMove, type Move } from "../../../core/model/move";
import { useCurriculum } from "../../../data/curriculum";
import { t, useLang } from "../../../i18n/i18n";
import { useBoardStore } from "../../board/boardStore";
import { JosekiComment } from "../JosekiComment";
import { TreeView } from "../TreeView";

/**
 * 공식 커리큘럼의 레슨 하나 — **살펴보기**(트리 · 판 · 해설을 자유롭게)와 **학습**(수순을 맞히며 따라 두기,
 * `core/curriculum/quiz.ts`). 고칠 길은 없다 — 읽기 전용이다(docs/공식-정석-설계.md §4 · §5).
 */

type Mode = "browse" | "learn";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 자식 수를 판에 — 기호가 있으면 그 기호, 없으면 A · B · C. 좋은 수는 초록, 나쁜 수 · 함정은 빨강. */
function childTags(node: JosekiNode, size: number) {
  const tags = new Map<number, { label: string; kind: TagKind; winRatePct?: number }>();
  node.children.forEach((c, i) => {
    const bad = c.mark === "?" || c.mark === "??" || c.role === "trap";
    const good = i === 0 || c.mark === "!" || c.mark === "!!";
    tags.set(moveKey(c.move!, size), {
      label: c.mark ?? LETTERS[i] ?? "+",
      kind: bad ? "lose" : good ? "win" : "rate",
      winRatePct: 50,
    });
  });
  return tags;
}

export function LessonView({
  course,
  lesson,
  next,
  onBack,
  onNext,
}: {
  course: Course;
  lesson: Lesson;
  next: Lesson | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const lang = useLang((s) => s.lang);
  const root = useMemo(() => resolveNode(lesson.root, lang), [lesson.root, lang]);
  const board = useBoardStore((b) => b.render);
  const record = useCurriculum((s) => s.record);
  const best = useCurriculum((s) => s.progress[lesson.id]?.best);
  const size = 15;
  const [mode, setMode] = useState<Mode>("browse");
  const [path, setPath] = useState<number[]>([]);
  const [quiz, setQuiz] = useState<QuizState>(() => startQuiz(root, lesson.quiz.side));
  const recorded = useRef(false);

  // 레슨 · 언어가 바뀌면 처음부터.
  useEffect(() => {
    setPath([]);
    setQuiz(startQuiz(root, lesson.quiz.side));
    recorded.current = false;
  }, [root, lesson.quiz.side]);

  useEffect(() => {
    if (mode === "learn" && quiz.done && !recorded.current) {
      recorded.current = true;
      record(lesson.id, scoreOf(quiz));
    }
  }, [mode, quiz, lesson.id, record]);

  const restart = () => {
    setQuiz(startQuiz(root, lesson.quiz.side));
    recorded.current = false;
  };

  const shownPath = mode === "browse" ? path : quiz.path;
  const node = nodeAt(root, shownPath) ?? root;
  const moves = useMemo(() => movesTo(root, shownPath), [root, shownPath]);

  const render: BoardRender = useMemo(() => {
    let tags = new Map<number, { label: string; kind: TagKind; winRatePct?: number }>();
    if (mode === "browse") tags = childTags(node, size);
    else {
      const fb = quiz.feedback;
      if (fb.kind === "mistake") {
        tags.set(moveKey(fb.node.move!, size), { label: fb.node.mark ?? "✕", kind: "lose" });
        if (fb.refute) tags.set(moveKey(fb.refute, size), { label: "→", kind: "lose" });
      } else if (fb.kind === "outside") {
        tags.set(moveKey(fb.move, size), { label: "✕", kind: "lose" });
      }
      const hint = quiz.hint ? expected(root, quiz) : null;
      if (hint && !quiz.done) tags.set(moveKey(hint, size), { label: "?", kind: "win" });
    }
    return {
      ...emptyRender(size),
      palette: board.palette,
      textScale: board.textScale,
      showNumbers: board.showNumbers,
      stones: moves,
      lastMove: moves.at(-1) ?? null,
      tags,
    };
  }, [mode, node, quiz, root, moves, board.palette, board.textScale, board.showNumbers]);

  const onTap = (m: Move) => {
    if (mode === "learn") {
      setQuiz((q) => answer(root, q, m));
      return;
    }
    const i = node.children.findIndex((c) => c.move && sameMove(c.move, m));
    if (i >= 0) setPath((p) => [...p, i]);
  };

  /** 해설 속 좌표(h8)를 누르면 — 살펴보기에서 지금 줄의 그 수로. */
  const onCoord = (m: Move) => {
    if (mode !== "browse") return;
    const idx = moves.findIndex((x) => sameMove(x, m));
    if (idx >= 0) setPath(path.slice(0, idx + 1));
    else onTap(m);
  };

  const side = lesson.quiz.side === "black" ? t("흑") : t("백");
  const learnerTurn = !quiz.done && quiz.path.length % 2 === (lesson.quiz.side === "black" ? 0 : 1);

  return (
    <div className="review joseki lesson" data-k="lesson" data-lesson={lesson.id}>
      <section className="panel">
        <div className="panel__actions">
          <button type="button" onClick={onBack}>
            ← {t("코스 목록")}
          </button>
          <div className="modetabs" role="tablist" aria-label={t("레슨 모드")}>
            {(["browse", "learn"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                className="modetabs__tab"
                data-mode={m}
                aria-selected={mode === m}
                onClick={() => setMode(m)}
              >
                {m === "browse" ? t("살펴보기") : t("학습")}
              </button>
            ))}
          </div>
        </div>
        <h2 className="panel__title">
          {textOf(course.title, lang)} › {textOf(lesson.title, lang)}
          {best !== undefined && (
            <span className="panel__status tnum">{t("최고 {n}점", { n: best })}</span>
          )}
        </h2>
        <JosekiComment text={textOf(lesson.summary, lang)} />
      </section>

      <div className="jbody">
        {mode === "browse" ? (
          <section className="panel jtreebox" aria-label={t("트리")}>
            <TreeView root={root} path={path} size={size} onGo={setPath} />
            <p className="panel__hint lesson__legend">
              <span className="jtree__mark" data-quality="good">
                !
              </span>{" "}
              {t("좋은 수")} ·{" "}
              <span className="jtree__mark" data-quality="bad">
                ?
              </span>{" "}
              {t("나쁜 수")} ·{" "}
              <span className="jtree__role" data-role="trap">
                {t(ROLE_LABEL.trap)}
              </span>{" "}
              ·{" "}
              <span className="jtree__role" data-role="refute">
                {t(ROLE_LABEL.refute)}
              </span>
            </p>
          </section>
        ) : (
          <section className="panel jtreebox lesson__quiz" aria-label={t("학습")} data-k="quiz">
            <p className="panel__hint tnum" data-k="quiz-progress">
              {t("{a} / {b}수", { a: quiz.answered, b: quiz.total })} ·{" "}
              {t("당신은 {side}", { side })}
            </p>
            <progress
              className="lesson__bar"
              max={Math.max(1, quiz.total)}
              value={quiz.answered}
              aria-label={t("진행")}
            />
            <QuizFeedbackBox quiz={quiz} root={root} size={size} />
            {quiz.done ? (
              <div className="lesson__done" data-k="quiz-done" role="status">
                <p className="lesson__score tnum">
                  {t("완료 · {n}점", { n: scoreOf(quiz) })}{" "}
                  <span className="panel__status">
                    {t("첫 시도 {a}/{b}", { a: quiz.firstTry, b: quiz.answered })}
                  </span>
                </p>
                <div className="panel__actions">
                  <button type="button" onClick={restart}>
                    {t("다시 하기")}
                  </button>
                  {next && (
                    <button type="button" className="button--tonal" onClick={onNext}>
                      {t("다음 레슨")} →
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="panel__actions">
                <button
                  type="button"
                  onClick={() => setQuiz(showHint)}
                  disabled={quiz.hint || !learnerTurn}
                >
                  {t("힌트")}
                </button>
                <button type="button" onClick={restart}>
                  {t("처음부터")}
                </button>
              </div>
            )}
          </section>
        )}

        <section className="panel jboardbox" aria-label={t("판")}>
          <p className="panel__hint tnum" data-k="lesson-where">
            {moves.length === 0
              ? t("빈 판")
              : `${t("{n}수", { n: moves.length })} ${label(moves.at(-1)!, size)}`}
            {mode === "learn" && learnerTurn ? ` · ${t("{side} 차례입니다", { side })}` : ""}
          </p>
          <div className="prove__board">
            <BoardCanvas render={render} zoomable={false} keyboard onTap={onTap} />
          </div>
          {mode === "browse" && (
            <div className="panel__actions jnav">
              <button
                type="button"
                aria-label={t("처음")}
                onClick={() => setPath([])}
                disabled={path.length === 0}
              >
                |&lt;
              </button>
              <button
                type="button"
                aria-label={t("뒤로")}
                onClick={() => setPath((p) => p.slice(0, -1))}
                disabled={path.length === 0}
              >
                &lt;
              </button>
              <button
                type="button"
                aria-label={t("앞으로")}
                onClick={() => setPath((p) => [...p, 0])}
                disabled={node.children.length === 0}
              >
                &gt;
              </button>
            </div>
          )}
          {mode === "browse" && (
            <div className="jcomment" data-k="lesson-comment">
              {node.role && (
                <span className="jtree__role" data-role={node.role}>
                  {t(ROLE_LABEL[node.role])}
                </span>
              )}
              <JosekiComment
                text={node.comment || (shownPath.length === 0 ? "" : t("해설이 없습니다."))}
                onCoord={onCoord}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function QuizFeedbackBox({
  quiz,
  root,
  size,
}: {
  quiz: QuizState;
  root: JosekiNode;
  size: number;
}) {
  const fb = quiz.feedback;
  const here = nodeAt(root, quiz.path) ?? root;
  if (fb.kind === "start") {
    return (
      <div className="lesson__fb" data-k="quiz-feedback" data-kind="start">
        <JosekiComment text={here.comment || root.comment} />
      </div>
    );
  }
  if (fb.kind === "correct") {
    return (
      <div className="lesson__fb" data-k="quiz-feedback" data-kind="correct" role="status">
        <p className="lesson__verdict" data-good>
          {fb.alternative ? t("정답 · 다른 좋은 수") : t("정답")} {label(fb.node.move!, size)}
        </p>
        <JosekiComment text={fb.node.comment} />
        {!quiz.done && here !== fb.node && here.comment && <JosekiComment text={here.comment} />}
      </div>
    );
  }
  if (fb.kind === "mistake") {
    return (
      <div className="lesson__fb" data-k="quiz-feedback" data-kind="mistake" role="status">
        <p className="lesson__verdict" data-bad>
          {fb.node.role ? t(ROLE_LABEL[fb.node.role]) : t("아쉬운 수")} {label(fb.node.move!, size)}
          {fb.node.mark ?? ""}
        </p>
        <JosekiComment text={fb.node.comment} />
        {fb.refute && (
          <p className="panel__hint">{t("응징: {move}", { move: label(fb.refute, size) })}</p>
        )}
        <p className="panel__hint">{t("다시 두어 보세요.")}</p>
      </div>
    );
  }
  if (fb.kind === "outside") {
    return (
      <div className="lesson__fb" data-k="quiz-feedback" data-kind="outside" role="status">
        <p className="lesson__verdict" data-bad>
          {t("정석에 없는 수입니다")} {label(fb.move, size)}
        </p>
        <p className="panel__hint">{t("다시 두어 보세요.")}</p>
      </div>
    );
  }
  return null;
}
