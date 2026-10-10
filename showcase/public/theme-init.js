// 쇼케이스의 테마를 페인트 전에 확정한다 — index.html 이 <head> 의 동기 스크립트로 부른다.
// CSP(script-src 'self')가 인라인 스크립트를 막으므로 파일로 뺐다(docs/보안-강화-계획.md Phase 1).
try {
  const t = localStorage.getItem("rapfi.showcase.theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {
  /* 저장소가 막힌 환경 — 시스템 테마를 따른다 */
}
