import { useEngineStore } from "../../engine/engine-state";

/**
 * piskvork 콘솔 — 엔진이 뱉은 **원시 줄** 그대로.
 *
 * 파싱된 결과만 보여 주면 「엔진이 무언가 말했는데 우리가 못 알아들은 경우」가
 * 화면에서 사라진다. 그건 이 프로젝트에서 가장 알고 싶은 상황이라(프로토콜 이식이
 * 맞는지가 거기서 드러난다) 원문을 그대로 남긴다.
 *
 * 워커가 100ms 배치로 올리고 상한은 5,000줄이다 — 탐색 중 초당 수백 줄이 와도
 * 메인 스레드가 그 리듬으로 리렌더하지 않는다.
 */
export function EngineConsole() {
  const lines = useEngineStore((s) => s.console);
  const clearConsole = useEngineStore((s) => s.clearConsole);
  if (lines.length === 0) return null;

  return (
    <section className="panel">
      <h2 className="panel__title">
        콘솔
        <button type="button" className="panel__link" onClick={clearConsole}>
          지우기
        </button>
      </h2>
      <pre className="console">{lines.slice(-40).join("\n")}</pre>
    </section>
  );
}
