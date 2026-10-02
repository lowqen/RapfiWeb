import { useMemo, useState, type ComponentType } from "react";
import { MOVE_TIME_CHOICES, useGameStore } from "../board/gameStore";
import { useBoardStore } from "../board/boardStore";
import { useEngineStore, MULTI_PV, threadCap } from "../../engine/engine-state";
import { isMultiVariant, type EngineVariant } from "../../engine/engine-client";
import { useThemeStore, type ThemeMode } from "../../app/theme";
import {
  COMPUTER_SIDE_LABEL,
  OPENING_HINT,
  OPENING_LABEL,
  OPENING_NOTICE,
  type ComputerSide,
  type OpeningProtocol,
} from "../../core/model/game";
import { RULE_LABEL } from "../../core/model/rules";
import {
  ANALYSIS_SEC_CHOICES,
  HASH_CHOICES_MB,
  MAX_DEPTH_LIMIT,
  MAX_NODE_CHOICES,
  AUTO_THREADS,
  MIN_DEPTH,
  STYLE_RANGE,
  THREAD_RELOAD_COST,
  autoThreads,
  deviceCores,
  planThreadChange,
  resolveThreads,
  useSettingsStore,
  type VcThread,
} from "./settingsStore";
import { Chip, ChipGroup, NumberField, Segmented, Stepper, Switch } from "./controls";

/**
 * 설정 — 두 층.
 *
 * **자주 쓰는 설정** 카드 하나가 늘 펼쳐져 있다: 룰셋(렌주 + 개시) · 컴퓨터가 둘 색 ·
 * 엔진 착수 시간 · 분석 시간 · 후보 수 · 스레드 수 · 다크 모드. 대국을 시작하기 전에
 * 만지는 것이 전부 여기 있다.
 *
 * 그 밑의 **고급 설정** 스위치를 켜야 엔진 탐색 파라미터(해시·스타일·깊이·노드·위협
 * 확인)와 표시·초기화가 나온다. 켜 둔 상태는 저장된다(`showAdvanced`). 검색은 층을
 * 가리지 않는다 — 이름이나 INFO 키를 아는 사람이 스위치부터 찾게 하지 않는다.
 *
 * 줄마다 그 값이 엔진의 어느 `INFO` 키를 움직이는지 적는다(앱의 `engineKey`).
 *
 * 전에 있던 줄 중 대국 진행(새 대국·기권·무승부)은 보드로, 해시 지금 비우기는 엔진
 * 탭으로 갔다. 켤 수 없는 줄(사색·데이터베이스)과 렌주 하나뿐인 규칙 선택은 뺐다 —
 * 누를 수 없는 조작부는 설정을 고장 난 것으로 읽히게 한다.
 */

type Section = "basic" | "engine" | "display" | "system";

const SECTION_LABEL: Record<Section, string> = {
  basic: "자주 쓰는 설정",
  engine: "엔진",
  display: "표시",
  system: "시스템",
};

const SECTION_DESC: Record<Section, string> = {
  basic: "대국과 분석의 기본. 엔진이 떠 있으면 바꾸는 즉시 반영됩니다.",
  engine: "엔진에 INFO 로 밀어 넣는 탐색 파라미터. 탐색 중에 바꾸면 다음 탐색부터 적용됩니다.",
  display: "보드에 무엇을 그릴지.",
  system: "설정 자체의 저장과 초기화.",
};

const ADVANCED: readonly Section[] = ["engine", "display", "system"];
const SECTIONS: readonly Section[] = ["basic", ...ADVANCED];

interface RowSpec {
  id: string;
  sec: Section;
  label: string;
  note?: string;
  /** 이 값이 움직이는 엔진 명령(`INFO <key>` 등). 검색 대상이다. */
  engineKey?: string;
  /** 검색에만 쓰는 낱말. */
  keywords?: string;
  /** 조작부가 제 줄 아래로 넓게 내려간다(칩이 여럿일 때). */
  wide?: boolean;
  Control: ComponentType;
}

// ── 조작부 ─────────────────────────────────────────────────────────

const SIDES: readonly ComputerSide[] = ["none", "black", "white", "both"];
const OPENINGS: readonly OpeningProtocol[] = ["none", "rif", "swapFirst"];

/**
 * 룰셋 — 기반 규칙(렌주 고정)과 개시 방식을 한 줄에. 웹은 렌주 가중치만 싣기 때문에
 * 규칙은 고르는 것이 아니라 **보여 주는** 것이고, 고르는 것은 개시다.
 */
function RulesetControl() {
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

function ComputerControl() {
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

/** 엔진 한 수의 시간 — 대국 시계 없이 `timeout_turn` 하나만 정한다. */
function MoveTimeControl() {
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

const VARIANT_LABEL: Record<EngineVariant, string> = {
  "multi-simd128-relaxed": "멀티스레드 · relaxed SIMD",
  "multi-simd128": "멀티스레드",
  "single-simd128-relaxed": "단일 스레드 · relaxed SIMD",
  "single-simd128": "단일 스레드",
};

/**
 * 스레드 수 선택 — 자동 · 1 … 코어 수. 멀티 변형이 떠 있을 때만 엔진에 닿고, 탐색
 * 중에 바꾸면 **다음 탐색부터**다(엔진 스토어가 탐색 중에는 보내지 않는다).
 *
 * 밑의 두 줄이 지금 엔진이 실제로 쓰는 값과 **어느 변형이 왜** 떠 있는지를 말한다.
 * 멀티를 못 쓰는 환경에서 「1」만 보여 주면 설정이 고장 난 것으로 읽힌다 — 그래서
 * 따로 있던 「엔진 변형」 줄을 여기에 접어 넣었다.
 *
 * **떠 있는 멀티 엔진의 스레드 수는 곧바로 바꾸지 않는다**(P1-2). 바꿀 때마다 엔진이
 * 스레드를 다시 세우고 다음 탐색이 가중치를 다시 푼다(`THREAD_RELOAD_COST`). 1 → 2 → 3 을
 * 차례로 누르면 그 비용을 거듭 치렀다. 고른 값은 「대기」로 두고 비용을 알린 뒤 「적용」
 * 한 번에 보낸다. 엔진이 없을 때는 곧바로 저장한다 — 다음 기동의 기동 메시지로 예열 전에
 * 들어가므로(P1-1) 비용이 없다.
 */
function ThreadControl() {
  const caps = useEngineStore((s) => s.capabilities);
  const status = useEngineStore((s) => s.status);
  const engine = useEngineStore((s) => s.engine);
  const applied = useEngineStore((s) => s.appliedThreads);
  const allow = useSettingsStore((s) => s.allowThreads);
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
  const usable = caps.threads && allow && !single;
  const wanted = resolveThreads(v, cores);
  const options = [{ value: AUTO_THREADS, label: `자동 (${Math.min(cap, autoThreads(cores))})` }];
  for (let n = 1; n <= cap; n++) options.push({ value: n, label: String(n) });

  let line: string;
  if (!caps.threads) line = "이 환경에서는 단일 스레드 엔진이라 1 입니다.";
  else if (!allow) line = "멀티스레드를 꺼 두어 1 입니다(고급 설정).";
  else if (single) line = "단일 스레드 엔진으로 떠 있어 1 입니다.";
  else if (status === "idle" || status === "error" || applied === null) {
    line = `엔진을 띄우면 ${wanted} 스레드로 시작합니다.`;
  } else if (applied === wanted) line = `적용됨 — ${applied} 스레드로 탐색합니다.`;
  else line = `다음 탐색부터 ${wanted} 스레드 (지금 ${applied}).`;

  // 띄우면 무엇이 뜰지 — 멀티를 꺼 두었으면 순서에서 멀티를 뺀 첫 변형.
  const planned: EngineVariant | null =
    caps.variants.find((x) => allow || !isMultiVariant(x)) ?? null;
  const shown = engine.variant ?? planned;
  const why = engine.fallbackReason
    ? `앞선 변형이 기동에 실패해 물러섰습니다 — ${engine.fallbackReason}`
    : caps.threadsNote;

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
      <p className="srow__hint tnum" data-k="engine-variant">
        엔진 {shown ? `${shown} · ${VARIANT_LABEL[shown]}` : "실행 불가"}
        {engine.variant ? "" : status === "idle" ? " (엔진을 띄우면)" : ""}
        {why ? ` — ${why}` : ""}
      </p>
    </div>
  );
}

/** 멀티스레드 변형을 쓸지. 떠 있는 엔진과 어긋나면 다시 띄우는 버튼을 낸다. */
function AllowThreadsControl() {
  const caps = useEngineStore((s) => s.capabilities);
  const status = useEngineStore((s) => s.status);
  const engine = useEngineStore((s) => s.engine);
  const restart = useEngineStore((s) => s.restart);
  const allow = useSettingsStore((s) => s.allowThreads);
  const update = useSettingsStore((s) => s.update);
  const running = status === "ready" || status === "searching";
  // 떠 있는 변형이 지금 설정과 다르다(물러선 경우는 다시 띄워도 같으므로 제외).
  const stale =
    running &&
    ((allow && caps.threads && !engine.threaded && !engine.fallbackReason) ||
      (!allow && engine.threaded));
  return (
    <div className="actions">
      <Switch
        label="멀티스레드 사용"
        on={allow && caps.threads}
        disabled={!caps.threads}
        onChange={(v) => update({ allowThreads: v })}
      />
      {stale && (
        <button type="button" className="btn" onClick={() => void restart()}>
          엔진 다시 띄우기
        </button>
      )}
    </div>
  );
}

function HashControl() {
  const v = useSettingsStore((s) => s.hashMb);
  const update = useSettingsStore((s) => s.update);
  return (
    <Segmented
      label="해시 크기"
      value={v}
      options={HASH_CHOICES_MB.map((mb) => ({ value: mb, label: `${mb}` }))}
      onChange={(hashMb) => update({ hashMb })}
    />
  );
}

function StyleControl() {
  const v = useSettingsStore((s) => s.style);
  const update = useSettingsStore((s) => s.update);
  const options: { value: number; label: string }[] = [];
  for (let i = STYLE_RANGE.min; i <= STYLE_RANGE.max; i++) {
    const label =
      i === STYLE_RANGE.min ? `${i} 성급` : i === STYLE_RANGE.max ? `${i} 신중` : `${i}`;
    options.push({ value: i, label });
  }
  return (
    <Segmented label="스타일" value={v} options={options} onChange={(style) => update({ style })} />
  );
}

function MaxDepthControl() {
  const v = useSettingsStore((s) => s.maxDepth);
  const update = useSettingsStore((s) => s.update);
  return (
    <NumberField
      label="최대 깊이"
      hideLabel
      unit="플라이"
      min={MIN_DEPTH}
      max={MAX_DEPTH_LIMIT}
      value={v}
      onCommit={(maxDepth) => update({ maxDepth })}
    />
  );
}

const nodeLabel = (n: number) =>
  n < 0 ? "무제한" : n >= 100_000_000 ? `${n / 100_000_000}억` : `${n / 10_000}만`;

function MaxNodeControl() {
  const v = useSettingsStore((s) => s.maxNode);
  const update = useSettingsStore((s) => s.update);
  return (
    <Segmented
      label="최대 노드"
      value={v}
      options={MAX_NODE_CHOICES.map((n) => ({ value: n, label: nodeLabel(n) }))}
      onChange={(maxNode) => update({ maxNode })}
    />
  );
}

function VcThreadControl() {
  const v = useSettingsStore((s) => s.vcThread);
  const update = useSettingsStore((s) => s.update);
  const options: { value: VcThread; label: string }[] = [
    { value: 0, label: "없음" },
    { value: 1, label: "VCT 확인" },
    { value: 2, label: "VC2 확인" },
  ];
  return (
    <Segmented
      label="추가 위협 확인"
      value={v}
      options={options}
      onChange={(vcThread) => update({ vcThread })}
    />
  );
}

function HashAutoClearControl() {
  const on = useSettingsStore((s) => s.hashAutoClear);
  const update = useSettingsStore((s) => s.update);
  return <Switch label="해시 자동 지우기" on={on} onChange={(v) => update({ hashAutoClear: v })} />;
}

const secLabel = (s: number) => (s === 0 ? "무제한" : `${s}초`);

function AnalysisTimeControl() {
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

function MultiPvControl() {
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

function EvalBarControl() {
  const on = useSettingsStore((s) => s.showEvalBar);
  const update = useSettingsStore((s) => s.update);
  return <Switch label="평가 바 표시" on={on} onChange={(v) => update({ showEvalBar: v })} />;
}

function NumbersControl() {
  const on = useBoardStore((s) => s.render.showNumbers);
  const toggle = useBoardStore((s) => s.toggleNumbers);
  return <Switch label="번호 매기기" on={on} onChange={toggle} />;
}

function ForbiddenControl() {
  const on = useGameStore((s) => s.showForbidden);
  const toggle = useGameStore((s) => s.toggleForbidden);
  return <Switch label="금수 표시" on={on} onChange={toggle} />;
}

const THEMES: readonly { value: ThemeMode; label: string }[] = [
  { value: "system", label: "시스템" },
  { value: "light", label: "밝게" },
  { value: "dark", label: "어둡게" },
];

function ThemeControl() {
  const mode = useThemeStore((s) => s.mode);
  const set = useThemeStore((s) => s.set);
  return <Segmented label="다크 모드" value={mode} options={THEMES} onChange={set} />;
}

function ResetControl() {
  const reset = useSettingsStore((s) => s.reset);
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="btn" onClick={() => setAsking(true)}>
        기본값으로 되돌리기
      </button>
    );
  }
  // 되돌릴 수 없는 동작이라 한 번 더 묻는다(데스크톱의 「실행 취소 경고」).
  return (
    <div className="actions">
      <button
        type="button"
        className="btn btn--danger"
        onClick={() => {
          reset();
          setAsking(false);
        }}
      >
        되돌리기
      </button>
      <button type="button" className="btn" onClick={() => setAsking(false)}>
        취소
      </button>
    </div>
  );
}

// ── 목록 ───────────────────────────────────────────────────────────

const ROWS: readonly RowSpec[] = [
  // 자주 쓰는 설정 — 대국을 시작하기 전에 만지는 순서대로.
  {
    id: "ruleset",
    sec: "basic",
    label: "룰셋",
    note: "기반 규칙은 렌주이고, 고르는 것은 개시 방식입니다. 바꾸면 새 대국이 시작됩니다.",
    engineKey: "INFO RULE",
    keywords: "규칙 렌주 renju 개시 오프닝 RIF 교환 swap",
    wide: true,
    Control: RulesetControl,
  },
  {
    id: "computer",
    sec: "basic",
    label: "컴퓨터가 둘 색",
    note: "엔진 차례에 판을 누르면 엔진이 둡니다. 보드의 「진영 전환」으로 대국 중에도 흑백을 맞바꿉니다.",
    keywords: "컴퓨터 흑 백 사람 진영",
    wide: true,
    Control: ComputerControl,
  },
  {
    id: "moveTime",
    sec: "basic",
    label: "엔진 착수 시간",
    note: "대국에서 엔진이 한 수에 쓰는 시간. 무제한이면 보드의 「지금 두기」까지 읽습니다(데스크톱 level 0).",
    engineKey: "timeout_turn",
    keywords: "레벨 턴 시간 무제한 level",
    wide: true,
    Control: MoveTimeControl,
  },
  {
    id: "analysisTime",
    sec: "basic",
    label: "분석 시간",
    note: "무제한이면 정지하거나 국면이 바뀔 때까지 읽고, 수를 두면 새 국면을 이어 읽습니다.",
    keywords: "무제한 예산",
    wide: true,
    Control: AnalysisTimeControl,
  },
  {
    id: "multiPv",
    sec: "basic",
    label: "후보 수 (멀티 PV)",
    note: "1 이면 최선 수 하나만 깊게 읽습니다. 다음 분석부터 적용됩니다.",
    engineKey: "YXNBEST",
    keywords: "nbest pv",
    Control: MultiPvControl,
  },
  {
    id: "threads",
    sec: "basic",
    label: "스레드 수",
    note: "자동은 코어 하나를 화면에 남기고(코어 − 1) 4 를 넘기지 않습니다. 엔진이 떠 있을 때 바꾸면 가중치를 다시 푸는 비용(약 0.8초)을 알리고 「적용」을 눌러야 바뀝니다. 탐색 중이면 다음 탐색부터입니다.",
    engineKey: "thread_num",
    keywords: "threads 코어 cpu wasm simd rapfi multi single 멀티 단일 변형",
    wide: true,
    Control: ThreadControl,
  },
  {
    id: "theme",
    sec: "basic",
    label: "다크 모드",
    note: "시스템이면 기기 설정을 따릅니다.",
    keywords: "테마 dark",
    wide: true,
    Control: ThemeControl,
  },

  // 고급 — 엔진
  {
    id: "allowThreads",
    sec: "engine",
    label: "멀티스레드 사용",
    note: "끄면 환경이 되어도 단일 스레드 엔진을 씁니다. 바꾸면 엔진을 다시 띄워야 적용됩니다.",
    keywords: "multi-simd128 pthread 멀티",
    Control: AllowThreadsControl,
  },
  {
    id: "hash",
    sec: "engine",
    label: "해시 크기 (MB)",
    note: "탭 메모리 안에서 — 데스크톱 기본값 8192MB 는 브라우저 탭을 죽입니다. 엔진에는 KB 로 보냅니다(MB<<10).",
    engineKey: "hash_size",
    keywords: "메모리 tt",
    wide: true,
    Control: HashControl,
  },
  {
    id: "hashAutoClear",
    sec: "engine",
    label: "해시 자동 지우기",
    note: "탐색마다 앞서 YXHASHCLEAR 를 보냅니다. 끄면 앞 탐색이 읽은 것을 이어 씁니다. 지금 한 번 비우기는 엔진 탭에.",
    engineKey: "YXHASHCLEAR",
    Control: HashAutoClearControl,
  },
  {
    id: "style",
    sec: "engine",
    label: "스타일",
    note: "0 성급함 … 5 신중함.",
    engineKey: "caution_factor",
    wide: true,
    Control: StyleControl,
  },
  {
    id: "maxDepth",
    sec: "engine",
    label: "최대 깊이",
    note: `${MAX_DEPTH_LIMIT}(보드 칸 수)이면 사실상 무제한입니다.`,
    engineKey: "max_depth",
    Control: MaxDepthControl,
  },
  {
    id: "maxNode",
    sec: "engine",
    label: "최대 노드 수",
    note: "탐색 한 번이 읽을 노드 상한.",
    engineKey: "max_node",
    wide: true,
    Control: MaxNodeControl,
  },
  {
    id: "vcthread",
    sec: "engine",
    label: "전역 검색 추가 위협 확인",
    engineKey: "vcthread",
    keywords: "vct vc2",
    wide: true,
    Control: VcThreadControl,
  },

  // 고급 — 표시
  {
    id: "evalBar",
    sec: "display",
    label: "평가 바 표시",
    note: "보드 왼쪽의 흑백 게이지. 흑 승률만큼 위(흑)가 차고, 끝에 승률과 평가값을 적습니다.",
    keywords: "eval bar 승률 게이지",
    Control: EvalBarControl,
  },
  {
    id: "numbers",
    sec: "display",
    label: "번호 매기기",
    note: "돌 위에 수 번호.",
    Control: NumbersControl,
  },
  {
    id: "forbidden",
    sec: "display",
    label: "금수 표시",
    note: "흑 차례에 엔진이 알려 주는 금수를 그립니다.",
    engineKey: "YXSHOWFORBID",
    Control: ForbiddenControl,
  },

  // 고급 — 시스템
  {
    id: "reset",
    sec: "system",
    label: "설정 초기화",
    note: "엔진·분석·표시 설정을 기본값으로. 대국은 건드리지 않습니다. 설정은 이 브라우저에만 저장됩니다.",
    keywords: "기본값 reset",
    Control: ResetControl,
  },
];

const ADVANCED_COUNT = ROWS.filter((r) => r.sec !== "basic").length;

const matches = (r: RowSpec, q: string) =>
  !q ||
  [r.label, r.note, r.engineKey, r.keywords, SECTION_LABEL[r.sec]]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);

function Group({ sec, rows }: { sec: Section; rows: readonly RowSpec[] }) {
  return (
    <section className="panel sgroup" data-sec={sec} aria-labelledby={`sg-${sec}`}>
      <header className="sgroup__head">
        <h2 id={`sg-${sec}`} className="sgroup__title">
          {SECTION_LABEL[sec]}
        </h2>
        <p className="sgroup__desc">{SECTION_DESC[sec]}</p>
      </header>
      {rows.map((r) => (
        <div key={r.id} className="srow" data-row={r.id} data-wide={r.wide || undefined}>
          <div className="srow__text">
            <span className="srow__label">{r.label}</span>
            {r.engineKey && <code className="srow__key">{r.engineKey}</code>}
            {r.note && <p className="srow__note">{r.note}</p>}
          </div>
          <div className="srow__control">
            <r.Control />
          </div>
        </div>
      ))}
    </section>
  );
}

export function SettingsScreen() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const status = useEngineStore((s) => s.status);
  const advanced = useSettingsStore((s) => s.showAdvanced);
  const update = useSettingsStore((s) => s.update);

  // 검색 중에는 층을 가리지 않는다. 검색이 비었으면 고급은 스위치를 따른다.
  const visible = useMemo(
    () => ROWS.filter((r) => (q ? matches(r, q) : r.sec === "basic" || advanced)),
    [q, advanced],
  );
  const groups = SECTIONS.map((sec) => ({
    sec,
    rows: visible.filter((r) => r.sec === sec),
  })).filter((g) => g.rows.length > 0);
  const live = status === "ready" || status === "searching";
  const basic = groups.find((g) => g.sec === "basic");
  const rest = groups.filter((g) => g.sec !== "basic");

  return (
    <div className="settings">
      <div className="settings__head">
        <div className="search">
          <svg className="icon search__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            className="search__input"
            type="search"
            placeholder="설정 검색 (이름·설명·INFO 키) — 고급 설정까지 찾습니다"
            aria-label="설정 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="settings__meta tnum">
          {visible.length}/{ROWS.length} ·{" "}
          {live ? "엔진 실행 중 — 변경 즉시 반영" : "엔진 꺼짐 — 기동할 때 반영"}
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="settings__empty">「{query}」에 맞는 설정이 없습니다.</p>
      ) : (
        <>
          {basic && <Group sec="basic" rows={basic.rows} />}
          {/* 고급 설정 스위치 — 검색 중에는 숨긴다(검색이 이미 층을 가리지 않으므로). */}
          {!q && (
            <section className="panel sadvanced" aria-labelledby="sg-advanced">
              <div className="sadvanced__text">
                <h2 id="sg-advanced" className="sgroup__title">
                  고급 설정
                </h2>
                <p className="sgroup__desc">
                  {advanced
                    ? "엔진 탐색 파라미터 · 표시 · 초기화가 아래에 펼쳐져 있습니다."
                    : `해시 · 스타일 · 깊이 · 노드 · 표시 · 초기화 — ${ADVANCED_COUNT}개 숨김`}
                </p>
              </div>
              <Switch
                label="고급 설정"
                on={advanced}
                onChange={(v) => update({ showAdvanced: v })}
              />
            </section>
          )}
          {rest.map(({ sec, rows }) => (
            <Group key={sec} sec={sec} rows={rows} />
          ))}
        </>
      )}
    </div>
  );
}
