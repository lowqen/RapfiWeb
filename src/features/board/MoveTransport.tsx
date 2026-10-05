import { useEffect } from "react";
import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { useEngineStore } from "../../engine/engine-state";
import { Icon, ICON } from "./icons";
import { useStopAnalysis } from "./analysisActions";

/**
 * 보드 바로 아래의 이동 바 — `|<` `<` `▶` `>` `>|`. 앱의 재생 바 그대로다.
 *
 * **여기에는 이 다섯 개만 둔다.** 나머지 도구·엔진 수치·설정은 옆 칸이 진다 —
 * 보드 밑에 무엇이든 늘어나면 판이 그만큼 작아지고, 손가락이 판을 누르려다
 * 버튼을 누르게 된다.
 *
 * `▶` 는 분석을 켜고 끈다 — **[분석] 탭에만** 있다. [대국] 탭에서는 엔진이 대국의
 * 차례로만 움직이므로(탭 격리) 가운데 원이 없고 기보 이동 넷만 남는다. 분석 중 `⏸` 는
 * 분석 카드의 「정지」와 같다 — 설정이 켜져 있으면 그 순간의 최선수를 둔다.
 *
 * 이름(aria-label)은 스모크가 집는 「분석」「정지」「엔진 시작」과 겹치지 않게
 * 지었다 — 겹치면 이름으로 찾는 시험이 두 버튼을 동시에 집는다.
 */
export function MoveTransport() {
  const stones = useBoardStore((s) => s.render.stones.length);
  const ahead = useBoardStore((s) => s.future.length);
  const placements = useBoardStore((s) => s.placements);

  const thinking = useGameStore((s) => s.thinking);
  const blocked = useGameStore((s) => s.thinking || s.prompt !== null);
  const undoMove = useGameStore((s) => s.undoMove);
  const undoAll = useGameStore((s) => s.undoAll);
  const redoMove = useGameStore((s) => s.redoMove);
  const redoAll = useGameStore((s) => s.redoAll);

  const status = useEngineStore((s) => s.status);
  const available = useEngineStore((s) => Boolean(s.capabilities.variant));
  const analyze = useEngineStore((s) => s.analyze);
  const stopAnalysis = useStopAnalysis();
  const analysisTab = useGameStore((s) => s.mode === "analysis");

  const analyzing = status === "searching" && !thinking;
  const playDisabled = !available || thinking || status === "starting";
  const toggleEngine = () => {
    if (analyzing) stopAnalysis();
    else void analyze(placements());
  };

  const canBack = stones > 0;
  const canForward = ahead > 0 && !blocked;

  // 데스크톱에서는 화살표로도 기보를 넘긴다. 입력칸에 있을 때와 조합키가 눌렸을
  // 때는 비켜선다 — 브라우저·스크린 리더의 단축키를 빼앗지 않는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const run = {
        ArrowLeft: undoMove,
        ArrowRight: redoMove,
        Home: undoAll,
        End: redoAll,
      }[e.key];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoMove, redoMove, undoAll, redoAll]);

  return (
    <nav className="transport" aria-label="수 이동">
      <button
        type="button"
        className="transport__btn"
        onClick={undoAll}
        disabled={!canBack}
        aria-label="처음으로"
        title="처음으로 (Home)"
      >
        <Icon d={ICON.first} />
      </button>
      <button
        type="button"
        className="transport__btn"
        onClick={undoMove}
        disabled={!canBack}
        aria-label="한 수 뒤로"
        title="한 수 뒤로 (←)"
      >
        <Icon d={ICON.prev} />
      </button>
      {analysisTab && (
        <button
          type="button"
          className="transport__btn transport__btn--play"
          onClick={toggleEngine}
          disabled={playDisabled}
          aria-pressed={analyzing}
          aria-label={analyzing ? "엔진 멈춤" : "엔진 분석"}
          title={analyzing ? "엔진 멈춤" : "엔진 분석"}
          data-running={analyzing || undefined}
        >
          <Icon d={analyzing ? ICON.pause : ICON.play} />
        </button>
      )}
      <button
        type="button"
        className="transport__btn"
        onClick={redoMove}
        disabled={!canForward}
        aria-label="한 수 앞으로"
        title="한 수 앞으로 (→)"
      >
        <Icon d={ICON.next} />
      </button>
      <button
        type="button"
        className="transport__btn"
        onClick={redoAll}
        disabled={!canForward}
        aria-label="끝으로"
        title="끝으로 (End)"
      >
        <Icon d={ICON.last} />
      </button>
    </nav>
  );
}
