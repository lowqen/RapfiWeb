import { localized, msg, t } from "../../i18n/i18n";

/**
 * 규칙 — **이 웹 버전은 렌주 전용이다.**
 *
 * 앱(RapfiDroid)은 일곱 규칙을 지원한다. 웹이 하나만 지원하는 이유는 설계 취향이
 * 아니라 배포 제약이다: mix9svq 가중치 4종을 전부 구우면 `.data` 가 40.3MB 가 되고,
 * Cloudflare Pages 는 **파일 하나가 25MB 를 넘으면 거부한다.** 렌주 흑/백 두 개만
 * 남기면 19.9MB 다.
 *
 * 규칙별 lazy load(`/weights/` 에서 필요할 때 받기)로 넷을 다 지원할 수도 있었지만,
 * 이 프로젝트는 렌주 도구라 그 복잡도를 사지 않기로 했다. 나중에 프리스타일까지
 * 원하면 여기와 `wasm_preloads.txt`, 그리고 로더 하나를 더하면 된다.
 */

/** 엔진의 `INFO RULE <id>` 값. `command/gomocup.cpp` 가 정한 번호다. */
export const RULE_ID = {
  freestyle: 0,
  standard: 1,
  renju: 4,
  swap1: 5,
  swap2: 6,
} as const;

export type RuleName = keyof typeof RULE_ID;

/** 이 빌드가 실제로 둘 수 있는 규칙. */
export const SUPPORTED_RULES: readonly RuleName[] = ["renju"];

export const RULE_LABEL: Readonly<Record<RuleName, string>> = localized({
  freestyle: msg("프리스타일"),
  standard: msg("스탠다드"),
  renju: msg("렌주"),
  swap1: msg("스왑1"),
  swap2: msg("스왑2"),
});

/**
 * 지원하지 않는 규칙을 고를 때 보여 줄 문장.
 *
 * 「지원하지 않습니다」로 끝내지 않고 **왜인지와 어디서 되는지**를 말한다 —
 * 사용자가 다음에 무엇을 할 수 있는지 모르는 안내는 안내가 아니다.
 */
export function unsupportedRuleNotice(rule: RuleName): string {
  return t(
    "웹 버전은 렌주만 지원합니다({rule}은 없습니다). 엔진 가중치를 규칙마다 10MB씩 받아야 해서, 웹에서는 렌주 것만 싣습니다. 다른 규칙은 안드로이드 앱이나 데스크톱 Yixin 을 쓰세요.",
    { rule: RULE_LABEL[rule] },
  );
}
