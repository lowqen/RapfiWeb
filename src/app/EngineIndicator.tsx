import { useEffect, useRef, useState } from "react";
import { msg, t } from "../i18n/i18n";
import { useEngineStore } from "../engine/engine-state";
import type { BootPhase, EngineStatus } from "../engine/engine-types";
import { isMultiVariant, isRelaxedVariant } from "../engine/engine-client";

/**
 * 상단 바의 엔진 표시 — 지금 엔진이 어떤지 낱말 하나. 엔진 선택은 설정 ▸ 자주 쓰는 설정에 있다.
 *
 * 앱이 뜨면 엔진이 뒤에서 기동한다(`useAutoBoot`). 그동안 이 표시가 **무엇을 기다리는지**
 * (가중치 받기 → 엔진 → 예열) 말하고, 상단 바 밑에 가는 진행 줄이 흐른다. 끝나면 「준비」와
 * 떠 있는 변형으로 바뀐다. 실패하면 까닭을 툴팁에 담고 「다시 시도」를 낸다.
 *
 * 진행 줄은 양을 모르는 막대다 — 가중치 내려받기의 바이트 진행은 워커가 알리지 않는다.
 * 모르는 비율을 지어내 그리지 않는다. 움직임 줄이기 설정이면 흐르지 않는다(base.css).
 *
 * **깜빡이지 않게.** 진행 줄은 늘 붙여 두고 투명도로 드나든다(`useBootBar`):
 *
 *   - 기동이 `SHOW_DELAY_MS` 안에 끝나면 아예 나타나지 않는다.
 *   - 한 번 나타나면 적어도 `MIN_VISIBLE_MS` 는 머문다 — 1초 남짓 걸리는 캐시 기동에서 줄이
 *     나타나자마자 꺼져 «번쩍»으로 읽히던 것.
 *   - 끝날 때는 뚝 끊지 않는다. 흐르던 줄은 그대로 흐르게 두고, 줄 전체가 왼쪽부터 차오른
 *     뒤(«다 됐다») 천천히 사라진다(`LEAVE_MS`). 예전에는 끝나는 순간 흐름을 멈춰 세워
 *     반쯤 지나던 조각이 그 자리에 얼어붙은 채로 꺼졌다.
 *
 * 칩의 글자 칸은 폭을 고정해 단계 글자가 바뀌어도 칩이 들썩이지 않는다.
 *
 * **점은 깜빡이지 않는다.** 기동 중(«준비 중»)의 점은 주황으로 멈춰 있다. 예전에는 투명도를
 * 오르내리는 맥박이 있었는데, 처음 접속하면 가중치 · 엔진 · 예열로 수 초(느린 기기는 더) 이어져
 * 눈이 아프다는 의견이 있었다. 진행은 상단 바 밑의 진행 줄과 단계 글자가 말한다.
 */
const PHASE_TEXT: Record<BootPhase, string> = {
  weights: msg("가중치 받는 중"),
  engine: msg("엔진 올리는 중"),
  warmup: msg("예열 중"),
};

const STATUS_TEXT: Record<EngineStatus, string> = {
  idle: msg("엔진 꺼짐"),
  starting: msg("엔진 준비 중"),
  ready: msg("엔진 준비"),
  searching: msg("탐색 중"),
  error: msg("엔진 오류"),
};

/** 이보다 빨리 끝나는 기동에는 진행 줄을 보이지 않는다. */
const SHOW_DELAY_MS = 250;
/** 한 번 나타난 진행 줄이 머무는 가장 짧은 시간 — 흐름 한 번의 앞부분이 보일 만큼. */
const MIN_VISIBLE_MS = 900;
/** 차오름(420ms) + 사라짐(200ms 뒤 450ms) — base.css 의 `.bootbar[data-phase="leaving"]` 와 짝. */
const LEAVE_MS = 650;

type BootBarPhase = "hidden" | "shown" | "leaving";

/**
 * 진행 줄의 단계 — `active`(엔진이 뜨는 중)를 깜빡이지 않는 세 단계로 바꾼다. 사라지는
 * 도중에 다시 뜨기 시작하면(엔진 전환) 기다리지 않고 곧바로 다시 보인다.
 */
function useBootBar(active: boolean): BootBarPhase {
  const [phase, setPhase] = useState<BootBarPhase>("hidden");
  const shownAt = useRef(0);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    if (active) {
      if (phase !== "shown") {
        t = setTimeout(
          () => {
            shownAt.current = performance.now();
            setPhase("shown");
          },
          phase === "leaving" ? 0 : SHOW_DELAY_MS,
        );
      }
    } else if (phase === "shown") {
      const left = shownAt.current + MIN_VISIBLE_MS - performance.now();
      t = setTimeout(() => setPhase("leaving"), Math.max(0, left));
    } else if (phase === "leaving") {
      t = setTimeout(() => setPhase("hidden"), LEAVE_MS);
    }
    return () => clearTimeout(t);
  }, [active, phase]);
  return phase;
}

export function EngineIndicator() {
  const status = useEngineStore((s) => s.status);
  const phase = useEngineStore((s) => s.bootPhase);
  const engine = useEngineStore((s) => s.engine);
  const error = useEngineStore((s) => s.error);
  const caps = useEngineStore((s) => s.capabilities);
  const start = useEngineStore((s) => s.start);
  const bar = useBootBar(status === "starting");

  const variant = engine.variant
    ? `${isMultiVariant(engine.variant) ? t("멀티") : t("단일")}${isRelaxedVariant(engine.variant) ? " · relaxed" : ""}`
    : null;
  // 화면 글은 상태 낱말과(기동 중이면) 단계까지만. 변형(멀티 · relaxed · 이름)은 툴팁 — 처음 온
  // 사람에게 «multi-simd128-relaxed» 는 읽을 거리가 아니라 소음이다.
  const detail = status === "starting" && phase ? t(PHASE_TEXT[phase]) : null;
  const title =
    status === "error"
      ? (error ?? t("엔진 오류"))
      : `${t(STATUS_TEXT[status])}${detail ? ` · ${detail}` : ""}${variant ? ` · ${variant}` : ""}${engine.variant ? ` (${engine.variant})` : ""}`;

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
          {t(STATUS_TEXT[status])}
          {detail && <span className="enginechip__detail"> · {detail}</span>}
        </span>
        {(status === "idle" || status === "error") && caps.variant && (
          <button
            type="button"
            className="enginechip__action"
            aria-label={t("엔진 기동")}
            onClick={() => void start()}
          >
            {status === "error" ? t("다시 시도") : t("켜기")}
          </button>
        )}
      </span>
      {/* 늘 붙어 있고 투명도만 바뀐다 — 붙였다 떼면 짧은 기동(캐시 ~2초)에서 번쩍인다. */}
      <span className="bootbar" data-phase={bar} aria-hidden="true" />
    </div>
  );
}
