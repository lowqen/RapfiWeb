// 페인트 전에 테마를 확정한다 — index.html 이 <head> 의 동기 스크립트로 부른다. 이게 없으면 다크
// 사용자가 첫 프레임에 흰 화면을 한 번 본다(FOUC). 3상태 중 명시 선택만 data-theme 로 붙는다.
// 예전에는 index.html 의 인라인 <script> 였다. CSP(script-src 'self')가 인라인 스크립트를 막으므로
// 파일로 뺐다(docs/보안-강화-계획.md Phase 1).
try {
  const t = localStorage.getItem("rapfi.theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {
  /* 사생활 보호 모드 등 — 무시하고 system 으로 둔다 */
}
