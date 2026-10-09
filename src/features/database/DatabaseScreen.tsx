import { useEffect, useMemo, useRef, useState } from "react";
import { NumberField, Segmented, Switch } from "../../components/controls";
import { downloadBlob, stamp } from "../../app/download";
import { BoardCanvas } from "../../core/board/BoardCanvas";
import { emptyRender, type BoardRender } from "../../core/board/board-renderer";
import type { TagKind } from "../../core/board/ladder";
import {
  DELETE_FILTERS,
  LABEL_MAX,
  MASK_DEPTH,
  MASK_TAG,
  MASK_VALUE,
  deleteScopeTitle,
  entrySummary,
  kindOf,
  positionValue,
  winRatePct,
  type DbCell,
  type DbDeleteScope,
} from "../../core/database/yixindb";
import { label as moveLabel, moveKey, sameMove, type Move } from "../../core/model/move";
import { useEngineStore } from "../../engine/engine-state";
import { useBoardStore } from "../board/boardStore";
import { DB_FILE, useDbStore } from "./dbStore";

/**
 * 데이터베이스(W8) — 엔진의 yixindb. 앱 `DatabaseScreen` · 데스크톱 `show_database` 의 이식.
 *
 * 판은 보드의 지금 판(무른 수 제외)이고, 빈 칸마다 DB 에 적힌 자식 값(태그)이나 칸 글자를 그린다.
 * 칸을 누르면 그 칸을 고른다 — 칸 글자를 적거나, 그 수를 보드에 두어 한 수 들어간다.
 */

const TAGS = [
  { value: "-", label: "없음" },
  { value: "W", label: "W 승" },
  { value: "L", label: "L 패" },
  { value: "D", label: "D 무" },
  { value: "X", label: "X 금지" },
] as const;

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${(n / 1024).toFixed(1)}KB`;

function tagOf(
  c: DbCell,
  showText: boolean,
): { label: string; kind: TagKind; winRatePct?: number } {
  const label = showText && c.text ? c.text : c.tag || c.text;
  const k = kindOf(c.tag || c.text);
  if (k === "win") return { label, kind: "win" };
  if (k === "loss") return { label, kind: "lose" };
  return { label, kind: "rate", winRatePct: k === "rate" ? (winRatePct(c) ?? 50) : 50 };
}

export function DatabaseScreen() {
  const s = useDbStore();
  const engineStatus = useEngineStore((e) => e.status);
  const owner = useEngineStore((e) => e.owner);
  const board = useBoardStore((b) => b.render);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<Move | null>(null);
  const [labelText, setLabelText] = useState("");
  const [comment, setComment] = useState("");
  const [rec, setRec] = useState<{ tag: string; value: number; depth: number }>({
    tag: "-",
    value: 0,
    depth: 1,
  });
  const [scope, setScope] = useState<DbDeleteScope>({ filter: "nonwl", recursive: false, step: 5 });
  const [confirm, setConfirm] = useState<null | {
    text: string;
    run: () => Promise<string | null>;
  }>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stones = board.stones;
  const on = s.status === "on";
  const ro = s.settings.readonly;
  const tell = (msg: string | null, ok?: string) => setNotice(msg ?? ok ?? null);

  useEffect(() => {
    void useDbStore.getState().loadStored();
  }, []);

  // 판이 바뀌거나 DB 가 붙으면 다시 읽는다.
  useEffect(() => {
    setPicked(null);
    if (on) void useDbStore.getState().refresh(stones);
  }, [stones, on]);

  const view = s.view && s.view.moves.length === stones.length ? s.view : null;
  const snap = view?.snapshot ?? null;

  // 주석 칸은 읽은 주석으로 맞춘다(고치는 중이면 덮지 않게 — 국면이 바뀔 때만).
  const lastComment = useRef<string | null>(null);
  useEffect(() => {
    const c = snap?.comment ?? "";
    if (lastComment.current !== c) {
      lastComment.current = c;
      setComment(c);
    }
  }, [snap?.comment]);

  const pickedCell = picked && snap ? (snap.cells.get(moveKey(picked, board.size)) ?? null) : null;
  useEffect(() => setLabelText(pickedCell?.text ?? ""), [pickedCell?.text, picked]);

  const render: BoardRender = useMemo(() => {
    const tags = new Map<number, { label: string; kind: TagKind; winRatePct?: number }>();
    if (snap) for (const [k, c] of snap.cells) tags.set(k, tagOf(c, s.settings.showBoardText));
    const candidates = new Map<number, "live" | "done">();
    if (picked) candidates.set(moveKey(picked, board.size), "live");
    return {
      ...emptyRender(board.size),
      palette: board.palette,
      textScale: board.textScale,
      stones,
      lastMove: stones.at(-1) ?? null,
      tags,
      candidates,
    };
  }, [snap, picked, board, stones, s.settings.showBoardText]);

  const occupied = new Set(stones.map((m) => moveKey(m, board.size)));
  const value = snap
    ? positionValue(snap, stones.length % 2 === 0, board.size * board.size - stones.length)
    : null;

  const ask = (text: string, run: () => Promise<string | null>) => {
    if (s.settings.confirmDeleteAll) setConfirm({ text, run });
    else void run().then((m) => tell(m, "지웠습니다"));
  };

  return (
    <div className="review database">
      <section className="panel" aria-label="데이터베이스">
        <h2 className="panel__title">
          데이터베이스 (yixindb){" "}
          <span className="panel__status" data-k="db-status">
            {s.status === "on"
              ? ro
                ? "붙음 · 읽기 전용"
                : "붙음"
              : s.status === "attaching"
                ? "붙이는 중…"
                : s.status === "error"
                  ? "붙이지 못함"
                  : "꺼짐"}
          </span>
        </h2>
        <p className="panel__hint">
          엔진이 국면마다 증명된 승패 · 값 · 주석을 쌓는 데이터베이스입니다. 파일은 이
          브라우저(IndexedDB)에 두고, 엔진이 뜰 때 엔진 메모리에 올립니다.{" "}
          <b>저장하지 않은 변경은 엔진을 다시 띄우면 사라집니다</b>— 자동 저장을 켜 두거나 «지금
          저장»을 누르세요.
        </p>
        {s.message && (
          <p className="panel__hint" role="alert">
            {s.message}
          </p>
        )}
        <div className="review__row">
          <span className="review__label">DB 사용</span>
          <Switch
            label="DB 사용"
            on={s.settings.enabled}
            onChange={(enabled) => void s.setSettings({ enabled }).then((m) => tell(m))}
          />
        </div>
        <div className="review__row">
          <span className="review__label">읽기 전용</span>
          <Switch
            label="읽기 전용"
            on={ro}
            onChange={(readonly) => void s.setSettings({ readonly })}
          />
        </div>
        <div className="review__row">
          <span className="review__label">자동 저장</span>
          <Switch
            label="자동 저장"
            on={s.settings.autoSave}
            onChange={(autoSave) => void s.setSettings({ autoSave })}
          />
        </div>
        {s.settings.autoSave && (
          <div className="review__row">
            <span className="review__label">저장 간격</span>
            <NumberField
              label="자동 저장 간격(분)"
              value={s.settings.autoSaveMinutes}
              min={1}
              max={1440}
              unit="분"
              onCommit={(autoSaveMinutes) => void s.setSettings({ autoSaveMinutes })}
            />
          </div>
        )}
        <div className="review__row">
          <span className="review__label">칸 글자를 태그보다 먼저</span>
          <Switch
            label="칸 글자를 태그보다 먼저"
            on={s.settings.showBoardText}
            onChange={(showBoardText) => void s.setSettings({ showBoardText })}
          />
        </div>
        <div className="review__row">
          <span className="review__label">일괄 삭제 전에 묻기</span>
          <Switch
            label="일괄 삭제 전에 묻기"
            on={s.settings.confirmDeleteAll}
            onChange={(confirmDeleteAll) => void s.setSettings({ confirmDeleteAll })}
          />
        </div>
        <p className="panel__hint tnum" data-k="db-stored">
          저장된 파일:{" "}
          {s.stored
            ? `${DB_FILE} ${fmtSize(s.stored.size)} · ${new Date(s.stored.savedAt).toLocaleString()}`
            : "없음(붙이면 빈 DB 로 시작)"}
          {on && s.dirty && !ro ? " · 저장 안 된 변경 있음" : ""}
        </p>
        <div className="panel__actions">
          {engineStatus === "idle" || engineStatus === "error" ? (
            <button
              type="button"
              className="button--primary"
              onClick={() => void useEngineStore.getState().start()}
            >
              엔진 시작
            </button>
          ) : (
            s.settings.enabled &&
            !on && (
              <button
                type="button"
                onClick={() => void s.attach().then((m) => tell(m, "붙였습니다"))}
              >
                다시 붙이기
              </button>
            )
          )}
          <button
            type="button"
            className="button--tonal"
            disabled={!on || ro || s.busy}
            onClick={() => void s.save().then((m) => tell(m, "저장했습니다"))}
          >
            지금 저장
          </button>
        </div>
      </section>

      <section className="panel" aria-label="DB 파일">
        <h2 className="panel__title">파일</h2>
        <p className="panel__hint">
          데스크톱 · 앱의 <code>rapfi.db</code> 를 그대로 주고받습니다. CSV 는 엔진의{" "}
          <code>dbtotxt all</code> 형식입니다.
        </p>
        <div className="panel__actions">
          <button type="button" disabled={s.busy} onClick={() => fileInput.current?.click()}>
            .db 올리기
          </button>
          <button
            type="button"
            disabled={s.busy || (!s.stored && !on)}
            onClick={() =>
              void s.exportFile().then((r) => {
                if ("error" in r) tell(r.error);
                else downloadBlob(`rapfi-${stamp()}.db`, r.bytes, "application/octet-stream");
              })
            }
          >
            .db 내려받기
          </button>
          <button
            type="button"
            disabled={!on || s.busy}
            onClick={() =>
              void s.exportCsv().then((r) => {
                if ("error" in r) tell(r.error);
                else downloadBlob(`rapfi-${stamp()}.csv`, r.bytes, "text/csv");
              })
            }
          >
            CSV 내보내기
          </button>
          <button
            type="button"
            className="btn--danger"
            disabled={s.busy || (!s.stored && !on)}
            onClick={() =>
              setConfirm({
                text: "저장된 DB 파일을 지우고 빈 DB 로 시작합니다. 되돌릴 수 없습니다 — 먼저 내려받아 두세요.",
                run: () => s.clearFile(),
              })
            }
          >
            저장된 DB 지우기
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".db,application/octet-stream"
            hidden
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!f) return;
              void f
                .arrayBuffer()
                .then((b) => s.importFile(new Uint8Array(b)))
                .then((m) => tell(m, `${f.name} 을(를) 가져왔습니다`));
            }}
          />
        </div>
      </section>

      <section className="panel" aria-label="이 국면">
        <h2 className="panel__title">
          이 국면{" "}
          <span className="panel__status tnum">
            {stones.length}수 · {stones.length % 2 === 0 ? "흑" : "백"} 차례
          </span>
        </h2>
        {!on ? (
          <p className="panel__hint">DB 가 붙으면 이 판의 기록을 읽습니다.</p>
        ) : (
          <>
            <p className="panel__hint tnum" data-k="db-value">
              {snap
                ? `기록된 자식 ${snap.cells.size}개` +
                  (value
                    ? ` · DB 값: ${value.stmMate !== null ? `${value.stmMate > 0 ? "승" : "패"} ${Math.abs(value.stmMate) || "*"}` : `${Math.round(value.stmWinRate * 100)}%`} (둘 차례)`
                    : "")
                : "읽는 중…"}
            </p>
            {snap?.entry && (
              <p className="panel__hint tnum" data-k="db-entry">
                이 국면의 기록 — {entrySummary(snap.entry)}
              </p>
            )}
          </>
        )}
        <div className="prove__board">
          <BoardCanvas
            render={render}
            zoomable={false}
            onTap={(m) => {
              if (occupied.has(moveKey(m, board.size))) return;
              setPicked((p) => (p && sameMove(p, m) ? null : m));
            }}
          />
        </div>
        {picked && (
          <div className="db__picked">
            <p className="panel__hint tnum">
              고른 칸 {moveLabel(picked, board.size)}
              {pickedCell
                ? ` — 태그 ${pickedCell.tag || "없음"}, 값 ${pickedCell.value}, 깊이 ${pickedCell.depth}`
                : " — 기록 없음"}
            </p>
            <div className="panel__actions">
              <button
                type="button"
                className="button--tonal"
                onClick={() => {
                  useBoardStore.getState().place(picked);
                  setPicked(null);
                }}
              >
                이 수 두기
              </button>
              <input
                className="db__label"
                aria-label="칸 글자"
                maxLength={LABEL_MAX}
                value={labelText}
                placeholder="칸 글자"
                disabled={!on || ro}
                onChange={(e) => setLabelText(e.currentTarget.value)}
              />
              <button
                type="button"
                disabled={!on || ro}
                onClick={() =>
                  void s
                    .setLabel(stones, picked, labelText)
                    .then((m) => tell(m, "칸 글자를 적었습니다"))
                }
              >
                칸 글자 적기
              </button>
              <button
                type="button"
                disabled={!on || ro || !pickedCell?.text}
                onClick={() =>
                  void s.setLabel(stones, picked, "").then((m) => tell(m, "칸 글자를 지웠습니다"))
                }
              >
                지우기
              </button>
            </div>
          </div>
        )}

        {on && (
          <>
            <label className="db__comment">
              <span className="review__label">국면 주석</span>
              <textarea
                rows={3}
                value={comment}
                disabled={ro}
                onChange={(e) => setComment(e.currentTarget.value)}
              />
            </label>
            <div className="panel__actions">
              <button
                type="button"
                disabled={ro || comment === (snap?.comment ?? "")}
                onClick={() =>
                  void s.setComment(stones, comment).then((m) => tell(m, "주석을 적었습니다"))
                }
              >
                주석 적기
              </button>
            </div>

            <h3 className="db__sub">이 국면의 기록 고치기</h3>
            <p className="panel__hint">
              라벨은 <b>이 국면으로 둔 쪽</b>의 관점입니다 — 둘 차례가 이기는 국면은 L
              입니다(데스크톱과 같음).
            </p>
            <div className="review__row">
              <span className="review__label">라벨</span>
              <Segmented
                label="라벨"
                value={rec.tag}
                options={TAGS.map((t) => ({ value: t.value, label: t.label }))}
                onChange={(tag) => setRec((r) => ({ ...r, tag }))}
                disabled={ro}
              />
            </div>
            <div className="review__row">
              <span className="review__label">값</span>
              <NumberField
                label="값"
                value={rec.value}
                min={-30000}
                max={30000}
                onCommit={(v) => setRec((r) => ({ ...r, value: v }))}
                disabled={ro}
              />
            </div>
            <div className="review__row">
              <span className="review__label">깊이</span>
              <NumberField
                label="깊이"
                value={rec.depth}
                min={0}
                max={255}
                onCommit={(depth) => setRec((r) => ({ ...r, depth }))}
                disabled={ro}
              />
            </div>
            <div className="panel__actions">
              <button
                type="button"
                disabled={ro || stones.length === 0}
                onClick={() =>
                  void s
                    .setRecord(stones, MASK_TAG | MASK_VALUE | MASK_DEPTH, {
                      tag: rec.tag === "-" ? null : rec.tag,
                      value: rec.value,
                      depth: rec.depth,
                    })
                    .then((m) => tell(m, "기록을 적었습니다"))
                }
              >
                셋 다 적기
              </button>
              <button
                type="button"
                disabled={ro || stones.length === 0}
                onClick={() =>
                  void s
                    .setRecord(stones, MASK_TAG, { tag: rec.tag === "-" ? null : rec.tag })
                    .then((m) => tell(m, "라벨을 적었습니다"))
                }
              >
                라벨만
              </button>
              <button
                type="button"
                className="btn--danger"
                disabled={ro || stones.length === 0}
                onClick={() =>
                  setConfirm({
                    text: `이 국면(${stones.length}수)의 기록을 지웁니다.`,
                    run: () => s.deleteHere(stones),
                  })
                }
              >
                이 국면 기록 지우기
              </button>
            </div>

            <h3 className="db__sub">아래 분기 일괄 삭제</h3>
            <div className="review__row">
              <span className="review__label">대상</span>
              <select
                aria-label="일괄 삭제 대상"
                value={scope.filter}
                disabled={ro}
                onChange={(e) => {
                  const filter = e.currentTarget.value as DbDeleteScope["filter"];
                  setScope((x) => ({ ...x, filter }));
                }}
              >
                {DELETE_FILTERS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </div>
            {scope.filter !== "all" && (
              <div className="review__row">
                <span className="review__label">하위 분기까지</span>
                <Switch
                  label="하위 분기까지"
                  on={scope.recursive}
                  onChange={(recursive) => setScope((x) => ({ ...x, recursive }))}
                  disabled={ro}
                />
              </div>
            )}
            {scope.filter === "wlinstep" && (
              <div className="review__row">
                <span className="review__label">수</span>
                <NumberField
                  label="N수 이내"
                  value={scope.step}
                  min={1}
                  max={225}
                  onCommit={(step) => setScope((x) => ({ ...x, step }))}
                  disabled={ro}
                />
              </div>
            )}
            <div className="panel__actions">
              <button
                type="button"
                className="btn--danger"
                disabled={ro || s.busy}
                onClick={() =>
                  ask(
                    `이 국면 아래의 «${deleteScopeTitle(scope)}»를 지웁니다. 되돌릴 수 없습니다.`,
                    () => s.deleteAll(stones, scope),
                  )
                }
              >
                일괄 삭제
              </button>
            </div>
          </>
        )}
        {owner && on && (
          <p className="panel__hint">
            {owner === "prove" ? "증명" : "리뷰"}이 엔진을 쓰는 동안은 고칠 수 없습니다(읽기는
            됩니다).
          </p>
        )}
      </section>

      {confirm && (
        <div className="sequence__prompt" role="alertdialog" aria-label="확인">
          <p>{confirm.text}</p>
          <div className="panel__actions">
            <button
              type="button"
              className="btn--danger"
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                void c.run().then((m) => tell(m, "끝났습니다"));
              }}
            >
              진행
            </button>
            <button type="button" onClick={() => setConfirm(null)}>
              취소
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className="panel__hint" role="status" data-k="db-notice">
          {notice}{" "}
          <button type="button" className="linkish" onClick={() => setNotice(null)}>
            닫기
          </button>
        </p>
      )}

      {s.log.length > 0 && (
        <details className="review__log">
          <summary>DB 기록 ({s.log.length})</summary>
          <pre>{s.log.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}
