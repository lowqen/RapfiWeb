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
 * 데스크톱의 `specialrule` 중 **이 엔진으로 실제 돌아가는 것들**.
 *
 * 데스크톱에는 Soosorv-8 과 스왑2 도 있지만 그 둘은 `yxsoosorvstep*` /
 * `yxswap2step*` 로 **엔진에게 협상을 시킨다.** 그 명령은 Yixin 의 것이고
 * Rapfi 의 명령표(`command/gomocup.cpp` @3c94c2a9)에 없다 — GUI 모드는 모르는
 * 명령을 오류도 없이 삼키므로 답이 영영 오지 않는다. 근거와 확인 경위는
 * `docs/오프닝-협상-엔진-지원.md`.
 *
 * 그래서 남은 셋은 **엔진의 협상 명령이 필요 없는 것들**이다: 협상이 아예
 * 없거나(none), 첫 세 수를 사람이 놓거나(rif), 교환 여부를 우리가 정한다
 * (swapFirst — 데스크톱도 엔진에게 묻지 않는다, main.c:2771).
 */
export type OpeningProtocol = "none" | "rif" | "swapFirst";

export const OPENING_LABEL: Record<OpeningProtocol, string> = {
  none: "자유 렌주",
  rif: "RIF 오프닝",
  swapFirst: "첫 수 이후 교환",
};

export const OPENING_HINT: Record<OpeningProtocol, string> = {
  none: "협상 없이 흑부터 둡니다.",
  rif: "첫 세 수를 천원 둘레에 손으로 놓고 시작합니다.",
  swapFirst: "흑이 한 수를 놓으면 상대가 그 색을 가져갈지 정합니다.",
};

/**
 * 왜 셋뿐인지 화면에 적는 문장. 「없습니다」로 끝내지 않고 **어디에 원인이
 * 있는지**까지 말한다 — `unsupportedRuleNotice` 와 같은 규칙이다.
 */
export const OPENING_NOTICE =
  "웹 버전은 Rapfi 엔진이 지원하는 렌주 규칙만 제공합니다. " +
  "스왑2와 Soosorv-8은 현재 Rapfi에서 지원하지 않습니다.";

/** 첫 세 수를 손으로 놓는 개시 — 그 안에서는 엔진에게 두라고 하지 않는다. */
export const handEnteredOpening = (o: OpeningProtocol): boolean => o === "rif";

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

/**
 * 게임이 사용자에게 물어보는 것, 또는 알려 주는 것. 각 항목이 데스크톱의 대화상자
 * 하나에 대응한다.
 *
 * 스왑2의 세 버튼 대화상자(`show_dialog_swap_query2`)와 Soosorv 의 N 대화상자
 * (`show_dialog_move5N`)는 그 두 개시와 함께 빠졌다 — 물어봐도 답할 엔진이 없다.
 */
export type GamePrompt =
  /** `show_dialog_swap_query` — 예/아니오. */
  | { kind: "swap" }
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
  { kind: "placed" } | { kind: "ignored" } | { kind: "rejected"; reason: string };
