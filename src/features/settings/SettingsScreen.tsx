import { useMemo, useState, type ComponentType } from "react";
import { useGameStore } from "../board/gameStore";
import { useBoardStore } from "../board/boardStore";
import { OpeningProgress } from "../board/OpeningPanel";
import { useEngineStore, MULTI_PV } from "../../engine/engine-state";
import { useThemeStore, type ThemeMode } from "../../app/theme";
import {
  COMPUTER_SIDE_LABEL,
  OPENING_HINT,
  OPENING_LABEL,
  OPENING_NOTICE,
  describeResult,
  type ComputerSide,
  type OpeningProtocol,
} from "../../core/model/game";
import { RULE_ID, RULE_LABEL, isSupported, unsupportedRuleNotice } from "../../core/model/rules";
import {
  ANALYSIS_SEC_CHOICES,
  HASH_CHOICES_MB,
  MAX_DEPTH_LIMIT,
  MAX_NODE_CHOICES,
  MIN_DEPTH,
  STYLE_RANGE,
  useSettingsStore,
  type VcThread,
} from "./settingsStore";
import { Chip, ChipGroup, NumberField, Segmented, Stepper, Switch } from "./controls";

/**
 * 설정 — 앱 `SettingsScreen.kt` 의 구조를 옮긴 것.
 *
 * 위에 **검색과 분류 칩만** 고정하고, 나머지는 분류별 카드로 흐른다. 앱이 겪은 일을
 * 그대로 피한다: 고정 머리에 도구를 쌓았더니 가로 휴대폰에서 목록 높이가 0 이 됐다.
 *
 * 줄마다 그 값이 엔진의 어느 `INFO` 키를 움직이는지 적는다(앱의 `engineKey`).
 * 검색도 그 키로 된다 — 데스크톱 설정 파일을 들고 온 사람은 이름보다 키를 먼저 안다.
 *
 * 값의 주인은 제각각이다: 대국 값은 `gameStore`, 표시 일부는 `boardStore`·테마,
 * 엔진·분석은 `settingsStore`. 이 화면은 그 주인들을 직접 만진다.
 */

type Category = "game" | "time" | "engine" | "analysis" | "display" | "database" | "system";

const CATEGORY_LABEL: Record<Category, string> = {
  game: "대국",
  time: "시간 제어",
  engine: "엔진",
  analysis: "분석",
  display: "표시",
  database: "데이터베이스",
  system: "시스템",
};

const CATEGORY_DESC: Record<Category, string> = {
  game: "규칙·개시·누가 두는가. 개시를 바꾸면 새 대국이 시작됩니다.",
  time: "대국 시계. 시간 제한이 있으면 엔진도 그 예산 안에서 둡니다.",
  engine: "엔진에 INFO 로 밀어 넣는 탐색 파라미터. 탐색 중에 바꾸면 다음 탐색부터 적용됩니다.",
  analysis: "보드의 분석(▶). 무제한이면 정지하거나 국면이 바뀔 때까지 읽습니다.",
  display: "보드와 화면에 무엇을 그릴지.",
  database: "yixindb 국면 저장소.",
  system: "설정 자체의 저장과 초기화.",
};

const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

interface RowSpec {
  id: string;
  cat: Category;
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

function GameProgress() {
  const g = useGameStore();
  const stones = useBoardStore((s) => s.render.stones.length);
  const playing = !g.result && stones > 0;
  return (
    <div className="stack">
      {g.result ? (
        <p className="gameover" data-winner={g.result.winner ?? "draw"}>
          {describeResult(g.result)}
        </p>
      ) : (
        <p className="srow__status tnum">
          {stones === 0 ? "빈 판" : `${stones}수 · ${stones % 2 === 0 ? "흑" : "백"} 차례`}
          {g.thinking ? " · 엔진 생각 중" : ""}
        </p>
      )}
      <OpeningProgress />
      <div className="actions">
        <button type="button" className="btn btn--tonal" onClick={g.newGame}>
          새 대국
        </button>
        <button type="button" className="btn" onClick={g.resign} disabled={!playing}>
          기권
        </button>
        <button type="button" className="btn" onClick={g.offerDraw} disabled={!playing}>
          무승부
        </button>
      </div>
    </div>
  );
}

const RULES = ["freestyle", "standard", "renju"] as const;

function RuleControl() {
  return (
    <Segmented
      label="규칙"
      value="renju"
      options={RULES.map((r) => ({
        value: r,
        label: RULE_LABEL[r],
        disabled: !isSupported(r),
        title: isSupported(r) ? `INFO RULE ${RULE_ID[r]}` : unsupportedRuleNotice(r),
      }))}
      onChange={() => undefined}
    />
  );
}

function OpeningControl() {
  const opening = useGameStore((s) => s.opening);
  const setOpening = useGameStore((s) => s.setOpening);
  return (
    <div className="stack">
      <ChipGroup label="오프닝">
        {OPENINGS.map((o) => (
          <Chip key={o} on={opening === o} title={OPENING_HINT[o]} onClick={() => setOpening(o)}>
            {OPENING_LABEL[o]}
          </Chip>
        ))}
      </ChipGroup>
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

/** 시간 제한 프리셋. 데스크톱의 커스텀 레벨(settings.txt 6행 = 1)에 해당한다. */
const TIME_PRESETS = [
  { label: "무제한", limited: false, turn: 0, match: 0 },
  { label: "5분", limited: true, turn: 30_000, match: 300_000 },
  { label: "15분", limited: true, turn: 60_000, match: 900_000 },
  { label: "30분", limited: true, turn: 120_000, match: 1_800_000 },
] as const;

function TimeControl() {
  const clock = useGameStore((s) => s.clock);
  const setLimits = useGameStore((s) => s.setClockLimits);
  const preset = TIME_PRESETS.find(
    (p) =>
      clock.limited === p.limited &&
      (!p.limited || (clock.turnLimitMs === p.turn && clock.matchLimitMs === p.match)),
  );
  const [customOpen, setCustomOpen] = useState(false);
  const custom = customOpen || (clock.limited && !preset);

  return (
    <div className="stack">
      <ChipGroup label="시간 제한">
        {TIME_PRESETS.map((p) => (
          <Chip
            key={p.label}
            on={!customOpen && preset === p}
            onClick={() => {
              setCustomOpen(false);
              setLimits({ limited: p.limited, turnLimitMs: p.turn, matchLimitMs: p.match });
            }}
          >
            {p.label}
          </Chip>
        ))}
        <Chip
          on={custom}
          onClick={() => {
            setCustomOpen(true);
            setLimits({
              limited: true,
              turnLimitMs: clock.turnLimitMs || 60_000,
              matchLimitMs: clock.matchLimitMs || 600_000,
            });
          }}
        >
          사용자 정의
        </Chip>
      </ChipGroup>
      {custom && (
        <div className="fields">
          <NumberField
            label="턴 시간"
            unit="초"
            min={1}
            max={3600}
            value={Math.round(clock.turnLimitMs / 1000)}
            onCommit={(v) => setLimits({ limited: true, turnLimitMs: v * 1000 })}
          />
          <NumberField
            label="대국 시간"
            unit="분"
            min={1}
            max={600}
            value={Math.round(clock.matchLimitMs / 60_000)}
            onCommit={(v) => setLimits({ limited: true, matchLimitMs: v * 60_000 })}
          />
          <NumberField
            label="수당 증가"
            unit="초"
            min={0}
            max={60}
            value={Math.round(clock.incrementMs / 1000)}
            onCommit={(v) => setLimits({ limited: true, incrementMs: v * 1000 })}
          />
        </div>
      )}
    </div>
  );
}

function ShowClockControl() {
  const on = useSettingsStore((s) => s.showClock);
  const update = useSettingsStore((s) => s.update);
  return <Switch label="시계 표시" on={on} onChange={(v) => update({ showClock: v })} />;
}

function VariantControl() {
  const caps = useEngineStore((s) => s.capabilities);
  const status = useEngineStore((s) => s.status);
  return (
    <span className="pill tnum" data-status={status}>
      {caps.variant ?? "실행 불가"}
    </span>
  );
}

function ThreadControl() {
  return <span className="pill tnum">1 · 단일 스레드</span>;
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

function PonderingControl() {
  return <Switch label="사색" on={false} onChange={() => undefined} disabled />;
}

function HashAutoClearControl() {
  const on = useSettingsStore((s) => s.hashAutoClear);
  const update = useSettingsStore((s) => s.update);
  return <Switch label="해시 자동 지우기" on={on} onChange={(v) => update({ hashAutoClear: v })} />;
}

function HashClearNowControl() {
  const status = useEngineStore((s) => s.status);
  const send = useEngineStore((s) => s.send);
  return (
    <button
      type="button"
      className="btn"
      disabled={status === "idle" || status === "error" || status === "starting"}
      onClick={() => send({ kind: "raw", line: "YXHASHCLEAR" })}
    >
      지금 비우기
    </button>
  );
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

function DatabaseOffControl() {
  return <Switch label="데이터베이스" on={false} onChange={() => undefined} disabled />;
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
  {
    id: "progress",
    cat: "game",
    label: "대국 진행",
    note: "새 대국은 판·시계·물음을 함께 비웁니다. 기권·무승부는 엔진에도 알립니다(yxresign · yxdraw).",
    keywords: "새 대국 기권 무승부 결과",
    wide: true,
    Control: GameProgress,
  },
  {
    id: "rule",
    cat: "game",
    label: "규칙",
    note: "웹 버전은 렌주 가중치만 싣습니다 — 다른 규칙은 앱이나 데스크톱 Yixin 에서.",
    engineKey: "INFO RULE",
    keywords: "렌주 프리스타일 스탠다드 renju",
    Control: RuleControl,
  },
  {
    id: "opening",
    cat: "game",
    label: "개시 규칙",
    note: "기반 규칙은 렌주이고, 고르는 것은 개시 방식입니다.",
    keywords: "오프닝 RIF 교환 swap",
    wide: true,
    Control: OpeningControl,
  },
  {
    id: "computer",
    cat: "game",
    label: "컴퓨터가 둘 색",
    note: "엔진 차례에 판을 누르면 엔진이 둡니다 — 새 대국에서도 저절로 두지 않습니다.",
    keywords: "컴퓨터 흑 백 사람",
    wide: true,
    Control: ComputerControl,
  },
  {
    id: "timeLimit",
    cat: "time",
    label: "시간 제한",
    note: "무제한이면 엔진은 보드의 「지금 두기」까지 읽습니다(데스크톱 level 0).",
    engineKey: "timeout_turn · timeout_match · time_increment",
    keywords: "레벨 턴 매치 증가 시계",
    wide: true,
    Control: TimeControl,
  },
  {
    id: "showClock",
    cat: "time",
    label: "시계 표시",
    note: "보드 화면의 두 시계. 꺼도 시계는 계속 갑니다.",
    Control: ShowClockControl,
  },
  {
    id: "variant",
    cat: "engine",
    label: "엔진 변형",
    note: "WebAssembly SIMD 빌드. 멀티스레드 변형은 COOP/COEP 를 켤 수 있을 때 살아납니다.",
    keywords: "wasm simd rapfi",
    Control: VariantControl,
  },
  {
    id: "threads",
    cat: "engine",
    label: "스레드 수",
    note: "단일 스레드 빌드라 1로 고정입니다.",
    engineKey: "thread_num",
    Control: ThreadControl,
  },
  {
    id: "hash",
    cat: "engine",
    label: "해시 크기 (MB)",
    note: "탭 메모리 안에서 — 데스크톱 기본값 8192MB 는 브라우저 탭을 죽입니다. 엔진에는 KB 로 보냅니다(MB<<10).",
    engineKey: "hash_size",
    keywords: "메모리 tt",
    wide: true,
    Control: HashControl,
  },
  {
    id: "style",
    cat: "engine",
    label: "스타일",
    note: "0 성급함 … 5 신중함.",
    engineKey: "caution_factor",
    wide: true,
    Control: StyleControl,
  },
  {
    id: "maxDepth",
    cat: "engine",
    label: "최대 깊이",
    note: `${MAX_DEPTH_LIMIT}(보드 칸 수)이면 사실상 무제한입니다.`,
    engineKey: "max_depth",
    Control: MaxDepthControl,
  },
  {
    id: "maxNode",
    cat: "engine",
    label: "최대 노드 수",
    note: "탐색 한 번이 읽을 노드 상한.",
    engineKey: "max_node",
    wide: true,
    Control: MaxNodeControl,
  },
  {
    id: "vcthread",
    cat: "engine",
    label: "전역 검색 추가 위협 확인",
    engineKey: "vcthread",
    keywords: "vct vc2",
    wide: true,
    Control: VcThreadControl,
  },
  {
    id: "pondering",
    cat: "engine",
    label: "사색",
    note: "단일 스레드 빌드에서는 켤 수 없습니다 — 상대 차례에 엔진이 읽기 시작하면 정지가 닿을 틈이 없습니다.",
    engineKey: "pondering",
    keywords: "ponder",
    Control: PonderingControl,
  },
  {
    id: "hashAutoClear",
    cat: "engine",
    label: "해시 자동 지우기",
    note: "탐색마다 앞서 YXHASHCLEAR 를 보냅니다. 끄면 앞 탐색이 읽은 것을 이어 씁니다.",
    engineKey: "YXHASHCLEAR",
    Control: HashAutoClearControl,
  },
  {
    id: "hashClearNow",
    cat: "engine",
    label: "해시 비우기",
    note: "지금 한 번. 엔진이 떠 있을 때만.",
    engineKey: "YXHASHCLEAR",
    Control: HashClearNowControl,
  },
  {
    id: "analysisTime",
    cat: "analysis",
    label: "분석 시간",
    note: "무제한이면 정지하거나 국면이 바뀔 때까지 읽고, 수를 두면 새 국면을 이어 읽습니다.",
    keywords: "무제한 예산",
    wide: true,
    Control: AnalysisTimeControl,
  },
  {
    id: "multiPv",
    cat: "analysis",
    label: "후보 수 (멀티 PV)",
    note: "다음 분석부터 적용됩니다.",
    engineKey: "YXNBEST",
    keywords: "nbest pv",
    Control: MultiPvControl,
  },
  {
    id: "numbers",
    cat: "display",
    label: "번호 매기기",
    note: "돌 위에 수 번호.",
    Control: NumbersControl,
  },
  {
    id: "forbidden",
    cat: "display",
    label: "금수 표시",
    note: "흑 차례에 엔진이 알려 주는 금수를 그립니다.",
    engineKey: "YXSHOWFORBID",
    Control: ForbiddenControl,
  },
  {
    id: "theme",
    cat: "display",
    label: "다크 모드",
    note: "시스템이면 기기 설정을 따릅니다. 데스크톱 settings.txt 27행과 같은 값입니다.",
    keywords: "테마 dark",
    wide: true,
    Control: ThemeControl,
  },
  {
    id: "useDatabase",
    cat: "database",
    label: "데이터베이스 사용",
    note: "DB 화면이 열리는 단계(W6)에서 켤 수 있습니다 — yixindb 를 브라우저 저장소에 올리는 일이 먼저입니다.",
    engineKey: "usedatabase",
    keywords: "yixindb db",
    Control: DatabaseOffControl,
  },
  {
    id: "databaseReadonly",
    cat: "database",
    label: "데이터베이스 읽기 전용",
    note: "위와 같습니다.",
    engineKey: "database_readonly",
    Control: DatabaseOffControl,
  },
  {
    id: "reset",
    cat: "system",
    label: "설정 초기화",
    note: "엔진·분석·표시 설정을 기본값으로. 대국은 건드리지 않습니다. 설정은 이 브라우저에만 저장됩니다.",
    keywords: "기본값 reset",
    Control: ResetControl,
  },
];

const matches = (r: RowSpec, q: string) =>
  !q ||
  [r.label, r.note, r.engineKey, r.keywords, CATEGORY_LABEL[r.cat]]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);

export function SettingsScreen() {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<Category | null>(null);
  const q = query.trim().toLowerCase();
  const status = useEngineStore((s) => s.status);

  const visible = useMemo(
    () => ROWS.filter((r) => (cat === null || r.cat === cat) && matches(r, q)),
    [cat, q],
  );
  const groups = CATEGORIES.map((c) => ({ c, rows: visible.filter((r) => r.cat === c) })).filter(
    (g) => g.rows.length > 0,
  );
  const live = status === "ready" || status === "searching";

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
            placeholder="설정 검색 (이름·설명·INFO 키)"
            aria-label="설정 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="catbar" role="group" aria-label="분류">
          <Chip on={cat === null} onClick={() => setCat(null)}>
            전체
          </Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c} on={cat === c} onClick={() => setCat(c)}>
              {CATEGORY_LABEL[c]}
            </Chip>
          ))}
        </div>
        <p className="settings__meta tnum">
          {visible.length}/{ROWS.length} ·{" "}
          {live ? "엔진 실행 중 — 변경 즉시 반영" : "엔진 꺼짐 — 기동할 때 반영"}
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="settings__empty">「{query}」에 맞는 설정이 없습니다.</p>
      ) : (
        groups.map(({ c, rows }) => (
          <section key={c} className="panel sgroup" aria-labelledby={`sg-${c}`}>
            <header className="sgroup__head">
              <h2 id={`sg-${c}`} className="sgroup__title">
                {CATEGORY_LABEL[c]}
              </h2>
              <p className="sgroup__desc">{CATEGORY_DESC[c]}</p>
            </header>
            {rows.map((r) => (
              <div key={r.id} className="srow" data-wide={r.wide || undefined}>
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
        ))
      )}
    </div>
  );
}
