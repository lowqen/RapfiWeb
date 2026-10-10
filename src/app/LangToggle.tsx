import { setLang, useLang } from "../i18n/i18n";

/**
 * 언어 전환(W10) — 상단 바의 지름길. 지금 언어가 아니라 **바꿀 언어**를 그 언어로 적는다(한국어 화면에서는
 * «English», 영어 화면에서는 «한국어») — 읽지 못하는 언어의 화면에서도 찾을 수 있게. 설정 ▸ 자주 쓰는 설정에도 같은 줄이 있다.
 */
export function LangToggle() {
  const lang = useLang((s) => s.lang);
  const next = lang === "ko" ? "en" : "ko";
  return (
    <button
      type="button"
      className="themetoggle langtoggle"
      lang={next}
      aria-label={next === "en" ? "Switch to English" : "한국어로 바꾸기"}
      onClick={() => setLang(next)}
    >
      {next === "en" ? "English" : "한국어"}
    </button>
  );
}
