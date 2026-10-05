import { useEngineStore } from "../engine/engine-state";
import type { BootPhase, EngineStatus } from "../engine/engine-types";
import { isMultiVariant, isRelaxedVariant } from "../engine/engine-client";
import { EngineSelect } from "../features/settings/engineControls";

/**
 * 상단 바의 엔진 표시 — 지금 엔진이 어떤지 한 줄과, 엔진 선택 드롭다운.
 *
 * 앱이 뜨면 엔진이 뒤에서 기동한다(`useAutoBoot`). 그동안 이 표시가 **무엇을 기다리는지**
 * (가중치 받기 → 엔진 → 예열) 말하고, 상단 바 밑에 가는 진행 줄이 흐른다. 끝나면 「준비」와
 * 떠 있는 변형으로 바뀐다. 실패하면 까닭을 툴팁에 담고 「다시 시도」를 낸다.
 *
 * 진행 줄은 양을 모르는 막대다 — 가중치 내려받기의 바이트 진행은 워커가 알리지 않는다.
 * 모르는 비율을 지어내 그리지 않는다. 움직임 줄이기 설정이면 흐르지 않는다(base.css).
 *
 * **깜빡이지 않게.** 진행 줄은 늘 붙여 두고 투명도로 드나든다(짧은 기동이면 아예 나타나지
 * 않을 만큼 늦게 나타나고, 부드럽게 사라진다). 칩의 글자 칸은 폭을 고정해 단계 글자가
 * 바뀌어도 옆의 드롭다운이 들썩이지 않는다.
 */
const PHASE_TEXT: Record<BootPhase, string> = {
  weights: "가중치 받는 중",
  engine: "엔진 올리는 중",
  warmup: "예열 중",
};

const STATUS_TEXT: Record<EngineStatus, string> = {
  idle: "엔진 꺼짐",
  starting: "엔진 준비 중",
  ready: "엔진 준비",
  searching: "탐색 중",
  error: "엔진 오류",
};

export function EngineIndicator() {
  const status = useEngineStore((s) => s.status);
  const phase = useEngineStore((s) => s.bootPhase);
  const engine = useEngineStore((s) => s.engine);
  const error = useEngineStore((s) => s.error);
  const caps = useEngineStore((s) => s.capabilities);
  const start = useEngineStore((s) => s.start);

  const variant = engine.variant
    ? `${isMultiVariant(engine.variant) ? "멀티" : "단일"}${isRelaxedVariant(engine.variant) ? " · relaxed" : ""}`
    : null;
  const detail =
    status === "starting"
      ? phase
        ? PHASE_TEXT[phase]
        : null
      : status === "ready" || status === "searching"
        ? variant
        : null;
  const title =
    status === "error"
      ? (error ?? "엔진 오류")
      : `${STATUS_TEXT[status]}${detail ? ` · ${detail}` : ""}${engine.variant ? ` (${engine.variant})` : ""}`;

  return (
    <div className="enginechip-wrap">
      <span
        className="enginechip"
        data-status={status}
        data-k="engine-indicator"
        role="status"
        aria-live="polite"
        title={title}
      >
        <span className="enginechip__dot" aria-hidden="true" />
        <span className="enginechip__text">
          {STATUS_TEXT[status]}
          {detail && <span className="enginechip__detail"> · {detail}</span>}
        </span>
        {(status === "idle" || status === "error") && caps.variant && (
          <button
            type="button"
            className="enginechip__action"
            aria-label="엔진 기동"
            onClick={() => void start()}
          >
            {status === "error" ? "다시 시도" : "켜기"}
          </button>
        )}
      </span>
      <EngineSelect compact />
      {/* 늘 붙어 있고 투명도만 바뀐다 — 붙였다 떼면 짧은 기동(캐시 ~2초)에서 번쩍인다. */}
      <span
        className="bootbar"
        data-active={status === "starting" || undefined}
        aria-hidden="true"
      />
    </div>
  );
}
