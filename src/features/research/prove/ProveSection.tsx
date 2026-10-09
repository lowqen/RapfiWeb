import { useMemo, useState } from "react";
import { Segmented, Switch } from "../../../components/controls";
import { BoardCanvas } from "../../../core/board/BoardCanvas";
import { emptyRender, type BoardRender } from "../../../core/board/board-renderer";
import type { TagKind } from "../../../core/board/ladder";
import { moveKey } from "../../../core/model/move";
import { budgetText, optionsLabel } from "../../../core/prove/prove-tree";
import { badgeLines, outcomeMessage, outcomeTitle } from "../../../core/prove/prove-models";
import { useBoardStore } from "../../board/boardStore";
import { useProveStore } from "./proveStore";

/**
 * 연구 ▸ 리뷰·증명 의 **증명**(W6d) — 앱 `ProveScreen` 의 이식.
 *
 * 지금 판(무른 수 제외)에서 둘 차례의 승리를 증명하거나 반증한다. 판에는 뿌리 후보마다의
 * 상태(승 · 패 · 열림의 남은 예산 · 소진 · 대기)와 지금 탐색 중인 줄(반투명 번호 돌)을 그린다
 * — 데스크톱 `prove_update_overlay` 와 같다.
 *
 * 웹에는 아직 DB 가 없어(W8) 결론이 이 실행 안에서만 쓰인다 — 화면이 그렇게 말한다.
 */

const START_SEC = [2, 5, 10, 20] as const;
const MAX_SEC = [60, 120, 320, 600] as const;
const DEPTH0 = [8, 10, 12, 14] as const;
const DEPTH_MAX = [20, 24, 30, 40] as const;
const NBEST = [2, 3, 4, 6, 8] as const;

export function ProveSection() {
  const s = useProveStore();
  const board = useBoardStore((b) => b.render);
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
        if (mark === "win") tags.set(k, { label: "승", kind: "win" });
        else if (mark === "loss") tags.set(k, { label: "패", kind: "lose" });
        else if (mark === "open")
          tags.set(k, { label: budgetText(budget, ov.byDepth), kind: "rate", winRatePct: 50 });
        else if (mark === "exh") tags.set(k, { label: "소진", kind: "rate", winRatePct: 50 });
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
    <section className="panel" aria-label="국면 증명">
      <h2 className="panel__title">
        국면 증명{" "}
        <span className="panel__status">
          {s.running ? "증명 중 — 엔진을 증명이 쓰고 있습니다" : ""}
        </span>
      </h2>
      <p className="panel__hint">
        지금 판에서 둘 차례({board.stones.length % 2 === 0 ? "흑" : "백"})의 승리를 엔진이 모는
        AND/OR 탐색으로 증명하거나 반증합니다. 메이트만 결론으로 칩니다 — 높은 승률은 증거일
        뿐입니다. 웹에는 아직 데이터베이스가 없어 결론은 이 실행 안에서만 쓰입니다.
      </p>

      <div className="review__row">
        <span className="review__label">예산</span>
        <Segmented
          label="증명 예산의 종류"
          value={o.byDepth ? "depth" : "time"}
          options={[
            { value: "time", label: "시간" },
            { value: "depth", label: "깊이" },
          ]}
          onChange={(v) => s.setOptions({ byDepth: v === "depth" })}
          disabled={s.running}
        />
      </div>
      {o.byDepth ? (
        <>
          <div className="review__row">
            <span className="review__label">시작 깊이</span>
            <Segmented
              label="시작 깊이"
              value={o.depth0}
              options={DEPTH0.map((d) => ({ value: d, label: String(d) }))}
              onChange={(depth0) => s.setOptions({ depth0 })}
              disabled={s.running}
            />
          </div>
          <div className="review__row">
            <span className="review__label">최대 깊이</span>
            <Segmented
              label="최대 깊이"
              value={o.depthMax}
              options={DEPTH_MAX.map((d) => ({ value: d, label: String(d) }))}
              onChange={(depthMax) => s.setOptions({ depthMax })}
              disabled={s.running}
            />
          </div>
        </>
      ) : (
        <div className="review__row">
          <span className="review__label">시작 예산</span>
          <Segmented
            label="마디당 시작 예산(초)"
            value={o.budget0Sec}
            options={START_SEC.map((v) => ({ value: v, label: `${v}초` }))}
            onChange={(budget0Sec) => s.setOptions({ budget0Sec })}
            disabled={s.running}
          />
        </div>
      )}
      <div className="review__row">
        <span className="review__label">{o.byDepth ? "마디당 시간 끈" : "마디당 상한"}</span>
        <Segmented
          label="마디당 상한(초)"
          value={o.budgetMaxSec}
          options={MAX_SEC.map((v) => ({ value: v, label: `${v}초` }))}
          onChange={(budgetMaxSec) => s.setOptions({ budgetMaxSec })}
          disabled={s.running}
        />
      </div>
      <div className="review__row">
        <span className="review__label">공격 후보 수</span>
        <Segmented
          label="공격 후보 수(nbest)"
          value={o.nbest}
          options={NBEST.map((v) => ({ value: v, label: String(v) }))}
          onChange={(nbest) => s.setOptions({ nbest })}
          disabled={s.running}
        />
      </div>
      <div className="review__row">
        <span className="review__label">가장 좋은 공격부터</span>
        <Switch
          label="가장 좋은 공격부터"
          on={o.bestFirst}
          onChange={(bestFirst) => s.setOptions({ bestFirst })}
          disabled={s.running}
        />
      </div>
      <div className="review__row">
        <span className="review__label">버틸 것 같은 방어 먼저 탐침</span>
        <Switch
          label="버틸 것 같은 방어 먼저 탐침"
          on={o.probe}
          onChange={(probe) => s.setOptions({ probe })}
          disabled={s.running}
        />
      </div>

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
            지금 판 증명
          </button>
        )}
        {s.running && (
          <button type="button" className="btn--danger" onClick={s.cancel}>
            멈추기
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
            {p.path} · 트리 {p.nodes}마디 · 예산 {optionsLabel(o)}
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
              닫기
            </button>
          </div>
        </div>
      )}

      {s.log.length > 0 && (
        <details className="review__log">
          <summary>증명 기록 ({s.log.length})</summary>
          <pre>{s.log.join("\n")}</pre>
        </details>
      )}
    </section>
  );
}
