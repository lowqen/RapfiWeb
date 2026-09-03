import type { Move } from "./move";

/**
 * 대국 자체가 아닌 모든 것 — `core/model/GameModels.kt` 의 이식본.
 *
 * **웹은 렌주 전용이다.** 기반 규칙은 언제나 렌주이고, 그 위에 얹히는 것이
 * 오프닝 협상(`OpeningProtocol`)이다. 앱도 같은 구조다 — 데스크톱의 `specialrule`
 * 이 기반 규칙 위에 얹히는 층이라, 「7종 규칙」 중 렌주 계열만 남긴다는 것은
 * 곧 **기반은 렌주 하나 + 협상 다섯**을 뜻한다.
 */

export type StoneColor = "black" | "white";

export const other = (c: StoneColor): StoneColor => (c === "black" ? "white" : "black");

/** 수 번호(0부터)로 색을 정한다. 흑이 먼저다. */
export const colorAt = (index: number): StoneColor => (index % 2 === 0 ? "black" : "white");

// ── 엔진이 잡는 색 ────────────────────────────────────────────────────

/**
 * 데스크톱의 `computerside` 비트마스크(main.c:74, settings.txt 4·5행).
 */
export const COMPUTER_SIDE = {
  none: 0,
  black: 1,
  white: 2,
  both: 3,
} as const;

export type ComputerSide = keyof typeof COMPUTER_SIDE;

export const COMPUTER_SIDE_LABEL: Record<ComputerSide, string> = {
  none: "사람 대 사람",
  black: "컴퓨터 흑",
  white: "컴퓨터 백",
  both: "컴퓨터 양쪽",
};

export function enginePlays(side: ComputerSide, color: StoneColor): boolean {
  const bits = COMPUTER_SIDE[side];
  return color === "black" ? (bits & 1) !== 0 : (bits & 2) !== 0;
}

/**
 * 색을 맞바꾼다. 데스크톱의 `change_side_menu` 짝과 같다 — else 분기가 흑을 끄고
 * 백을 켜므로 «양쪽»과 «없음»도 각각 백·백으로 떨어진다(main.c:2365).
 */
export function swappedSide(side: ComputerSide): ComputerSide {
  switch (side) {
    case "white":
      return "black";
    case "black":
      return "white";
    case "both":
      return "white";
    case "none":
      return "white";
  }
}

// ── 오프닝 협상 ───────────────────────────────────────────────────────

/**
 * 데스크톱의 `specialrule`. settings.txt 3행에서 `load_setting`(main.c:14070)과
 * 똑같이 해독한다 — 메뉴 콜백 `change_rule` 은 3과 4를 반대로 맵핑하는데,
 * 그건 데스크톱 자신의 불일치다. 파일이 양쪽이 저장하는 것이므로 파일이 이긴다.
 */
export type OpeningProtocol = "none" | "rif" | "swapFirst" | "soosorv" | "swap2";

export const OPENING_LABEL: Record<OpeningProtocol, string> = {
  none: "자유 렌주",
  rif: "RIF 오프닝",
  swapFirst: "첫 수 이후 교환",
  soosorv: "Soosorv-8",
  swap2: "스왑2",
};

export const OPENING_HINT: Record<OpeningProtocol, string> = {
  none: "협상 없이 흑부터 둡니다.",
  rif: "첫 세 수를 천원 둘레에 손으로 놓고 시작합니다.",
  swapFirst: "흑이 한 수를 놓으면 상대가 그 색을 가져갈지 정합니다.",
  soosorv: "첫 세 수를 손으로 놓고, 흑이 5수 후보를 N개(1~8) 제시합니다.",
  swap2: "흑 둘·백 하나를 놓은 뒤 상대가 셋 중 하나를 고릅니다.",
};

/** 첫 세 수를 손으로 놓는 협상 — 그 안에서는 엔진에게 두라고 하지 않는다. */
export const handEnteredOpening = (o: OpeningProtocol): boolean =>
  o === "rif" || o === "soosorv";

/** 협상이 있는가. 없으면 협상 pane 을 아예 그리지 않는다. */
export const negotiates = (o: OpeningProtocol): boolean => o !== "none";

// ── 결과 ─────────────────────────────────────────────────────────────

export type GameEnd = "five" | "boardFull" | "resigned" | "drawAgreed" | "timeout";

export const GAME_END_LABEL: Record<GameEnd, string> = {
  five: "5목 완성",
  boardFull: "판이 다 찼습니다",
  resigned: "기권",
  drawAgreed: "무승부 합의",
  timeout: "시간 초과",
};

export interface GameResult {
  end: GameEnd;
  /** 무승부면 `null`. */
  winner: StoneColor | null;
}

export function describeResult(r: GameResult): string {
  if (r.winner === null) return GAME_END_LABEL[r.end];
  const who = r.winner === "black" ? "흑 승" : "백 승";
  return `${who} · ${GAME_END_LABEL[r.end]}`;
}

// ── 물어보는 것들 ─────────────────────────────────────────────────────

/** 데스크톱의 세 버튼 Swap2 대화상자(main.c:2347). */
export type Swap2Choice = "stayWhite" | "swap" | "addTwo";

export const SWAP2_CHOICE_LABEL: Record<Swap2Choice, string> = {
  stayWhite: "백 유지",
  swap: "색 교환",
  addTwo: "두 수 추가",
};

/**
 * 게임이 사용자에게 물어보는 것, 또는 알려 주는 것. 각 항목이 데스크톱의 대화상자
 * 하나에 대응한다.
 */
export type GamePrompt =
  /** `show_dialog_swap_query` — 예/아니오. Soosorv 5수 단계에서는 N 을 함께 보여 준다. */
  | { kind: "swap"; fifthCount?: number }
  /** `show_dialog_swap_query2` — 유지 / 교환 / 두 수 추가. */
  | { kind: "swap2" }
  /** `show_dialog_move5N` — 5수 후보를 몇 개 낼 것인가. */
  | { kind: "fifthCount" }
  /** `show_dialog_swap_info` — 엔진이 반대 색을 가져갔다. */
  | { kind: "swapInfo" }
  /** `show_dialog_illegal_opening` — 판이 초기화됐다. */
  | { kind: "illegalOpening" }
  /** `show_dialog_forbidden_info` — 렌주 금수를 눌렀다. */
  | { kind: "forbidden"; cell: Move }
  /** `show_dialog_timeout` — 시계가 다 됐다(settings.txt 31행). */
  | { kind: "timeout" }
  | { kind: "info"; text: string };

/** 보드를 눌렀을 때 무슨 일이 있었나. */
export type TapResult =
  | { kind: "placed" }
  | { kind: "ignored" }
  | { kind: "rejected"; reason: string };
