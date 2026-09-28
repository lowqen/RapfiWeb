/**
 * W0c 전용 워커 — 앱의 엔진 워커(`src/engine/engine-worker.ts`)와 같은 방식으로
 * 글루를 `importScripts` 로 읽는다. 한 번 쓰고 버린다.
 *
 * `useMainScriptUrl` 이 참이면 팩토리에 `mainScriptUrlOrBlob` 로 글루 주소를 준다.
 * pthread 빌드는 엔진 스레드마다 워커를 새로 띄우는데, 그 워커에 무엇을 읽힐지를
 * 글루가 **자기 주소**로 정한다. importScripts 로 읽힌 글루는 자기 주소를 알 수
 * 없어 `self.location`(= 이 파일)을 쓰게 된다는 것이 이 실험의 가설이다.
 */
importScripts("probe.js");

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
  self.postMessage(result);
};
