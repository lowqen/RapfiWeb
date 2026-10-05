import { useId, useState } from "react";
import { useEngineStore, threadCap } from "../../engine/engine-state";
import {
  ENGINE_PREFERENCES,
  isMultiVariant,
  planOrder,
  preferenceBlocker,
  type EnginePreference,
} from "../../engine/engine-client";
import {
  AUTO_THREADS,
  THREAD_RELOAD_COST,
  autoThreads,
  deviceCores,
  planThreadChange,
  resolveThreads,
  useSettingsStore,
} from "./settingsStore";
import { Segmented } from "./controls";
import { PREFERENCE_LABEL, VARIANT_LABEL } from "./engineLabels";

/**
 * 엔진 조작부 — 상단 바 · 설정 · 보드의 대국 탭이 함께 쓴다. 값은 모두 설정 스토어
 * 하나가 주인이라 어디서 바꾸든 같은 값이다.
 */

/**
 * 엔진 선택 드롭다운. 고르면 설정에 남고, 떠 있는 엔진은 **깨끗이 내렸다가 그 변형으로
 * 다시 띄운다**(`setEnginePreference` → `restart`). 이 환경에서 못 쓰는 항목은 꺼 두고
 * 까닭을 항목 이름에 붙인다 — 골라 놓고 조용히 다른 것이 뜨면 고장으로 읽힌다.
 *
 * 네이티브 `<select>` 다 — 펼친 목록은 운영체제의 것이라야 키보드·스크린 리더·휴대폰
 * 휠이 그대로 돈다. 겉모양만 토큰으로 칠한다(`.select`, `color-scheme`).
 */
export function EngineSelect({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const caps = useEngineStore((s) => s.capabilities);
  const pref = useSettingsStore((s) => s.enginePreference);
  const update = useSettingsStore((s) => s.update);
  return (
    <span className={"select" + (compact ? " select--compact" : "")}>
      <label htmlFor={id} className="select__label">
        엔진
      </label>
      <select
        id={id}
        className="select__input"
        aria-label="엔진 선택"
        value={pref}
        disabled={!caps.variant}
        onChange={(e) => update({ enginePreference: e.target.value as EnginePreference })}
      >
        {ENGINE_PREFERENCES.map((p) => {
          const why = preferenceBlocker(caps, p);
          const name = compact ? PREFERENCE_LABEL[p].short : PREFERENCE_LABEL[p].long;
          return (
            <option key={p} value={p} disabled={why !== null && p !== pref} title={why ?? ""}>
              {why ? `${name} — 사용 불가` : name}
            </option>
          );
        })}
      </select>
    </span>
  );
}

/** 설정 화면의 「엔진」 줄 — 드롭다운과, 지금 무엇이 왜 떠 있는지. */
export function EngineChoiceControl() {
  const caps = useEngineStore((s) => s.capabilities);
  const status = useEngineStore((s) => s.status);
  const engine = useEngineStore((s) => s.engine);
  const pref = useSettingsStore((s) => s.enginePreference);
  const planned = planOrder(caps.variants, pref).order[0] ?? caps.variant;
  const blocker = preferenceBlocker(caps, pref);
  const shown = engine.variant ?? planned;
  return (
    <div className="stack">
      <EngineSelect />
      <p className="srow__hint tnum" data-k="engine-variant">
        {shown ? `${shown} · ${VARIANT_LABEL[shown]}` : "실행 불가"}
        {engine.variant
          ? " — 실행 중"
          : status === "starting"
            ? " — 띄우는 중"
            : " (엔진을 띄우면)"}
        {engine.fallbackReason ? ` — ${engine.fallbackReason}` : blocker ? ` — ${blocker}` : ""}
        {!engine.fallbackReason && !blocker && pref === "auto" && caps.threadsNote
          ? ` — ${caps.threadsNote}`
          : ""}
      </p>
    </div>
  );
}

/**
 * 스레드 수 선택 — 자동 · 1 … 코어 수. 멀티 변형이 떠 있을 때만 엔진에 닿고, 탐색
 * 중에 바꾸면 **다음 탐색부터**다(엔진 스토어가 탐색 중에는 보내지 않는다).
 *
 * **떠 있는 멀티 엔진의 스레드 수는 곧바로 바꾸지 않는다**(P1-2). 바꿀 때마다 엔진이
 * 스레드를 다시 세우고 다음 탐색이 가중치를 다시 푼다(`THREAD_RELOAD_COST`). 1 → 2 → 3 을
 * 차례로 누르면 그 비용을 거듭 치렀다. 고른 값은 「대기」로 두고 비용을 알린 뒤 「적용」
 * 한 번에 보낸다. 엔진이 없을 때는 곧바로 저장한다 — 다음 기동의 기동 메시지로 예열 전에
 * 들어가므로(P1-1) 비용이 없다.
 */
export function ThreadControl() {
  const caps = useEngineStore((s) => s.capabilities);
  const status = useEngineStore((s) => s.status);
  const engine = useEngineStore((s) => s.engine);
  const applied = useEngineStore((s) => s.appliedThreads);
  const pref = useSettingsStore((s) => s.enginePreference);
  const v = useSettingsStore((s) => s.threads);
  const update = useSettingsStore((s) => s.update);
  /** 확정을 기다리는 선택(설정값 — 0 = 자동). */
  const [draft, setDraft] = useState<number | null>(null);

  const cores = deviceCores();
  const live = engine.threaded && (status === "ready" || status === "searching");
  const choose = (threads: number) => {
    const plan = planThreadChange({ next: threads, current: v, cores, applied, live });
    if (plan === "confirm") {
      setDraft(threads);
      return;
    }
    setDraft(null);
    if (plan === "apply") update({ threads });
  };
  const commit = () => {
    if (draft !== null) update({ threads: draft });
    setDraft(null);
  };
  const cap = threadCap(cores, engine.maxThreads);
  const single = engine.variant !== null && !isMultiVariant(engine.variant);
  const wantsMulti = pref === "auto" || pref === "multi";
  const usable = caps.threads && wantsMulti && !single;
  const wanted = resolveThreads(v, cores);
  const options = [{ value: AUTO_THREADS, label: `자동 (${Math.min(cap, autoThreads(cores))})` }];
  for (let n = 1; n <= cap; n++) options.push({ value: n, label: String(n) });

  let line: string;
  if (!caps.threads) line = "이 환경에서는 단일 스레드 엔진이라 1 입니다.";
  else if (!wantsMulti) line = "단일 스레드 엔진을 골라 1 입니다(엔진 선택).";
  else if (single) line = "단일 스레드 엔진으로 떠 있어 1 입니다.";
  else if (status === "idle" || status === "error" || applied === null) {
    line = `엔진을 띄우면 ${wanted} 스레드로 시작합니다.`;
  } else if (applied === wanted) line = `적용됨 — ${applied} 스레드로 탐색합니다.`;
  else line = `다음 탐색부터 ${wanted} 스레드 (지금 ${applied}).`;

  return (
    <div className="stack">
      <Segmented
        label="스레드 수"
        value={Math.min(draft ?? v, cap)}
        options={options}
        disabled={!usable}
        onChange={choose}
      />
      {draft !== null && (
        <div className="stack" data-k="threads-confirm">
          <p className="srow__hint tnum" role="status">
            {resolveThreads(draft, cores)} 스레드로 바꾸면 엔진이 스레드를 다시 세우고 가중치를 다시
            풀어 다음 탐색이 {THREAD_RELOAD_COST} 늦게 시작합니다.
            {status === "searching" ? " 지금 탐색은 그대로 두고 다음 탐색부터 적용됩니다." : ""}
          </p>
          <div className="actions">
            <button type="button" className="btn btn--tonal" onClick={commit}>
              적용
            </button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              취소
            </button>
          </div>
        </div>
      )}
      <p className="srow__hint tnum" data-k="threads-status">
        {line} {cores ? `이 기기의 논리 코어 ${cores}개.` : ""}
      </p>
    </div>
  );
}
