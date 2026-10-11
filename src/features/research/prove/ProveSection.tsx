import { useMemo, useState } from "react";
import { DurationField, Segmented, Switch } from "../../../components/controls";
import { Disclosure } from "../../../components/Disclosure";
import { PROVE_MAX_SPEC, PROVE_START_SPEC } from "../../../core/settings/duration";
import { BoardCanvas } from "../../../core/board/BoardCanvas";
import { emptyRender, type BoardRender } from "../../../core/board/board-renderer";
import type { TagKind } from "../../../core/board/ladder";
import { moveKey } from "../../../core/model/move";
import { budgetText, optionsLabel } from "../../../core/prove/prove-tree";
import { badgeLines, outcomeMessage, outcomeTitle } from "../../../core/prove/prove-models";
import { useBoardStore } from "../../board/boardStore";
import { useDbStore } from "../../database/dbStore";
import { useProveStore } from "./proveStore";
import { t } from "../../../i18n/i18n";

/**
 * 연구 ▸ 리뷰·증명 의 **증명**(W6d) — 앱 `ProveScreen` 의 이식.
 *
 * 지금 판(무른 수 제외)에서 둘 차례의 승리를 증명하거나 반증한다. 판에는 뿌리 후보마다의
 * 상태(승 · 패 · 열림의 남은 예산 · 소진 · 대기)와 지금 탐색 중인 줄(반투명 번호 돌)을 그린다
 * — 데스크톱 `prove_update_overlay` 와 같다.
 *
 * 엔진 DB(W8)가 붙어 있으면 데스크톱처럼 마디마다 DB 를 먼저 묻고 증명된 메이트를 적는다.
 * 붙어 있지 않으면 결론이 이 실행 안에서만 쓰인다 — 화면이 어느 쪽인지 말한다.
 */

const START_SEC = [2, 5, 10, 20] as const;
const MAX_SEC = [60, 120, 320, 600] as const;
const DEPTH0 = [8, 10, 12, 14] as const;
const DEPTH_MAX = [20, 24, 30, 40] as const;
const NBEST = [2, 3, 4, 6, 8] as const;
const START_MS = START_SEC.map((v) => v * 1000);
const MAX_MS = MAX_SEC.map((v) => v * 1000);

export function ProveSection() {
  const s = useProveStore();
  const board = useBoardStore((b) => b.render);
  const dbOn = useDbStore((d) => d.status === "on");
  const dbReadonly = useDbStore((d) => d.settings.readonly);
  const [notice, setNotice] = useState<string | null>(null);
  const o = s.options;
  const p = s.progress;
  const [first, second] = badgeLines(p);

  // 판: 도는 동안은 증명 뿌리, 아니면 지금 판. 덧그림은 탐색 줄(고스트) + 뿌리 후보 표식.
  const view: BoardRender = useMemo(() => {
    const stones = s.running ? s.root : board.stones;
    const ov = s.running ? s.overlay : null;
    const tags = new Map<number, { label: string; kind: TagKind; winRatePct?: number }>();
    const candidates = new Map<number, "live" | "done">();
    if (ov) {
      // 탐색 중인 줄이 이미 그 칸에 번호 돌을 놓았으면 표식은 생략한다 — 겹치면 둘 다 읽히지 않는다.
      const onLine = new Set(ov.line.map((m) => moveKey(m, board.size)));
      for (const { move, mark, budget } of ov.marks.values()) {
        const k = moveKey(move, board.size);
        if (onLine.has(k)) continue;
        if (mark === "win") tags.set(k, { label: t("승"), kind: "win" });
        else if (mark === "loss") tags.set(k, { label: t("패"), kind: "lose" });
        else if (mark === "open")
          tags.set(k, { label: budgetText(budget, ov.byDepth), kind: "rate", winRatePct: 50 });
        else if (mark === "exh") tags.set(k, { label: t("소진"), kind: "rate", winRatePct: 50 });
        else if (mark === "latent") candidates.set(k, "done");
      }
    }
    return {
      ...emptyRender(board.size),
      palette: board.palette,
      textScale: board.textScale,
      stones,
      lastMove: stones.at(-1) ?? null,
      ghosts: ov ? ov.line : [],
      tags,
      candidates,
    };
  }, [s.running, s.root, s.overlay, board]);

  return (
    <section className="panel panel--disclosure" aria-label={t("국면 증명")} aria-busy={s.running}>
      {/* 전문가 기능이라 통째로 접어 둔다. 도는 동안만 머리에 «증명 중»이 남는다(예산은 안쪽 «증명 설정»). */}
      <Disclosure id="prove" title={t("국면 증명")} summary={s.running ? t("증명 중") : undefined}>
        <p className="panel__lead">
          {t("지금 판에서 {side}의 승리를 증명하거나 반증합니다. 메이트만 결론으로 칩니다.", {
            side: board.stones.length % 2 === 0 ? t("흑") : t("백"),
          })}
        </p>
        <div className="panel__actions">
          {!s.running && (
            <button
              type="button"
              className="button--primary"
              onClick={() => {
                setNotice(null);
                void s.start().then(setNotice);
              }}
            >
              {t("지금 판 증명")}
            </button>
          )}
          {s.running && (
            <button type="button" className="btn--danger" onClick={s.cancel}>
              {t("멈추기")}
            </button>
          )}
        </div>
        {notice && (
          <p className="panel__hint" role="status">
            {notice}
          </p>
        )}

        {s.running && (
          <div className="prove__badge tnum" role="status" aria-live="polite" data-k="prove-badge">
            <p>{first}</p>
            {second && <p>{second}</p>}
            <p className="prove__path">
              {p.path} · {t("트리 {n}마디", { n: p.nodes })} ·{" "}
              {t("예산 {b}", { b: optionsLabel(o) })}
            </p>
          </div>
        )}

        <div className="prove__board">
          <BoardCanvas render={view} onTap={() => {}} zoomable={false} />
        </div>

        {s.outcome && (
          <div className="prove__outcome" role="status" data-k="prove-outcome">
            <h3>{outcomeTitle(s.outcome)}</h3>
            <p>{outcomeMessage(s.outcome)}</p>
            <div className="panel__actions">
              <button type="button" onClick={s.clearOutcome}>
                {t("닫기")}
              </button>
            </div>
          </div>
        )}

        {s.log.length > 0 && (
          <details className="review__log">
            <summary>{t("증명 기록 ({n})", { n: s.log.length })}</summary>
            <pre>{s.log.join("\n")}</pre>
          </details>
        )}
        <div className="panel__fold">
          <Disclosure id="prove-options" level={3} title={t("증명 설정")} summary={optionsLabel(o)}>
            <div className="review__row">
              <span className="review__label">{t("예산")}</span>
              <Segmented
                label={t("증명 예산의 종류")}
                value={o.byDepth ? "depth" : "time"}
                options={[
                  { value: "time", label: t("시간") },
                  { value: "depth", label: t("깊이") },
                ]}
                onChange={(v) => s.setOptions({ byDepth: v === "depth" })}
                disabled={s.running}
              />
            </div>
            {o.byDepth ? (
              <>
                <div className="review__row">
                  <span className="review__label">{t("시작 깊이")}</span>
                  <Segmented
                    label={t("시작 깊이")}
                    value={o.depth0}
                    options={DEPTH0.map((d) => ({ value: d, label: String(d) }))}
                    onChange={(depth0) => s.setOptions({ depth0 })}
                    disabled={s.running}
                  />
                </div>
                <div className="review__row">
                  <span className="review__label">{t("최대 깊이")}</span>
                  <Segmented
                    label={t("최대 깊이")}
                    value={o.depthMax}
                    options={DEPTH_MAX.map((d) => ({ value: d, label: String(d) }))}
                    onChange={(depthMax) => s.setOptions({ depthMax })}
                    disabled={s.running}
                  />
                </div>
              </>
            ) : (
              <div className="review__row">
                <span className="review__label">{t("시작 예산")}</span>
                <div className="timepick">
                  <Segmented
                    label={t("마디당 시작 예산(초)")}
                    value={o.budget0Sec}
                    options={START_SEC.map((v) => ({ value: v, label: t("{n}초", { n: v }) }))}
                    onChange={(budget0Sec) => s.setOptions({ budget0Sec })}
                    disabled={s.running}
                  />
                  <DurationField
                    label={t("마디당 시작 예산")}
                    valueMs={o.budget0Sec * 1000}
                    spec={PROVE_START_SPEC}
                    presetsMs={START_MS}
                    onCommit={(ms) => s.setOptions({ budget0Sec: ms / 1000 })}
                    disabled={s.running}
                  />
                </div>
              </div>
            )}
            <div className="review__row">
              <span className="review__label">
                {o.byDepth ? t("마디당 시간 끈") : t("마디당 상한")}
              </span>
              <div className="timepick">
                <Segmented
                  label={t("마디당 상한(초)")}
                  value={o.budgetMaxSec}
                  options={MAX_SEC.map((v) => ({ value: v, label: t("{n}초", { n: v }) }))}
                  onChange={(budgetMaxSec) => s.setOptions({ budgetMaxSec })}
                  disabled={s.running}
                />
                <DurationField
                  label={t("마디당 상한")}
                  valueMs={o.budgetMaxSec * 1000}
                  spec={PROVE_MAX_SPEC}
                  presetsMs={MAX_MS}
                  onCommit={(ms) => s.setOptions({ budgetMaxSec: ms / 1000 })}
                  disabled={s.running}
                />
              </div>
            </div>
            <div className="review__row">
              <span className="review__label">{t("공격 후보 수")}</span>
              <Segmented
                label={t("공격 후보 수(nbest)")}
                value={o.nbest}
                options={NBEST.map((v) => ({ value: v, label: String(v) }))}
                onChange={(nbest) => s.setOptions({ nbest })}
                disabled={s.running}
              />
            </div>
            <div className="review__row">
              <span className="review__label">{t("가장 좋은 공격부터")}</span>
              <Switch
                label={t("가장 좋은 공격부터")}
                on={o.bestFirst}
                onChange={(bestFirst) => s.setOptions({ bestFirst })}
                disabled={s.running}
              />
            </div>
            <div className="review__row">
              <span className="review__label">{t("버틸 것 같은 방어 먼저 탐침")}</span>
              <Switch
                label={t("버틸 것 같은 방어 먼저 탐침")}
                on={o.probe}
                onChange={(probe) => s.setOptions({ probe })}
                disabled={s.running}
              />
            </div>
            <p className="panel__hint">
              {dbOn
                ? dbReadonly
                  ? t("데이터베이스(읽기 전용)를 먼저 묻습니다. 결론은 적지 않습니다.")
                  : t("데이터베이스를 먼저 묻고, 증명된 메이트를 데이터베이스에 적습니다.")
                : t(
                    "데이터베이스가 붙어 있지 않아 결론은 이 실행 안에서만 쓰입니다(데이터베이스 화면에서 켤 수 있습니다).",
                  )}
            </p>
          </Disclosure>
        </div>
      </Disclosure>
    </section>
  );
}
