import { useMemo, useRef, useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore, type BoardMode } from "../board/gameStore";
import { useBoardStore } from "../board/boardStore";
import { useEngineStore } from "../../engine/engine-state";
import { useThemeStore, type ThemeMode } from "../../app/theme";
import {
  HASH_CHOICES_MB,
  MAX_DEPTH_LIMIT,
  MAX_NODE_CHOICES,
  MIN_DEPTH,
  STYLE_RANGE,
  useSettingsStore,
  type VcThread,
} from "./settingsStore";
import { NumberField, Segmented, Switch } from "../../components/controls";
import { EngineChoiceControl, ThreadControl } from "./engineControls";
import { exportDesktopFiles, importDesktopFiles } from "./desktopBridge";
import { AboutPanel } from "./AboutPanel";
import { useAdminTools } from "../joseki/admin";
import { MAPPED_IDS } from "../../core/settings/desktop-bridge";
import { ALL_SPECS } from "../../core/settings/desktop-settings";
import { msg, pick, setLang, t, useLang, type Lang } from "../../i18n/i18n";

/**
 * 설정 — 두 층.
 *
 * **자주 쓰는 설정** 카드 하나가 늘 펼쳐져 있다: 엔진 선택 · 스레드 수 · 자동 기동 ·
 * 다크 모드, 그리고 대국·분석 설정이 어디로 갔는지 알려 주는 길잡이 줄.
 *
 * **대국과 분석의 설정은 보드의 두 탭으로 옮겼다.** 컴퓨터 색 · 착수 시간 · 레벨 · 개시는
 * [대국] 탭, 분석 시간 · 후보 수 · 정지하면 최선수 두기는 [분석] 탭에 있다 — 대국을
 * 시작하거나 분석을 돌리는 바로 그 자리다. 같은 조작부를 여기에도 두면 어느 쪽이 참인지
 * 되묻게 되어 뺐다(값의 주인은 그대로 `gameStore`·설정 스토어다). 검색은 그 이름들을
 * 길잡이 줄로 찾아 준다.
 *
 * 그 밑의 **고급 설정** 스위치를 켜야 엔진 탐색 파라미터(해시·스타일·깊이·노드·위협
 * 확인)와 표시·초기화가 나온다. 켜 둔 상태는 저장된다(`showAdvanced`). 검색은 층을
 * 가리지 않는다 — 이름이나 INFO 키를 아는 사람이 스위치부터 찾게 하지 않는다.
 *
 * 줄마다 그 값이 엔진의 어느 `INFO` 키를 움직이는지 적는다(앱의 `engineKey`).
 */

type Section = "basic" | "engine" | "display" | "system";

/** 이름 · 설명 · 낱말은 사전 열쇠(한국어 원문) — 그릴 때 `t()`. 검색은 두 언어를 다 본다. */
const SECTION_LABEL: Record<Section, string> = {
  basic: msg("자주 쓰는 설정"),
  engine: msg("엔진"),
  display: msg("표시"),
  system: msg("시스템"),
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

function AutoBootControl() {
  const on = useSettingsStore((s) => s.autoBoot);
  const update = useSettingsStore((s) => s.update);
  return (
    <Switch
      label={t("앱을 열면 엔진 시작")}
      on={on}
      onChange={(autoBoot) => update({ autoBoot })}
    />
  );
}

/** 관리자 도구 — 정석 편집기에 «공식 커리큘럼으로 내보내기»를 보인다(보안 장치 아님, `joseki/admin.ts`). */
function AdminToolsControl() {
  const on = useAdminTools((a) => a.on);
  const set = useAdminTools((a) => a.set);
  return <Switch label={t("관리자 도구")} on={on} onChange={set} />;
}

/** 대국·분석 설정이 옮겨 간 자리로 — 누르면 그 탭을 연 보드로 간다. */
function BoardTabsControl() {
  const navigate = useNavigate();
  const setMode = useGameStore((s) => s.setMode);
  const open = (m: BoardMode) => {
    setMode(m);
    navigate("/board");
  };
  return (
    <div className="actions">
      <button type="button" className="btn" onClick={() => open("analysis")}>
        {t("보드 › 분석 탭")}
      </button>
      <button type="button" className="btn" onClick={() => open("game")}>
        {t("보드 › 대국 탭")}
      </button>
    </div>
  );
}

function HashControl() {
  const v = useSettingsStore((s) => s.hashMb);
  const update = useSettingsStore((s) => s.update);
  return (
    <Segmented
      label={t("해시 크기")}
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
      i === STYLE_RANGE.min
        ? `${i} ${t("성급")}`
        : i === STYLE_RANGE.max
          ? `${i} ${t("신중")}`
          : `${i}`;
    options.push({ value: i, label });
  }
  return (
    <Segmented
      label={t("스타일")}
      value={v}
      options={options}
      onChange={(style) => update({ style })}
    />
  );
}

function MaxDepthControl() {
  const v = useSettingsStore((s) => s.maxDepth);
  const update = useSettingsStore((s) => s.update);
  return (
    <NumberField
      label={t("최대 깊이")}
      hideLabel
      unit={t("플라이")}
      min={MIN_DEPTH}
      max={MAX_DEPTH_LIMIT}
      value={v}
      onCommit={(maxDepth) => update({ maxDepth })}
    />
  );
}

const nodeLabel = (n: number) =>
  n < 0
    ? t("무제한")
    : pick(
        n >= 100_000_000 ? `${n / 100_000_000}억` : `${n / 10_000}만`,
        n >= 1e9 ? `${n / 1e9}B` : n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}K`,
      );

function MaxNodeControl() {
  const v = useSettingsStore((s) => s.maxNode);
  const update = useSettingsStore((s) => s.update);
  return (
    <Segmented
      label={t("최대 노드")}
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
    { value: 0, label: t("없음") },
    { value: 1, label: t("VCT 확인") },
    { value: 2, label: t("VC2 확인") },
  ];
  return (
    <Segmented
      label={t("추가 위협 확인")}
      value={v}
      options={options}
      onChange={(vcThread) => update({ vcThread })}
    />
  );
}

function HashAutoClearControl() {
  const on = useSettingsStore((s) => s.hashAutoClear);
  const update = useSettingsStore((s) => s.update);
  return (
    <Switch label={t("해시 자동 지우기")} on={on} onChange={(v) => update({ hashAutoClear: v })} />
  );
}

function EvalBarControl() {
  const on = useSettingsStore((s) => s.showEvalBar);
  const update = useSettingsStore((s) => s.update);
  return <Switch label={t("평가 바 표시")} on={on} onChange={(v) => update({ showEvalBar: v })} />;
}

function NumbersControl() {
  const on = useBoardStore((s) => s.render.showNumbers);
  const toggle = useBoardStore((s) => s.toggleNumbers);
  return <Switch label={t("번호 매기기")} on={on} onChange={toggle} />;
}

function ForbiddenControl() {
  const on = useGameStore((s) => s.showForbidden);
  const toggle = useGameStore((s) => s.toggleForbidden);
  return <Switch label={t("금수 표시")} on={on} onChange={toggle} />;
}

const THEMES: readonly { value: ThemeMode; label: string }[] = [
  { value: "system", label: msg("시스템") },
  { value: "light", label: msg("밝게") },
  { value: "dark", label: msg("어둡게") },
];

function ThemeControl() {
  const mode = useThemeStore((s) => s.mode);
  const set = useThemeStore((s) => s.set);
  return (
    <Segmented
      label={t("다크 모드")}
      value={mode}
      options={THEMES.map((o) => ({ ...o, label: t(o.label) }))}
      onChange={set}
    />
  );
}

/** 언어(W10) — 항목 이름은 그 언어 자신의 이름으로(읽지 못하는 화면에서도 찾게). */
const LANGS: readonly { value: Lang; label: string; lang: string }[] = [
  { value: "ko", label: "한국어", lang: "ko" },
  { value: "en", label: "English", lang: "en" },
];

function LangControl() {
  const lang = useLang((s) => s.lang);
  return <Segmented label={t("언어")} value={lang} options={LANGS} onChange={setLang} />;
}

/**
 * 데스크톱 settings.txt · settings_dev.txt 가져오기 · 내보내기(W5b). 67칸 중 웹이 뜻을 가진 칸만
 * 웹 값이 되고, 나머지는 들고 있다가 내보낼 때 돌려준다(`desktopBridge.ts`).
 */
function DesktopFileControl() {
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="desktopfile">
      <div className="actions">
        <button type="button" className="btn" onClick={() => input.current?.click()}>
          {t("가져오기")}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            exportDesktopFiles();
            setResult(t("settings.txt · settings_dev.txt 를 내려받았습니다"));
          }}
        >
          {t("내보내기")}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".txt,text/plain"
        multiple
        hidden
        data-k="desktop-settings-input"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = "";
          if (!files.length) return;
          void importDesktopFiles(files).then((r) => {
            const got = r.files.map((f) => `${f.name}${f.file ? "" : t("(모름)")}`).join(", ");
            setResult([t("가져옴: {files}", { files: got }), ...r.notes].join("\n"));
          });
        }}
      />
      {result && (
        <p className="desktopfile__result" role="status" data-k="desktop-settings-result">
          {result}
        </p>
      )}
    </div>
  );
}

function ResetControl() {
  const reset = useSettingsStore((s) => s.reset);
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="btn" onClick={() => setAsking(true)}>
        {t("기본값으로 되돌리기")}
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
        {t("되돌리기")}
      </button>
      <button type="button" className="btn" autoFocus onClick={() => setAsking(false)}>
        {t("취소")}
      </button>
    </div>
  );
}

// ── 목록 ───────────────────────────────────────────────────────────

const ROWS: readonly RowSpec[] = [
  // 자주 쓰는 설정 — 엔진과 화면.
  {
    id: "engine",
    sec: "basic",
    label: msg("엔진"),
    note: msg("바꾸면 엔진을 다시 띄웁니다(분석은 이어 읽음)"),
    keywords:
      "wasm simd relaxed standard multi single thread pthread 멀티 단일 변형 바이너리 멀티스레드 사용",
    wide: true,
    Control: EngineChoiceControl,
  },
  {
    id: "threads",
    sec: "basic",
    label: msg("스레드 수"),
    note: msg("자동 = 코어 − 1 (최대 4)"),
    engineKey: "thread_num",
    keywords: "threads 코어 cpu",
    wide: true,
    Control: ThreadControl,
  },
  {
    id: "autoBoot",
    sec: "basic",
    label: msg("앱을 열면 엔진 시작"),
    note: msg("가중치 20MB 는 처음 한 번만 받습니다"),
    keywords: "자동 기동 부팅 autoboot 시작",
    Control: AutoBootControl,
  },
  {
    id: "boardTabs",
    sec: "basic",
    label: msg("대국 · 분석 설정"),
    note: msg("컴퓨터 색 · 착수 시간 · 레벨 · 개시 · 분석 시간 · 후보 수"),
    keywords:
      "컴퓨터 흑 백 사람 진영 착수 시간 레벨 level timeout_turn 룰셋 규칙 렌주 개시 오프닝 RIF 교환 swap 분석 시간 후보 nbest pv 멀티 PV 정지 최선수",
    wide: true,
    Control: BoardTabsControl,
  },
  {
    id: "theme",
    sec: "basic",
    label: msg("다크 모드"),

    keywords: "테마 dark theme light",
    wide: true,
    Control: ThemeControl,
  },
  {
    id: "lang",
    sec: "basic",
    label: msg("언어"),
    keywords: "language lang english korean 한국어 영어",
    wide: true,
    Control: LangControl,
  },

  // 고급 — 엔진
  {
    id: "hash",
    sec: "engine",
    label: msg("해시 크기 (MB)"),
    note: msg("탭 메모리 한도 안에서"),
    engineKey: "hash_size",
    keywords: "메모리 tt",
    wide: true,
    Control: HashControl,
  },
  {
    id: "hashAutoClear",
    sec: "engine",
    label: msg("해시 자동 지우기"),
    note: msg("탐색마다 해시를 비웁니다"),
    engineKey: "YXHASHCLEAR",
    Control: HashAutoClearControl,
  },
  {
    id: "style",
    sec: "engine",
    label: msg("스타일"),

    engineKey: "caution_factor",
    wide: true,
    Control: StyleControl,
  },
  {
    id: "maxDepth",
    sec: "engine",
    label: msg("최대 깊이"),
    note: msg("{n} = 무제한"),
    engineKey: "max_depth",
    Control: MaxDepthControl,
  },
  {
    id: "maxNode",
    sec: "engine",
    label: msg("최대 노드 수"),

    engineKey: "max_node",
    wide: true,
    Control: MaxNodeControl,
  },
  {
    id: "vcthread",
    sec: "engine",
    label: msg("전역 검색 추가 위협 확인"),
    engineKey: "vcthread",
    keywords: "vct vc2",
    wide: true,
    Control: VcThreadControl,
  },

  // 고급 — 표시
  {
    id: "evalBar",
    sec: "display",
    label: msg("평가 바 표시"),

    keywords: "eval bar 승률 게이지",
    Control: EvalBarControl,
  },
  {
    id: "numbers",
    sec: "display",
    label: msg("번호 매기기"),

    Control: NumbersControl,
  },
  {
    id: "forbidden",
    sec: "display",
    label: msg("금수 표시"),

    engineKey: "YXSHOWFORBID",
    Control: ForbiddenControl,
  },

  // 고급 — 시스템
  {
    id: "desktopFile",
    sec: "system",
    label: msg("데스크톱 설정 파일"),
    note: msg(
      "settings.txt · settings_dev.txt ({all}칸 중 {mapped}칸이 웹에 반영, 나머지는 그대로 보관)",
    ),
    keywords: "settings.txt settings_dev.txt pc 데스크톱 가져오기 내보내기 import export yixin",
    wide: true,
    Control: DesktopFileControl,
  },
  {
    id: "adminTools",
    sec: "system",
    label: msg("관리자 도구"),
    note: msg("정석 편집기에 공식 커리큘럼 내보내기를 보입니다. 배포는 저장소 커밋으로만 됩니다"),
    keywords: "admin 관리자 커리큘럼 curriculum 공식 정석 내보내기",
    Control: AdminToolsControl,
  },
  {
    id: "reset",
    sec: "system",
    label: msg("설정 초기화"),
    note: msg("대국은 그대로입니다"),
    keywords: "기본값 reset",
    Control: ResetControl,
  },
];

const ADVANCED_COUNT = ROWS.filter((r) => r.sec !== "basic").length;

/** 설명의 자리 값(`{n}` 등) — 줄마다 같다. */
const NOTE_VARS = { n: MAX_DEPTH_LIMIT, all: ALL_SPECS.length, mapped: MAPPED_IDS.length };
const noteOf = (r: RowSpec) => (r.note ? t(r.note, NOTE_VARS) : undefined);

/** 검색은 두 언어를 다 본다 — 영어 화면에서 한국어 낱말로 찾아도 걸린다. */
const matches = (r: RowSpec, q: string) =>
  !q ||
  [
    r.label,
    t(r.label),
    r.note,
    noteOf(r),
    r.engineKey,
    r.keywords,
    SECTION_LABEL[r.sec],
    t(SECTION_LABEL[r.sec]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);

function Group({ sec, rows }: { sec: Section; rows: readonly RowSpec[] }) {
  return (
    <section className="panel sgroup" data-sec={sec} aria-labelledby={`sg-${sec}`}>
      <header className="sgroup__head">
        <h2 id={`sg-${sec}`} className="sgroup__title">
          {t(SECTION_LABEL[sec])}
        </h2>
      </header>
      {rows.map((r) => (
        <div key={r.id} className="srow" data-row={r.id} data-wide={r.wide || undefined}>
          {/* 설명은 펼쳐 적지 않고 툴팁으로 — 화면에는 이름만. 검색은 여전히 설명까지 찾는다.
              INFO 키 꼬리표는 고급 설정에서만(엔진 파라미터를 만지는 사람의 것이다). */}
          <div className="srow__text" title={noteOf(r)}>
            <span className="srow__label">{t(r.label)}</span>
            {r.engineKey && sec !== "basic" && <code className="srow__key">{r.engineKey}</code>}
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
            placeholder={t("설정 검색")}
            aria-label={t("설정 검색")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="settings__meta tnum">
          {visible.length}/{ROWS.length} · {live ? t("즉시 반영") : t("기동할 때 반영")}
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="settings__empty">{t("「{q}」에 맞는 설정이 없습니다.", { q: query })}</p>
      ) : (
        <>
          {basic && <Group sec="basic" rows={basic.rows} />}
          {/* 고급 설정 스위치 — 검색 중에는 숨긴다(검색이 이미 층을 가리지 않으므로). */}
          {!q && (
            <section className="panel sadvanced" aria-labelledby="sg-advanced">
              <div className="sadvanced__text">
                <h2 id="sg-advanced" className="sgroup__title">
                  {t("고급 설정")}
                </h2>
                <p className="sgroup__desc">
                  {advanced
                    ? t("해시 · 스타일 · 깊이 · 노드 · 표시")
                    : t("{n}개 숨김", { n: ADVANCED_COUNT })}
                </p>
              </div>
              <Switch
                label={t("고급 설정")}
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
      {/* 정보 · 라이선스 고지(GPLv3) — 검색과 고급 스위치와 무관하게 맨 아래에 늘 있다. */}
      {!q && <AboutPanel />}
    </div>
  );
}
