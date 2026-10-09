import { useEngineStore } from "../../engine/engine-state";
import type { EvalView } from "../../engine/eval-view";
import { useCurrentEval } from "./currentAnalysis";
import { useBoardDb } from "./boardDb";
import { useGameStore } from "./gameStore";
import { dbEvalView } from "../database/dbTags";

/**
 * 평가 바 — 체스닷컴의 세로 게이지를 오목에 옮긴 것.
 *
 * **위가 흑, 아래가 백**이고 흑의 승률만큼 위에서부터 검게 찬다. 앞선 쪽 끝에
 * 승률과 평가값을 적는다(외통이면 `M5`). 값은 흑 관점으로 돌려 둔 `evalView` 만
 * 읽는다 — 엔진의 값은 둘 차례 관점이라 그대로 그리면 수마다 바가 뒤집힌다.
 *
 * 그 값이 **지금 국면이나 앞 국면**의 것일 때만 그린다(`useCurrentEval`) — 무른 판에서
 * 뒤 국면의 형세를 말하지 않는다.
 *
 * 움직임은 **채움의 높이만** 200ms 로 옮긴다(`Motion.kt` 의 상한). 숫자는
 * 보간하지 않는다 — 실시간 값의 애니메이션은 지나간 값에 대한 거짓말이다.
 *
 * **DB(W8).** 분석 탭에서 DB 가 지금 국면의 값을 말하면(`positionValue` — 데스크톱
 * `evalbar_update_from_db`) 엔진이 이 국면을 읽고 있지 않은 동안 그 값을 그린다. 엔진이 읽는
 * 중이면 실시간 값이 앞선다. DB 값이면 라벨 밑에 「DB」를 적어 출처를 말한다.
 */
export function EvalBar({ empty }: { empty: boolean }) {
  const view = useCurrentEval();
  const analyzing = useEngineStore((s) => s.analyzing);
  const status = useEngineStore((s) => s.status);
  const db = useBoardDb();
  const analysisTab = useGameStore((s) => s.mode === "analysis");
  const live = analyzing || status === "searching";
  // 빈 판에서 아무것도 읽지 않고 있으면 앞 대국의 값이 남아 있을 이유가 없다.
  const engineView = empty && !live ? null : view;
  const dbView = analysisTab && db?.value ? dbEvalView(db.value) : null;
  const fromDb = dbView !== null && !(live && engineView);
  const v = fromDb ? dbView : engineView;

  const black = v ? v.blackPct : 50;
  const lead: "black" | "white" | null = v ? (black >= 50 ? "black" : "white") : null;
  const { main, sub } = labels(v, fromDb);

  return (
    <div
      className="evalbar"
      role="meter"
      aria-label="평가 바"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(black)}
      aria-valuetext={describe(v, fromDb)}
      data-lead={lead ?? undefined}
      data-live={status === "searching" || undefined}
      title={describe(v, fromDb)}
      data-source={fromDb ? "db" : undefined}
    >
      <div className="evalbar__black" style={{ height: `${black}%` }} />
      <div className="evalbar__mid" aria-hidden="true" />
      <span className="evalbar__label tnum" aria-hidden="true">
        <span className="evalbar__main">{main}</span>
        {sub && <span className="evalbar__sub">{sub}</span>}
      </span>
    </div>
  );
}

function labels(v: EvalView | null, fromDb: boolean): { main: string; sub: string | null } {
  if (!v) return { main: "—", sub: null };
  if (v.mate) return { main: `M${v.mate.plies}`, sub: fromDb ? "DB" : null };
  if (fromDb) return { main: `${Math.round(Math.max(v.blackPct, 100 - v.blackPct))}%`, sub: "DB" };
  const leadPct = Math.round(Math.max(v.blackPct, 100 - v.blackPct));
  // 평가값은 앞선 쪽 기준의 크기만 — 어느 편인지는 라벨이 붙은 끝이 말한다.
  const sub = v.blackEval === null ? null : String(Math.abs(v.blackEval));
  return { main: `${leadPct}%`, sub };
}

function describe(v: EvalView | null, fromDb: boolean): string {
  if (!v) return "평가 없음";
  const src = fromDb ? " · DB 기록" : "";
  if (v.mate) return `${v.mate.winner === "black" ? "흑" : "백"} ${v.mate.plies}수 외통${src}`;
  const e = v.blackEval === null ? "" : ` · 평가 ${v.blackEval > 0 ? "+" : ""}${v.blackEval}`;
  return `흑 ${Math.round(v.blackPct)}% · 백 ${Math.round(100 - v.blackPct)}%${e}${src}`;
}
