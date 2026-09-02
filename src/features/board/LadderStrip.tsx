import { DEFAULT_PALETTE, colorsForTag, inkContrast, ladderHex } from "../../core/board/ladder";

/**
 * 값 사다리 견본 — 눈으로 확인하는 자리.
 *
 * 다섯 앵커와 그 사이 보간, 그리고 각 칩 위 흰 글씨의 대비비를 함께 보여 준다.
 * 사다리는 이 앱에서 **색이 곧 값**인 유일한 곳이라, 숫자로도 확인할 수 있어야 한다.
 * (자동 검사는 `ladder.test.ts` 가 사다리 전 구간에서 한다.)
 */
const ANCHORS = [0, 25, 50, 75, 100];

export function LadderStrip() {
  return (
    <section className="panel">
      <h2 className="panel__title">값 사다리</h2>

      <div className="ladder">
        {ANCHORS.map((pctPos) => {
          const hex = ladderHex(pctPos / 100);
          return (
            <div key={pctPos} className="ladder__cell" style={{ background: hex }}>
              <span className="ladder__pos tnum">{pctPos}%</span>
              <span className="ladder__hex tnum">{hex}</span>
              <span className="ladder__ratio tnum">{inkContrast(hex).toFixed(2)}:1</span>
            </div>
          );
        })}
      </div>

      <div className="ladder ladder--chips">
        {[0, 25, 50, 75, 100].map((rate) => {
          const c = colorsForTag(DEFAULT_PALETTE, "rate", rate);
          return (
            <span
              key={rate}
              className="ladder__chip tnum"
              style={{ background: c.fill, color: c.ink, fontWeight: c.bold ? 700 : 400 }}
            >
              {rate}%
            </span>
          );
        })}
        <span
          className="ladder__chip tnum"
          style={{ ...chipStyle("win"), fontWeight: 700 }}
          title="증명된 승리 — 숫자가 아니라 사실이라 굵게 그린다"
        >
          W5
        </span>
        <span className="ladder__chip tnum" style={{ ...chipStyle("lose"), fontWeight: 700 }}>
          L4
        </span>
      </div>

      <p className="panel__hint">
        명도가 순위를 지고 색상은 어느 편인지만 말합니다 — 흑백으로 인쇄해도 순서가
        남습니다. 흰 글씨는 사다리 전 구간에서 4.5:1 이상입니다.
      </p>
    </section>
  );
}

function chipStyle(kind: "win" | "lose") {
  const c = colorsForTag(DEFAULT_PALETTE, kind);
  return { background: c.fill, color: c.ink };
}
