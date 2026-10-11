import { msg, t } from "../i18n/i18n";

/**
 * 레일 여섯 항목과 연구 네 탭 — 앱의 `Destinations.kt` 구조를 보존한 것.
 *
 * 앱은 «일곱 개는 한눈에 안 읽힌다»는 판단으로 하단 5탭 + 연구 4서브탭을 골랐다.
 * 웹이라고 그 판단이 틀려지지 않는다. **그룹 구조를 보존하되 데스크톱의 넓이를
 * 쓴다** — 레일 6 = 앱 5탭 + 정석(신규).
 *
 * 요구된 «한 번의 클릭»: 레일 6개는 항상 1클릭이고, 연구 서브탭은 연구 화면
 * 안에서 1클릭, 다른 화면에서는 레일의 «연구»에 hover 하면 펼쳐지는 서브메뉴로
 * 1클릭을 보장한다(`NavRail`).
 */

export interface Dest {
  /** 라우트 경로. 활성 판정은 이 접두사로 한다. */
  path: string;
  /** 레일·탭 라벨 — 번역 열쇠(`msg`). 그릴 때 `t()` 한다. */
  label: string;
  /** 인라인 SVG path. 아이콘 폰트도 CDN 도 쓰지 않는다(§5의 «외부 리소스 없음»). */
  icon: string;
  /**
   * 레일에서 어느 묶음인가. 두고 · 공부하는 셋(보드 · 연구 · 정석)이 위, 도구 셋(DB · 엔진 · 설정)이
   * 아래로 떨어진다 — 처음 온 사람의 눈이 위의 셋에 먼저 간다. 하단 탭은 순서만 이 묶음을 따른다.
   */
  group?: "tools";
}

/** Material Symbols 계열의 24×24 뷰박스에 맞춘 단순 도형들. */
const ICON = {
  board:
    "M3 3h18v18H3V3zm2 2v4h4V5H5zm6 0v4h4V5h-4zm6 0v4h2V5h-2zM5 11v4h4v-4H5zm6 0v4h4v-4h-4zm6 0v4h2v-4h-2zM5 17v2h4v-2H5zm6 0v2h4v-2h-4zm6 0v2h2v-2h-2z",
  research:
    "M9 2v6.5L4.3 17.2A3 3 0 0 0 6.9 21h10.2a3 3 0 0 0 2.6-3.8L15 8.5V2H9zm2 2h2v5l4.6 8.4a1 1 0 0 1-.9 1.6H6.9a1 1 0 0 1-.9-1.6L11 9V4z",
  database:
    "M12 2c4.4 0 8 1.3 8 3v14c0 1.7-3.6 3-8 3s-8-1.3-8-3V5c0-1.7 3.6-3 8-3zm6 6.6c-1.6.8-3.9 1.2-6 1.2s-4.4-.4-6-1.2v3.1c1.6.8 3.9 1.2 6 1.2s4.4-.4 6-1.2V8.6zM6 5c0 .5 2.4 1.4 6 1.4s6-.9 6-1.4-2.4-1.4-6-1.4S6 4.5 6 5z",
  engine: "M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10.5 2h3l.4 2.6c.5.2 1 .4 1.4.7l2.4-1.1 1.5 2.6-2 1.7c0 .3.1.6.1.9s0 .6-.1.9l2 1.7-1.5 2.6-2.4-1.1c-.4.3-.9.5-1.4.7L13.5 22h-3l-.4-2.6c-.5-.2-1-.4-1.4-.7l-2.4 1.1-1.5-2.6 2-1.7c0-.3-.1-.6-.1-.9s0-.6.1-.9l-2-1.7 1.5-2.6 2.4 1.1c.4-.3.9-.5 1.4-.7L10.5 2z",
  joseki: "M4 3h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H4V3zm16 0h-4a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h5V3z",
} as const;

export const RAIL: readonly Dest[] = [
  { path: "/board", label: msg("보드"), icon: ICON.board },
  { path: "/research", label: msg("연구"), icon: ICON.research },
  { path: "/joseki", label: msg("정석"), icon: ICON.joseki },
  { path: "/database", label: "DB", icon: ICON.database, group: "tools" },
  { path: "/engine", label: msg("엔진"), icon: ICON.engine, group: "tools" },
  { path: "/settings", label: msg("설정"), icon: ICON.settings, group: "tools" },
];

/**
 * 연구 네 탭. 앱의 `ResearchScreen.kt` 와 같은 순서·같은 문구다.
 * 경로 이름은 W1 지시서의 것을 쓴다(explorer = 오프닝 익스플로러, sequence = 수순).
 */
export const RESEARCH_TABS: readonly Dest[] = [
  { path: "/research/review", label: msg("리뷰·증명"), icon: "" },
  { path: "/research/explorer", label: msg("오프닝"), icon: "" },
  { path: "/research/sequence", label: msg("수순"), icon: "" },
  { path: "/research/ranking", label: msg("랭킹"), icon: "" },
];

/** 지금 위치에 해당하는 레일 항목. 접두사 일치 — `/research/review` 는 «연구». */
export function activeDest(pathname: string): Dest | undefined {
  return RAIL.find((d) => pathname === d.path || pathname.startsWith(d.path + "/"));
}

/** 상단 바가 쓸 제목. 연구 안에서는 탭 쪽이 더 구체적이므로 그것을 쓴다. */
export function titleFor(pathname: string): { title: string } {
  const tab = RESEARCH_TABS.find((r) => pathname.startsWith(r.path));
  if (tab) return { title: `${t("연구")} · ${t(tab.label)}` };
  const dest = activeDest(pathname);
  return { title: dest ? t(dest.label) : "RapfiWeb" };
}
