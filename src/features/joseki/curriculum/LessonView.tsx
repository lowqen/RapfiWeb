import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { lessonUrl, type LessonMode } from "../../../core/curriculum/link";
import { resolveNode, textOf, type Course, type Lesson } from "../../../core/curriculum/schema";
import { ROLE_LABEL, movesTo, nodeAt, type JosekiNode } from "../../../core/joseki/tree";
import { label, moveKey, sameMove, type Move } from "../../../core/model/move";
import { useCurriculum } from "../../../data/curriculum";
import { t, useLang } from "../../../i18n/i18n";
import { useBoardStore } from "../../board/boardStore";
import { JosekiComment } from "../JosekiComment";
import { Icon } from "../../../components/icons";
import { ICON } from "../../../components/icon-paths";
import { TreeView } from "../TreeView";

/**
 * 공식 커리큘럼의 레슨 하나 — **살펴보기**(트리 · 판 · 해설을 자유롭게)와 **학습**(수순을 맞히며 따라 두기,
 * `core/curriculum/quiz.ts`). 고칠 길은 없다 — 읽기 전용이다(docs/공식-정석-설계.md §4 · §5).
 *
 * **배치는 체스닷컴 레슨 화면을 따른다**(UI 개편): 판이 왼쪽에서 크게, 오른쪽 칸은 위에서부터 ← · 코스 ›
 * 레슨 제목 · 모드 탭 · 코치 말풍선(둘 차례 + 해설/판정) · 바닥(진행 막대 · 힌트 · 처음부터 · 링크 · 수 이동).
 * 휴대폰 세로에서는 판이 위, 칸이 아래로 쌓인다.
 */

type Mode = LessonMode;
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
  index,
  next,
  mode,
  onMode,
  onBack,
  onNext,
}: {
  course: Course;
  lesson: Lesson;
  /** 코스 안의 몇 번째 레슨(0부터) — 제목의 번호. */
  index: number;
  next: Lesson | null;
  mode: Mode;
  onMode: (m: Mode) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const lang = useLang((s) => s.lang);
  const root = useMemo(() => resolveNode(lesson.root, lang), [lesson.root, lang]);
  const board = useBoardStore((b) => b.render);
  const record = useCurriculum((s) => s.record);
  const best = useCurriculum((s) => s.progress[lesson.id]?.best);
  const size = 15;
  const [copied, setCopied] = useState(false);
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

  const copyLink = async () => {
    const url = lessonUrl(location.origin, import.meta.env.BASE_URL, lesson.id, mode);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드를 쓸 수 없는 곳(보안 맥락이 아님 · 권한 거부) — 직접 복사하게 보여 준다.
      window.prompt(t("이 레슨의 링크입니다. 복사해 쓰세요"), url);
    }
  };

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
  /** 지금 둘 차례 — 말풍선 머리의 돌 칩. */
  const toMove = moves.length % 2 === 0 ? "black" : "white";
  /** 살펴보기의 «끝으로» — 지금 마디에서 주 변화를 끝까지. */
  const toEnd = () => {
    const p = [...path];
    for (let n = node; n.children[0]; n = n.children[0]) p.push(0);
    setPath(p);
  };
  const linkLabel = copied ? t("링크를 복사했습니다") : t("링크 복사");

  return (
    <div className="lesson" data-k="lesson" data-lesson={lesson.id} data-mode={mode}>
      <div className="lesson__stage">
        <div className="lesson__board">
          <BoardCanvas render={render} zoomable={false} keyboard onTap={onTap} />
        </div>
      </div>

      <aside className="lessonpanel" aria-label={textOf(lesson.title, lang)}>
        <header className="lessonpanel__head">
          <button
            type="button"
            className="iconbtn"
            aria-label={t("코스로 돌아가기")}
            onClick={onBack}
          >
            <Icon d={ICON.back} />
          </button>
          <div className="lessonpanel__titles">
            <span className="lessonpanel__crumb">{textOf(course.title, lang)}</span>
            <h2 className="lessonpanel__title">
              <span className="tnum">{index + 1}.</span> {textOf(lesson.title, lang)}
            </h2>
          </div>
          {best !== undefined && (
            <span className="lessonpanel__best tnum">{t("최고 {n}점", { n: best })}</span>
          )}
        </header>

        <div className="lessontabs" role="tablist" aria-label={t("레슨 모드")}>
          {(["browse", "learn"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              className="lessontabs__tab"
              data-mode={m}
              aria-selected={mode === m}
              onClick={() => onMode(m)}
            >
              {m === "browse" ? t("살펴보기") : t("학습")}
            </button>
          ))}
        </div>

        <div className="lessonpanel__body">
          {mode === "browse" ? (
            <>
              <Coach side={toMove} where={whereText(moves, size)}>
                <div className="jcomment" data-k="lesson-comment">
                  {node.role && (
                    <span className="jtree__role" data-role={node.role}>
                      {t(ROLE_LABEL[node.role])}
                    </span>
                  )}
                  <JosekiComment
                    text={
                      node.comment ||
                      (shownPath.length === 0
                        ? textOf(lesson.summary, lang)
                        : t("해설이 없습니다."))
                    }
                    onCoord={onCoord}
                  />
                </div>
              </Coach>
              <section className="lesson__tree" aria-label={t("트리")}>
                <h3 className="lesson__sub">{t("수순")}</h3>
                <TreeView root={root} path={path} size={size} onGo={setPath} />
                <p className="lesson__legend">
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
            </>
          ) : (
            <div className="lesson__quiz" data-k="quiz">
              <Coach side={toMove} where={quiz.done ? t("완료") : t("당신은 {side}", { side })}>
                <QuizFeedbackBox quiz={quiz} root={root} size={size} />
              </Coach>
              {quiz.done && (
                <div className="lesson__done" data-k="quiz-done" role="status">
                  <p className="lesson__score tnum">{t("완료 · {n}점", { n: scoreOf(quiz) })}</p>
                  <p className="lesson__firsttry tnum">
                    {t("첫 시도 {a}/{b}", { a: quiz.firstTry, b: quiz.answered })}
                  </p>
                  <div className="lesson__doneactions">
                    {next && (
                      <button type="button" className="cta" onClick={onNext}>
                        {t("다음 레슨")}
                      </button>
                    )}
                    <button type="button" className="ghostbtn" onClick={restart}>
                      {t("다시 하기")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="lessonpanel__foot">
          {mode === "learn" ? (
            <>
              <p className="lessonpanel__progress tnum" data-k="quiz-progress">
                <span>{t("{a} / {b}수", { a: quiz.answered, b: quiz.total })}</span>
              </p>
              <progress
                className="lesson__bar"
                max={Math.max(1, quiz.total)}
                value={quiz.answered}
                aria-label={t("진행")}
              />
              {!quiz.done && (
                <div className="lessonpanel__actions">
                  <button
                    type="button"
                    className="tilebtn"
                    onClick={() => setQuiz(showHint)}
                    disabled={quiz.hint || !learnerTurn}
                  >
                    <Icon d={ICON.hint} />
                    {t("힌트")}
                  </button>
                  <button type="button" className="tilebtn" onClick={restart}>
                    <Icon d={ICON.restart} />
                    {t("처음부터")}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="lessonpanel__progress tnum" data-k="lesson-where">
              <span>{whereText(moves, size)}</span>
            </p>
          )}
          <div className="lessonpanel__tools">
            <button
              type="button"
              className="iconbtn"
              data-k="lesson-copy-link"
              aria-label={linkLabel}
              title={linkLabel}
              data-copied={copied || undefined}
              onClick={() => void copyLink()}
            >
              <Icon d={copied ? ICON.check : ICON.link} />
            </button>
            {mode === "browse" && (
              <div className="lessonpanel__nav">
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={t("처음")}
                  onClick={() => setPath([])}
                  disabled={path.length === 0}
                >
                  <Icon d={ICON.first} />
                </button>
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={t("뒤로")}
                  onClick={() => setPath((p) => p.slice(0, -1))}
                  disabled={path.length === 0}
                >
                  <Icon d={ICON.prev} />
                </button>
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={t("앞으로")}
                  onClick={() => setPath((p) => [...p, 0])}
                  disabled={node.children.length === 0}
                >
                  <Icon d={ICON.next} />
                </button>
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={t("끝으로")}
                  onClick={toEnd}
                  disabled={node.children.length === 0}
                >
                  <Icon d={ICON.last} />
                </button>
              </div>
            )}
          </div>
        </footer>
      </aside>
    </div>
  );
}

/** 말풍선 머리의 «어디» — 빈 판이면 시작 국면, 아니면 수 번호와 마지막 수. */
function whereText(moves: readonly Move[], size: number): string {
  return moves.length === 0
    ? t("시작 국면")
    : `${t("{n}수", { n: moves.length })} ${label(moves.at(-1)!, size)}`;
}

/**
 * 코치 말풍선 — 체스닷컴 레슨의 «선생님 + 말풍선» 자리. 머리에 둘 차례 돌과 짧은 상황, 몸에 해설 · 판정.
 * 선생님 그림은 돌 두 알을 겹친 원이다(사람 얼굴을 지어내지 않는다).
 */
function Coach({
  side,
  where,
  children,
}: {
  side: "black" | "white";
  where: string;
  children: ReactNode;
}) {
  return (
    <div className="coach">
      <svg className="coach__avatar" viewBox="0 0 40 40" aria-hidden="true">
        <circle className="coach__bg" cx="20" cy="20" r="20" />
        <circle className="books__black" cx="16" cy="18" r="8" />
        <circle className="books__white" cx="25" cy="23" r="8" />
      </svg>
      <div className="coach__bubble">
        <p className="coach__head">
          <span className="coach__stone" data-side={side} aria-hidden="true" />
          {side === "black" ? t("흑 차례") : t("백 차례")}
          <span className="coach__where tnum">{where}</span>
        </p>
        {children}
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
