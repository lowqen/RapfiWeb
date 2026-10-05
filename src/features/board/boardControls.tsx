import type { ReactNode } from "react";
import { MOVE_TIME_CHOICES, LEVELS, useGameStore } from "./gameStore";
import { MULTI_PV } from "../../engine/engine-state";
import {
  COMPUTER_SIDE_LABEL,
  OPENING_HINT,
  OPENING_LABEL,
  OPENING_NOTICE,
  type ComputerSide,
  type OpeningProtocol,
} from "../../core/model/game";
import { RULE_LABEL } from "../../core/model/rules";
import { ANALYSIS_SEC_CHOICES, useSettingsStore } from "../settings/settingsStore";
import { Chip, ChipGroup, Segmented, Stepper, Switch } from "../settings/controls";

/**
 * 보드 탭의 조작부 — 예전에 설정 화면의 「자주 쓰는 설정」에 있던 것들이다.
 *
 * 대국 값(개시 · 컴퓨터 색 · 착수 시간 · 레벨)은 `gameStore` 가, 분석 값(분석 시간 ·
 * 후보 수 · 정지하면 최선수 두기)은 설정 스토어가 주인이다. 화면만 옮겼고 주인은 그대로라
 * 두 곳에 같은 값이 생기지 않는다 — 설정 화면에서는 이 줄들을 뺐다.
 */

const SIDES: readonly ComputerSide[] = ["none", "black", "white", "both"];
const OPENINGS: readonly OpeningProtocol[] = ["none", "rif", "swapFirst"];

/**
 * 룰셋 — 기반 규칙(렌주 고정)과 개시 방식을 한 줄에. 웹은 렌주 가중치만 싣기 때문에
 * 규칙은 고르는 것이 아니라 **보여 주는** 것이고, 고르는 것은 개시다.
 */
export function RulesetControl() {
  const opening = useGameStore((s) => s.opening);
  const setOpening = useGameStore((s) => s.setOpening);
  return (
    <div className="stack">
      <div className="ruleset">
        <span className="pill" title="INFO RULE 4 — 웹 버전은 렌주 가중치만 싣습니다">
          {RULE_LABEL.renju}
        </span>
        <ChipGroup label="오프닝">
          {OPENINGS.map((o) => (
            <Chip key={o} on={opening === o} title={OPENING_HINT[o]} onClick={() => setOpening(o)}>
              {OPENING_LABEL[o]}
            </Chip>
          ))}
        </ChipGroup>
      </div>
      <p className="srow__hint">{OPENING_HINT[opening]}</p>
      <p className="srow__hint" data-k="opening-notice">
        {OPENING_NOTICE}
      </p>
    </div>
  );
}

/** 흑/백 선택 — 컴퓨터가 어느 색을 맡는가. */
export function ComputerControl() {
  const side = useGameStore((s) => s.computerSide);
  const setSide = useGameStore((s) => s.setComputerSide);
  return (
    <ChipGroup label="컴퓨터">
      {SIDES.map((s) => (
        <Chip key={s} on={side === s} onClick={() => setSide(s)}>
          {COMPUTER_SIDE_LABEL[s]}
        </Chip>
      ))}
    </ChipGroup>
  );
}

const moveTimeLabel = (ms: number) => (ms === 0 ? "무제한" : `${ms / 1000}초`);

/** 시간 제어 — 엔진 한 수의 시간. 대국 시계 없이 `timeout_turn` 하나만 정한다. */
export function MoveTimeControl() {
  const v = useGameStore((s) => s.moveTimeMs);
  const set = useGameStore((s) => s.setMoveTime);
  return (
    <ChipGroup label="엔진 착수 시간">
      {MOVE_TIME_CHOICES.map((ms) => (
        <Chip key={ms} on={v === ms} onClick={() => set(ms)}>
          {moveTimeLabel(ms)}
        </Chip>
      ))}
    </ChipGroup>
  );
}

const nodes = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}K`);

/** 레벨 — 노드 수로 끊는 세기(`LEVELS`). 대국의 착수에만 얹힌다. */
export function LevelControl() {
  const v = useGameStore((s) => s.level);
  const set = useGameStore((s) => s.setLevel);
  return (
    <Segmented
      label="레벨"
      value={v}
      options={LEVELS.map((l) => ({
        value: l.level,
        label: l.label,
        title: l.maxNode
          ? `한 수에 ${nodes(l.maxNode)} 노드까지`
          : "노드 제한 없음(설정의 최대 노드)",
      }))}
      onChange={set}
    />
  );
}

const secLabel = (s: number) => (s === 0 ? "무제한" : `${s}초`);

export function AnalysisTimeControl() {
  const v = useSettingsStore((s) => s.analysisSec);
  const update = useSettingsStore((s) => s.update);
  return (
    <Segmented
      label="분석 시간"
      value={v}
      options={ANALYSIS_SEC_CHOICES.map((s) => ({ value: s, label: secLabel(s) }))}
      onChange={(analysisSec) => update({ analysisSec })}
    />
  );
}

export function MultiPvControl() {
  const v = useSettingsStore((s) => s.multiPv);
  const update = useSettingsStore((s) => s.update);
  return (
    <Stepper
      label="후보 수"
      value={v}
      min={MULTI_PV.min}
      max={MULTI_PV.max}
      onChange={(multiPv) => update({ multiPv })}
    />
  );
}

export function PlayBestOnStopControl() {
  const on = useSettingsStore((s) => s.playBestOnStop);
  const update = useSettingsStore((s) => s.update);
  return (
    <Switch
      label="정지하면 최선수 두기"
      on={on}
      onChange={(playBestOnStop) => update({ playBestOnStop })}
    />
  );
}

/** 탭 안의 한 줄 — 이름 · 설명 · 조작부. 설정 화면의 `.srow` 와 같은 모양을 빌린다. */
export function Row({
  label,
  note,
  wide,
  id,
  children,
}: {
  label: string;
  note?: string;
  wide?: boolean;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="srow srow--panel" data-row={id} data-wide={wide || undefined}>
      <div className="srow__text">
        <span className="srow__label">{label}</span>
        {note && <p className="srow__note">{note}</p>}
      </div>
      <div className="srow__control">{children}</div>
    </div>
  );
}
