/**
 * W0c 전용 워커 — 앱의 엔진 워커(`src/engine/engine-worker.ts`)와 같은 방식으로
 * 글루를 `importScripts` 로 읽는다. 한 번 쓰고 버린다.
 *
 * `useMainScriptUrl` 이 참이면 팩토리에 `mainScriptUrlOrBlob` 로 글루 주소를 준다.
 * pthread 빌드는 엔진 스레드마다 워커를 새로 띄우는데, 그 워커에 무엇을 읽힐지를
 * 글루가 **자기 주소**로 정한다. importScripts 로 읽힌 글루는 자기 주소를 알 수
 * 없어 `self.location`(= 이 파일)을 쓰게 된다는 것이 이 실험의 가설이다.
 *
 * 워커 안의 오류·콘솔은 페이지 콘솔에 잡히지 않는 브라우저가 있어 직접 모아 결과에
 * 싣는다(`workerErrors`). 1차 런에서 워커 조합이 원인을 남기지 않고 실패했다.
 */
importScripts("probe.js");

const workerErrors = [];
const note = (s) => workerErrors.length < 30 && workerErrors.push(s);
self.addEventListener("error", (e) => note(`error: ${e.message} @${e.filename}:${e.lineno}`));
self.addEventListener("unhandledrejection", (e) => note(`rejection: ${String(e.reason)}`));
for (const k of ["error", "warn"]) {
  const orig = console[k].bind(console);
  console[k] = (...a) => {
    note(`console.${k}: ${a.map(String).join(" ")}`);
    orig(...a);
  };
}

self.onmessage = async (ev) => {
  const m = ev.data;
  let result;
  try {
    importScripts(m.glueUrl);
    result = await self.runProbe({
      factory: self.Rapfi,
      baseUrl: m.baseUrl,
      glueUrl: m.glueUrl,
      useMainScriptUrl: m.useMainScriptUrl,
      threads: m.threads,
      stopTest: m.stopTest,
    });
  } catch (e) {
    result = { ok: false, stage: "worker", error: String((e && e.stack) || e) };
  }
  result.workerErrors = workerErrors;
  result.workerLocation = String(self.location);
  self.postMessage(result);
};
