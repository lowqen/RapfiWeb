import { useEffect, useMemo, useState } from "react";
import { BoardCanvas } from "../../../core/board/BoardCanvas";
import { emptyRender, type BoardRender } from "../../../core/board/board-renderer";
import type { TagKind } from "../../../core/board/ladder";
import type { Issue } from "../../../core/curriculum/audit";
import { courseIds, idProblem, lessonIds, lessonOf, nameOf } from "../../../core/curriculum/edit";
import { lessonUrl } from "../../../core/curriculum/link";
import {
  LEVELS,
  learnerMoves,
  resolveNode,
  textOf,
  withLang,
  type Course,
  type Lesson,
  type Level,
} from "../../../core/curriculum/schema";
import { movesText } from "../../../core/joseki/parse";
import {
  MARKS,
  MARK_LABEL,
  ROLES,
  ROLE_LABEL,
  countNodes,
  movesTo,
  nodeAt,
  type JosekiMark,
  type JosekiRole,
} from "../../../core/joseki/tree";
import { label, moveKey } from "../../../core/model/move";
import { msg, t } from "../../../i18n/i18n";
import { useBoardStore } from "../../board/boardStore";
import { LessonView } from "../curriculum/LessonView";
import { JosekiComment } from "../JosekiComment";
import { useJosekiStore } from "../josekiStore";
import { TreeView } from "../TreeView";
import { DraftField, IssueList, TextPair } from "./StudioParts";
import { useStudio } from "./studioStore";

const LEVEL_LABEL: Record<Level, string> = {
  beginner: msg("입문"),
  intermediate: msg("중급"),
  advanced: msg("고급"),
};
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const ko = (x: Parameters<typeof textOf>[0]) => textOf(x, "ko");
const en = (x: Parameters<typeof textOf>[0]) => (typeof x === "object" ? (x.en ?? "") : "");

/** 지우기 단추 — 한 번 더 눌러야 지운다. */
function DangerButton({
  label,
  confirm,
  onConfirm,
}: {
  label: string;
  confirm: string;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return asking ? (
    <>
      <button type="button" className="btn--danger" onClick={onConfirm}>
        {confirm}
      </button>
      <button type="button" autoFocus onClick={() => setAsking(false)}>
        {t("취소")}
      </button>
    </>
  ) : (
    <button type="button" className="btn--danger" onClick={() => setAsking(true)}>
      {label}
    </button>
  );
}

/** «내 정석» 한 벌을 이 코스의 레슨으로. */
export function ImportTree({ courseId }: { courseId: string }) {
  const list = useJosekiStore((s) => s.list);
  const loaded = useJosekiStore((s) => s.loaded);
  const importTree = useStudio((s) => s.importTree);
  const [pick, setPick] = useState("");
  useEffect(() => {
    if (!loaded) void useJosekiStore.getState().load();
  }, [loaded]);
  if (list.length === 0)
    return (
      <p className="panel__hint">
        {t("내 정석이 없습니다. 정석 ▸ 내 정석에서 먼저 쓰면 여기서 레슨으로 가져옵니다")}
      </p>
    );
  const tree = list.find((x) => x.id === pick);
  return (
    <div className="panel__actions">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        aria-label={t("가져올 내 정석")}
      >
        <option value="">{t("내 정석 고르기")}</option>
        {list.map((x) => (
          <option key={x.id} value={x.id}>
            {x.title || t("제목 없음")} ({t("{n}수", { n: countNodes(x.root) })})
          </option>
        ))}
      </select>
      <button type="button" disabled={!tree} onClick={() => tree && importTree(tree, courseId)}>
        {t("레슨으로 가져오기")}
      </button>
    </div>
  );
}

// ── 코스 ─────────────────────────────────────────────────────────────

export function CourseEditor({ course, issues }: { course: Course; issues: Issue[] }) {
  const s = useStudio();
  const file = s.file;
  const at = file.courses.findIndex((c) => c.id === course.id);
  return (
    <div className="studio__editor" data-k="studio-course">
      <section className="panel">
        <h2 className="panel__title">{t("코스")}</h2>
        <div className="sform">
          <label className="sfield">
            <span className="sfield__label">{t("코스 id")}</span>
            <DraftField
              key={`cid:${course.id}`}
              label={t("코스 id")}
              value={course.id}
              check={(v) => {
                const why = idProblem(v, course.id, courseIds(file));
                return why ? t(why) : null;
              }}
              onCommit={(v) => s.patchCourse(course.id, { id: v })}
            />
          </label>
          <p className="panel__hint">
            {t("id 는 링크 주소(?course=)입니다. 배포한 뒤에는 바꾸지 마세요")}
          </p>
          <TextPair
            label={t("제목")}
            ko={ko(course.title)}
            en={en(course.title)}
            onCommit={(lang, v) =>
              s.patchCourse(course.id, { title: withLang(course.title, lang, v) })
            }
          />
          <label className="sfield">
            <span className="sfield__label">{t("수준")}</span>
            <select
              value={course.level}
              onChange={(e) => s.patchCourse(course.id, { level: e.target.value as Level })}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(LEVEL_LABEL[l])}
                </option>
              ))}
            </select>
          </label>
          <TextPair
            label={t("설명")}
            multiline
            ko={ko(course.summary)}
            en={en(course.summary)}
            onCommit={(lang, v) =>
              s.patchCourse(course.id, { summary: withLang(course.summary, lang, v) })
            }
          />
        </div>
        <div className="panel__actions">
          <button type="button" className="button--tonal" onClick={() => s.newLesson(course.id)}>
            {t("레슨 추가")}
          </button>
          <button type="button" disabled={at <= 0} onClick={() => s.shiftCourse(course.id, -1)}>
            {t("위로")}
          </button>
          <button
            type="button"
            disabled={at < 0 || at >= file.courses.length - 1}
            onClick={() => s.shiftCourse(course.id, 1)}
          >
            {t("아래로")}
          </button>
          <DangerButton
            label={t("코스 지우기")}
            confirm={t("레슨 {n}개와 함께 지우기", { n: course.lessons.length })}
            onConfirm={() => s.deleteCourse(course.id)}
          />
        </div>
      </section>

      <section className="panel">
        <h3 className="panel__title">{t("내 정석에서 가져오기")}</h3>
        <ImportTree courseId={course.id} />
      </section>

      <section className="panel">
        <h3 className="panel__title">{t("검사")}</h3>
        <IssueList issues={issues} />
      </section>
    </div>
  );
}

// ── 레슨 ─────────────────────────────────────────────────────────────

export function LessonEditor({ lesson, issues }: { lesson: Lesson; issues: Issue[] }) {
  const s = useStudio();
  const found = lessonOf(s.file, lesson.id)!;
  const [preview, setPreview] = useState(false);
  const [mode, setMode] = useState<"browse" | "learn">("learn");
  const [copied, setCopied] = useState(false);

  if (preview) {
    return (
      <div className="studio__editor" data-k="studio-preview">
        <div className="panel__actions">
          <button type="button" className="button--tonal" onClick={() => setPreview(false)}>
            {t("미리 보기 닫기")}
          </button>
          <span className="panel__hint">{t("배포했을 때의 화면입니다. 진도는 남지 않습니다")}</span>
        </div>
        <LessonView
          course={found.course}
          lesson={lesson}
          index={found.index}
          next={null}
          mode={mode}
          onMode={setMode}
          onBack={() => setPreview(false)}
          onNext={() => undefined}
          preview
        />
      </div>
    );
  }

  const copyLink = async () => {
    const url = lessonUrl(location.origin, import.meta.env.BASE_URL, lesson.id, "browse");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t("이 레슨의 링크입니다. 복사해 쓰세요"), url);
    }
  };
  const list = found.course.lessons;

  return (
    <div className="studio__editor" data-k="studio-lesson">
      <section className="panel">
        <h2 className="panel__title">
          {t("레슨")} <span className="panel__hint">{nameOf(found.course)}</span>
        </h2>
        <div className="sform">
          <label className="sfield">
            <span className="sfield__label">{t("레슨 id")}</span>
            <DraftField
              key={`lid:${lesson.id}`}
              label={t("레슨 id")}
              value={lesson.id}
              check={(v) => {
                const why = idProblem(v, lesson.id, lessonIds(s.file));
                return why ? t(why) : null;
              }}
              onCommit={(v) => s.patchLesson(lesson.id, { id: v })}
            />
          </label>
          <p className="panel__hint">
            {t(
              "id 는 링크 주소(?lesson=)이자 사용자 진도의 열쇠입니다. 배포한 뒤에는 바꾸지 마세요",
            )}
          </p>
          <TextPair
            label={t("제목")}
            ko={ko(lesson.title)}
            en={en(lesson.title)}
            onCommit={(lang, v) =>
              s.patchLesson(lesson.id, { title: withLang(lesson.title, lang, v) })
            }
          />
          <TextPair
            label={t("요약")}
            multiline
            rows={2}
            ko={ko(lesson.summary)}
            en={en(lesson.summary)}
            onCommit={(lang, v) =>
              s.patchLesson(lesson.id, { summary: withLang(lesson.summary, lang, v) })
            }
          />
          <label className="sfield">
            <span className="sfield__label">{t("학습자")}</span>
            <select
              value={lesson.quiz.side}
              onChange={(e) =>
                s.patchLesson(lesson.id, { quiz: { side: e.target.value as "black" | "white" } })
              }
            >
              <option value="black">{t("흑")}</option>
              <option value="white">{t("백")}</option>
            </select>
          </label>
          <label className="sfield">
            <span className="sfield__label">{t("코스")}</span>
            <select
              value={found.course.id}
              onChange={(e) => s.moveLessonToCourse(lesson.id, e.target.value)}
            >
              {s.file.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {nameOf(c)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="panel__actions">
          <button
            type="button"
            className="button--tonal"
            data-k="studio-preview-open"
            onClick={() => setPreview(true)}
          >
            {t("미리 보기")}
          </button>
          <button
            type="button"
            disabled={found.index <= 0}
            onClick={() => s.shiftLesson(lesson.id, -1)}
          >
            {t("위로")}
          </button>
          <button
            type="button"
            disabled={found.index >= list.length - 1}
            onClick={() => s.shiftLesson(lesson.id, 1)}
          >
            {t("아래로")}
          </button>
          <button type="button" onClick={() => s.copyLesson(lesson.id)}>
            {t("사본 만들기")}
          </button>
          <button type="button" onClick={() => void copyLink()}>
            {copied ? t("링크를 복사했습니다") : t("링크 복사")}
          </button>
          <DangerButton
            label={t("레슨 지우기")}
            confirm={t("{n}수와 함께 지우기", { n: countNodes(lesson.root) })}
            onConfirm={() => s.deleteLesson(lesson.id)}
          />
        </div>
      </section>

      <LessonTree lesson={lesson} />

      <section className="panel">
        <h3 className="panel__title">{t("검사")}</h3>
        <IssueList issues={issues} />
      </section>
    </div>
  );
}

/** 레슨의 트리 — 판 · 트리 · 마디 도구 · 두 언어 해설. «내 정석» 편집기와 같은 손놀림이다. */
function LessonTree({ lesson }: { lesson: Lesson }) {
  const s = useStudio();
  const board = useBoardStore((b) => b.render);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<"ko" | "en" | null>(null);
  const size = 15;
  const shown = useMemo(() => resolveNode(lesson.root, "ko"), [lesson.root]);
  const raw = nodeAt(lesson.root, s.path) ?? lesson.root;
  const node = nodeAt(shown, s.path) ?? shown;
  const moves = useMemo(() => movesTo(lesson.root, s.path), [lesson.root, s.path]);
  const learner = learnerMoves(lesson.root, lesson.quiz.side);
  // 지금 마디의 다음 수를 누가 두나 — 학습자 차례면 이 마디의 자식이 «문제»다.
  const blackToMove = moves.length % 2 === 0;
  const learnerToMove = blackToMove === (lesson.quiz.side === "black");

  const render: BoardRender = useMemo(() => {
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
    return {
      ...emptyRender(size),
      palette: board.palette,
      textScale: board.textScale,
      showNumbers: board.showNumbers,
      stones: moves,
      lastMove: moves.at(-1) ?? null,
      tags,
    };
  }, [node, moves, board.palette, board.textScale, board.showNumbers]);

  // 키보드: ← → Home End — 입력칸에서는 글자 이동이 먼저다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const st = useStudio.getState();
      if (e.key === "ArrowLeft") st.back();
      else if (e.key === "ArrowRight") st.forward();
      else if (e.key === "Home") st.first();
      else if (e.key === "End") st.last();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const where =
    moves.length === 0
      ? t("뿌리(첫 화면)")
      : `${t("{n}수", { n: moves.length })} ${label(moves.at(-1)!, size)}`;

  return (
    <div className="jbody">
      <section className="panel jtreebox" aria-label={t("트리")}>
        <TreeView root={shown} path={s.path} size={size} onGo={s.go} />
        <p className="panel__hint tnum">
          {t("{n}수 · 학습자가 둘 수 {k}개", { n: countNodes(lesson.root), k: learner })}
        </p>
      </section>

      <section className="panel jboardbox" aria-label={t("판")}>
        <p className="panel__hint tnum" data-k="studio-where">
          {where} ·{" "}
          {learnerToMove
            ? t("다음은 학습자 차례(정답을 고르는 수)")
            : t("다음은 상대 차례(저절로 두는 수)")}
        </p>
        <div className="prove__board">
          <BoardCanvas render={render} zoomable={false} keyboard onTap={s.play} />
        </div>
        <div className="panel__actions jnav">
          <button
            type="button"
            aria-label={t("처음")}
            onClick={s.first}
            disabled={s.path.length === 0}
          >
            |&lt;
          </button>
          <button
            type="button"
            aria-label={t("뒤로")}
            onClick={s.back}
            disabled={s.path.length === 0}
          >
            &lt;
          </button>
          <button
            type="button"
            aria-label={t("앞으로")}
            onClick={s.forward}
            disabled={node.children.length === 0}
          >
            &gt;
          </button>
          <button
            type="button"
            aria-label={t("끝")}
            onClick={s.last}
            disabled={node.children.length === 0}
          >
            &gt;|
          </button>
          {node.children.length > 1 && (
            <select
              aria-label={t("갈래 고르기")}
              value=""
              onChange={(e) => s.go([...s.path, Number(e.target.value)])}
            >
              <option value="" disabled>
                {t("갈래 ({n})", { n: node.children.length })}
              </option>
              {node.children.map((c, i) => (
                <option key={i} value={i}>
                  {LETTERS[i]}. {label(c.move!, size)}
                  {c.mark ?? ""}
                  {i === 0 ? ` (${t("주 변화")})` : ""}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={s.addBoardLine}
            title={t("보드 탭에 놓인 수순을 뿌리부터 넣습니다")}
          >
            {t("보드의 수순 넣기")}
          </button>
        </div>

        <form
          className="jtext"
          onSubmit={(e) => {
            e.preventDefault();
            if (s.addText(text)) setText("");
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("수순 넣기: h8 i9 j10 (지금 마디부터)")}
            aria-label={t("수순 글")}
          />
          <button type="submit" disabled={!text.trim()}>
            {t("넣기")}
          </button>
        </form>

        {s.path.length > 0 && (
          <>
            <div className="jmarks" role="radiogroup" aria-label={t("평가 기호")}>
              {MARKS.map((mk: JosekiMark) => (
                <button
                  key={mk}
                  type="button"
                  role="radio"
                  aria-checked={raw.mark === mk}
                  title={MARK_LABEL[mk]}
                  aria-label={`${mk} ${MARK_LABEL[mk]}`}
                  className={`chip${raw.mark === mk ? " is-on" : ""}`}
                  onClick={() => s.setNodeMark(raw.mark === mk ? null : mk)}
                >
                  {mk}
                </button>
              ))}
            </div>
            <div className="jmarks" role="group" aria-label={t("갈래 쓰임")}>
              {ROLES.map((r: JosekiRole) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={raw.role === r}
                  className={`chip${raw.role === r ? " is-on" : ""}`}
                  onClick={() => s.setNodeRole(raw.role === r ? null : r)}
                >
                  {t(ROLE_LABEL[r])}
                </button>
              ))}
            </div>
            <p className="panel__hint">
              {t(
                "주 변화([0])가 추천 수입니다. !! ! !? 는 다른 정답, ?! ? ?? 와 함정수는 오답으로 학습합니다. 응징은 나쁜 수의 첫 자식으로 둡니다",
              )}
            </p>
            <div className="panel__actions">
              <button type="button" onClick={s.promote} disabled={s.path.every((i) => i === 0)}>
                {t("주 변화로")}
              </button>
              <button type="button" onClick={() => s.shift(-1)} disabled={s.path.at(-1) === 0}>
                {t("갈래 앞으로")}
              </button>
              <button
                type="button"
                onClick={() => s.shift(1)}
                disabled={
                  (nodeAt(lesson.root, s.path.slice(0, -1))?.children.length ?? 0) - 1 <=
                  (s.path.at(-1) ?? 0)
                }
              >
                {t("갈래 뒤로")}
              </button>
              <DangerButton
                key={s.path.join(".")}
                label={t("이 수부터 지우기")}
                confirm={t("{n}수 지우기", { n: countNodes(raw) + 1 })}
                onConfirm={s.deleteNode}
              />
            </div>
          </>
        )}

        <div className="jcomment">
          <div className="jcomment__bar">
            <span className="panel__hint">
              {s.path.length ? t("이 수의 해설") : t("첫 해설(레슨을 열면 보이는 글)")}
            </span>
            <button
              type="button"
              aria-pressed={preview === "ko"}
              onClick={() => setPreview((p) => (p === "ko" ? null : "ko"))}
            >
              {t("한국어 미리 보기")}
            </button>
            <button
              type="button"
              aria-pressed={preview === "en"}
              onClick={() => setPreview((p) => (p === "en" ? null : "en"))}
            >
              {t("영어 미리 보기")}
            </button>
          </div>
          {preview ? (
            <div className="jcomment__view" data-k="studio-comment-view">
              <JosekiComment text={textOf(raw.comment, preview)} onCoord={() => undefined} />
            </div>
          ) : (
            <TextPair
              key={`${lesson.id}:${s.path.join(".")}`}
              label={t("해설")}
              multiline
              live
              rows={5}
              ko={ko(raw.comment)}
              en={en(raw.comment)}
              onCommit={(lang, v) => s.setNodeText(lang, v)}
            />
          )}
          <p className="panel__hint">
            {t(
              "마크다운: **굵게**, *기울임*, 줄 앞에 하이픈을 붙이면 목록, [글](주소). 좌표(h8)는 누르면 그 수로 갑니다",
            )}
          </p>
        </div>
        <p className="panel__hint tnum">{moves.length ? movesText(moves) : ""}</p>
      </section>
    </div>
  );
}
