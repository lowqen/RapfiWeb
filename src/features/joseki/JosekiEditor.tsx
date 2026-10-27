import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { downloadBlob } from "../../app/download";
import { GradeBadge } from "../../components/GradeBadge";
import { BoardCanvas } from "../../core/board/BoardCanvas";
import { emptyRender, type BoardRender } from "../../core/board/board-renderer";
import type { TagKind } from "../../core/board/ladder";
import { classifyMoves, classifyTree } from "../../core/joseki/classify";
import { movesText } from "../../core/joseki/parse";
import {
  MARKS,
  MARK_LABEL,
  NODE_WARN,
  ROLES,
  ROLE_LABEL,
  countNodes,
  movesTo,
  nodeAt,
  type JosekiMark,
  type JosekiRole,
} from "../../core/joseki/tree";
import { label, moveKey } from "../../core/model/move";
import { useOpeningTables } from "../../data/opening-tables";
import { useBoardStore } from "../board/boardStore";
import { useAdminTools } from "./admin";
import { JosekiComment } from "./JosekiComment";
import { useJosekiStore } from "./josekiStore";
import { TreeView } from "./TreeView";
import { langOf, t } from "../../i18n/i18n";

/**
 * 정석 편집 · 재생(W9) — 왼쪽 트리, 오른쪽 판과 메모.
 *
 * 판을 누르면 지금 마디의 자식으로 수가 들어간다(이미 있는 수면 그리로 간다). 자식들은 판에 A · B · C
 * (평가 기호가 있으면 그 기호)로 보인다. 금수 국면도 놓을 수 있다 — 정석 설명에는 금수 국면이 필요하다.
 */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 메모 도구: 고른 글을 감싸거나, 줄 앞에 붙인다. */
function wrap(el: HTMLTextAreaElement, before: string, after = before): string {
  const { selectionStart: a, selectionEnd: b, value } = el;
  const mid = value.slice(a, b) || t("글");
  return value.slice(0, a) + before + mid + after + value.slice(b);
}
function prefixLines(el: HTMLTextAreaElement, mark: string): string {
  const { selectionStart: a, selectionEnd: b, value } = el;
  const start = value.lastIndexOf("\n", a - 1) + 1;
  const body = value
    .slice(start, b)
    .split("\n")
    .map((l) => (l.startsWith(mark) ? l : mark + l))
    .join("\n");
  return value.slice(0, start) + body + value.slice(b);
}

export function JosekiEditor() {
  const s = useJosekiStore();
  const jk = s.current!;
  const tables = useOpeningTables((x) => x.tables);
  const board = useBoardStore((b) => b.render);
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(true);
  const [asking, setAsking] = useState(false);
  const [tagText, setTagText] = useState(jk.tags.join(", "));
  const admin = useAdminTools((a) => a.on);
  const area = useRef<HTMLTextAreaElement>(null);

  const node = nodeAt(jk.root, s.path) ?? jk.root;
  const moves = useMemo(() => movesTo(jk.root, s.path), [jk.root, s.path]);
  const total = countNodes(jk.root);
  const cls = useMemo(() => classifyTree(jk, tables), [jk, tables]);
  const here = useMemo(
    () => classifyMoves(moves, tables, "", jk.boardSize),
    [moves, tables, jk.boardSize],
  );

  // 마디가 바뀌면 메모 초안을 그 마디의 것으로.
  const nodeKey = `${jk.id}:${s.path.join(".")}`;
  const [draftFor, setDraftFor] = useState(nodeKey);
  if (draftFor !== nodeKey) {
    setDraftFor(nodeKey);
    setDraft(node.comment);
    setPreview(node.comment.length > 0);
    setAsking(false);
  }
  const [tagsFor, setTagsFor] = useState({ id: jk.id, tags: jk.tags });
  if (tagsFor.id !== jk.id || tagsFor.tags !== jk.tags) {
    setTagsFor({ id: jk.id, tags: jk.tags });
    setTagText(jk.tags.join(", "));
  }

  // 메모는 쉬면 저장(글자마다 문서를 쓰지 않게).
  useEffect(() => {
    if (draft === node.comment) return;
    const h = setTimeout(() => s.setNodeComment(draft), 500);
    return () => clearTimeout(h);
  }, [draft, node.comment, s]);

  const render: BoardRender = useMemo(() => {
    const tags = new Map<number, { label: string; kind: TagKind; winRatePct?: number }>();
    node.children.forEach((c, i) => {
      const bad = c.mark === "?" || c.mark === "??";
      const good = c.mark === "!" || c.mark === "!!";
      tags.set(moveKey(c.move!, jk.boardSize), {
        label: c.mark ?? LETTERS[i] ?? "+",
        kind: good ? "win" : bad ? "lose" : "rate",
        winRatePct: i === 0 ? 70 : 50,
      });
    });
    return {
      ...emptyRender(jk.boardSize),
      palette: board.palette,
      textScale: board.textScale,
      showNumbers: board.showNumbers,
      stones: moves,
      lastMove: moves.at(-1) ?? null,
      tags,
    };
  }, [node, moves, jk.boardSize, board.palette, board.textScale, board.showNumbers]);

  // 키보드: ← → 처음/끝(Home/End) — 메모 · 입력칸에서는 글자 이동이 먼저다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 보드에 초점이 있으면 방향키는 보드 커서의 것이다(`defaultPrevented`).
      if (e.defaultPrevented) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") s.back();
      else if (e.key === "ArrowRight") s.forward();
      else if (e.key === "Home") s.first();
      else if (e.key === "End") s.last();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s]);

  const flushDraft = () => {
    if (draft !== node.comment) s.setNodeComment(draft);
  };
  const go = (fn: () => void) => () => {
    flushDraft();
    fn();
  };

  return (
    <div className="joseki-editor">
      <section className="panel jhead" aria-label={t("정석 정보")}>
        <div className="panel__actions">
          <button type="button" onClick={go(() => void s.close())}>
            ← {t("목록")}
          </button>
          <span className="panel__status tnum" data-k="joseki-save">
            {s.saving ? t("저장 중…") : t("저장됨")} · {t("{n}수", { n: total })}
          </span>
          {admin && (
            <button
              type="button"
              data-k="joseki-to-studio"
              onClick={go(() => navigate(`/joseki/studio?import=${encodeURIComponent(jk.id)}`))}
              title={t("커리큘럼 스튜디오에서 공식 커리큘럼의 레슨으로 넣습니다")}
            >
              {t("공식 커리큘럼 레슨으로")}
            </button>
          )}
        </div>
        <label className="jfield">
          <span>{t("제목")}</span>
          <input
            value={jk.title}
            onChange={(e) => s.setInfo({ title: e.target.value })}
            aria-label={t("정석 제목")}
          />
        </label>
        <label className="jfield">
          <span>{t("분류")}</span>
          <input
            value={jk.category}
            placeholder={cls.chain.at(-1) ?? t("분류 없음")}
            onChange={(e) => s.setInfo({ category: e.target.value })}
            aria-label={t("분류(비우면 주형 이름)")}
          />
        </label>
        <label className="jfield">
          <span>{t("태그")}</span>
          <input
            value={tagText}
            placeholder={t("쉼표로 나눔")}
            onChange={(e) => setTagText(e.target.value)}
            onBlur={() =>
              s.setInfo({
                tags: [
                  ...new Set(
                    tagText
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  ),
                ],
              })
            }
            aria-label={t("태그")}
          />
        </label>
        <p className="panel__hint" lang={langOf(cls.chain.join(" "))}>
          {cls.group ? `${cls.group} · ` : ""}
          {cls.chain.length ? cls.chain.join(" › ") : t("주형 이름 없음")}
          {cls.grade && (
            <>
              {" "}
              · {t("5수")} <GradeBadge grade={cls.grade} />
            </>
          )}
          {total >= NODE_WARN &&
            ` · ${t("수가 {n}개를 넘었습니다. 나누면 저장이 가볍습니다", { n: NODE_WARN })}`}
        </p>
        {s.notice && (
          <p className="panel__hint jnotice" role="status" data-k="joseki-notice">
            {s.notice}{" "}
            <button type="button" className="linkish" onClick={s.clearNotice}>
              {t("닫기")}
            </button>
          </p>
        )}
      </section>

      <div className="jbody">
        <section className="panel jtreebox" aria-label={t("트리")}>
          <TreeView
            root={jk.root}
            path={s.path}
            size={jk.boardSize}
            onGo={(p) => go(() => s.go(p))()}
          />
        </section>

        <section className="panel jboardbox" aria-label={t("판")}>
          <p className="panel__hint tnum" data-k="joseki-where">
            {moves.length === 0
              ? t("빈 판")
              : `${t("{n}수", { n: moves.length })} ${label(moves.at(-1)!, jk.boardSize)}`}
            {here.chain.length ? ` · ${here.chain.at(-1)}` : ""}
            {node.children.length > 1 ? ` · ${t("갈래 {n}", { n: node.children.length })}` : ""}
          </p>
          <div className="prove__board">
            <BoardCanvas
              render={render}
              zoomable={false}
              keyboard
              onTap={(m) => go(() => s.play(m))()}
            />
          </div>
          <div className="panel__actions jnav">
            <button
              type="button"
              aria-label={t("처음")}
              onClick={go(s.first)}
              disabled={s.path.length === 0}
            >
              |&lt;
            </button>
            <button
              type="button"
              aria-label={t("뒤로")}
              onClick={go(s.back)}
              disabled={s.path.length === 0}
            >
              &lt;
            </button>
            <button
              type="button"
              aria-label={t("앞으로")}
              onClick={go(s.forward)}
              disabled={node.children.length === 0}
            >
              &gt;
            </button>
            <button
              type="button"
              aria-label={t("끝")}
              onClick={go(s.last)}
              disabled={node.children.length === 0}
            >
              &gt;|
            </button>
            {node.children.length > 1 && (
              <select
                aria-label={t("갈래 고르기")}
                value=""
                onChange={(e) => go(() => s.go([...s.path, Number(e.target.value)]))()}
              >
                <option value="" disabled>
                  {t("갈래 ({n})", { n: node.children.length })}
                </option>
                {node.children.map((c, i) => (
                  <option key={i} value={i}>
                    {LETTERS[i]}. {label(c.move!, jk.boardSize)}
                    {c.mark ?? ""}
                    {i === 0 ? ` (${t("주 변화")})` : ""}
                  </option>
                ))}
              </select>
            )}
            <button type="button" onClick={go(s.undoEdit)} disabled={s.undo.length === 0}>
              {t("되돌리기")}
            </button>
          </div>

          <form
            className="jtext"
            onSubmit={(e) => {
              e.preventDefault();
              flushDraft();
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
                    aria-checked={node.mark === mk}
                    title={MARK_LABEL[mk]}
                    aria-label={`${mk} ${MARK_LABEL[mk]}`}
                    className={`chip${node.mark === mk ? " is-on" : ""}`}
                    onClick={() => s.setNodeMark(node.mark === mk ? null : mk)}
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
                    aria-pressed={node.role === r}
                    title={t(ROLE_LABEL[r])}
                    className={`chip${node.role === r ? " is-on" : ""}`}
                    onClick={() => s.setNodeRole(node.role === r ? null : r)}
                  >
                    {t(ROLE_LABEL[r])}
                  </button>
                ))}
              </div>
              <div className="panel__actions">
                <button
                  type="button"
                  onClick={go(s.promote)}
                  disabled={s.path.every((i) => i === 0)}
                >
                  {t("주 변화로")}
                </button>
                <button
                  type="button"
                  onClick={go(() => s.shift(-1))}
                  disabled={s.path.at(-1) === 0}
                >
                  {t("갈래 앞으로")}
                </button>
                <button
                  type="button"
                  onClick={go(() => s.shift(1))}
                  disabled={
                    (nodeAt(jk.root, s.path.slice(0, -1))?.children.length ?? 0) - 1 <=
                    (s.path.at(-1) ?? 0)
                  }
                >
                  {t("갈래 뒤로")}
                </button>
                {asking ? (
                  <>
                    <button type="button" className="btn--danger" onClick={go(s.deleteNode)}>
                      {t("{n}수 지우기", { n: countNodes(node) + 1 })}
                    </button>
                    <button type="button" autoFocus onClick={() => setAsking(false)}>
                      {t("취소")}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn--danger" onClick={() => setAsking(true)}>
                    {t("이 수부터 지우기")}
                  </button>
                )}
              </div>
            </>
          )}

          <div className="jcomment">
            <div className="jcomment__bar" role="toolbar" aria-label={t("메모 서식")}>
              <button
                type="button"
                title={t("굵게")}
                aria-label={t("굵게")}
                onClick={() => area.current && setDraft(wrap(area.current, "**"))}
              >
                <b>B</b>
              </button>
              <button
                type="button"
                title={t("기울임")}
                aria-label={t("기울임")}
                onClick={() => area.current && setDraft(wrap(area.current, "*"))}
              >
                <i>I</i>
              </button>
              <button
                type="button"
                title={t("목록")}
                onClick={() => area.current && setDraft(prefixLines(area.current, "- "))}
              >
                • {t("목록")}
              </button>
              <button
                type="button"
                title={t("링크")}
                onClick={() => area.current && setDraft(wrap(area.current, "[", "](https://)"))}
              >
                {t("링크")}
              </button>
              <button type="button" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
                {preview ? t("고치기") : t("미리 보기")}
              </button>
            </div>
            {preview && draft ? (
              <div className="jcomment__view" data-k="joseki-comment">
                <JosekiComment text={draft} onCoord={(m) => go(() => void s.jumpTo(m))()} />
              </div>
            ) : (
              <textarea
                ref={area}
                rows={5}
                value={draft}
                placeholder={
                  s.path.length
                    ? t("이 수의 메모: **굵게** *기울임* 목록, 좌표(h8)는 누르면 그 수로")
                    : t("이 정석의 메모: **굵게** *기울임* 목록, 좌표(h8)는 누르면 그 수로")
                }
                aria-label={t("메모")}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={flushDraft}
              />
            )}
          </div>

          <div className="panel__actions">
            <button type="button" onClick={go(s.toBoard)}>
              {t("보드로 보내기")}
            </button>
            <button
              type="button"
              disabled={moves.length === 0}
              onClick={go(() => {
                s.toBoard();
                navigate("/research/sequence");
              })}
              title={t("같은 돌에 이르는 다른 수순(연구 ▸ 수순)")}
            >
              {t("다른 수순 보기")}
            </button>
            <button
              type="button"
              disabled={moves.length === 0}
              onClick={() => {
                const b = s.exportLine();
                if (b)
                  downloadBlob(
                    `${jk.title.replace(/[\s/\\:*?"<>|]+/g, "_") || "joseki"}.psq`,
                    b,
                    "text/plain",
                  );
              }}
            >
              {t("이 변화 .psq")}
            </button>
            <button
              type="button"
              onClick={() => {
                const j = s.exportCurrent();
                if (j)
                  downloadBlob(
                    `${jk.title.replace(/[\s/\\:*?"<>|]+/g, "_") || "joseki"}.json`,
                    j,
                    "application/json",
                  );
              }}
            >
              {t("이 정석 JSON")}
            </button>
          </div>
          <p className="panel__hint tnum">{moves.length ? movesText(moves) : ""}</p>
        </section>
      </div>
    </div>
  );
}
