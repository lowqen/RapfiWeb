/**
 * W0c 전용 워커 — 앱의 엔진 워커(`src/engine/engine-worker.ts`)와 같은 방식으로
 * 글루를 `importScripts` 로 읽는다. 한 번 쓰고 버린다.
 *
 * ## 왜 워커에서 멀티 변형이 죽었나 (2차 런에서 확정)
 *
 * pthread 빌드는 엔진 스레드마다 워커를 새로 띄우는데, 그 워커에 무엇을 읽힐지를
 * 글루가 **자기 주소**로 정한다(Emscripten 6.0.8 글루 그대로):
 *
 *     ba && (_scriptName = self.location.href)          // 워커 안이면 = 호스트 워커 주소
 *     new Worker(_scriptName, { name: "em-pthread" })   // 엔진 스레드
 *
 * importScripts 로 읽힌 글루에게 `self.location` 은 **이 파일**이다. 그래서 엔진
 * 스레드가 글루가 아니라 이 하네스를 띄우고, 글루의 부트스트랩
 * (`isPthread && Rapfi()`)은 한 번도 돌지 않는다 — 기동은 되는데 영원히 무응답.
 * 이 판의 글루에는 `mainScriptUrlOrBlob` 가 **없다**(grep 0건) — 1차 런의
 * worker-url 조합은 아무것도 바꾸지 못한 실험이었다.
 *
 * ## 해법: pthread 로 뜨면 글루만 읽고 비킨다
 *
 * 엔진 스레드는 이 파일을 **같은 주소(쿼리 포함)** 로 `name: "em-pthread"` 를 달고
 * 연다. 그러면 쿼리의 `glue` 로 글루만 `importScripts` 하면 글루 끝의
 * `isPthread && Rapfi()` 가 스레드를 부트스트랩한다. 호스트 코드(onmessage 등)는
 * 걸지 않는다 — 글루가 제 onmessage 를 건다.
 *
 * `?glue=` 가 없으면 이 가드가 꺼진다 — W0 실패를 그대로 재현하는 대조군(mode=worker).
 */
const GLUE = new URLSearchParams(self.location.search).get("glue");

if (self.name === "em-pthread") {
  // 대조군(글루 주소 없음)에서는 여기로 와도 할 수 있는 일이 없다 — W0 의 실패 모양.
  if (GLUE) importScripts(GLUE);
} else {
  importScripts("probe.js");

  const workerErrors = [];
  const note = (s) => workerErrors.length < 30 && workerErrors.push(s);
  self.addEventListener("error", (e) => note(`error: ${e.message} @${e.filename}:${e.lineno}`));
  self.addEventListener("unhandledrejection", (e) => note(`rejection: ${String(e.reason)}`));

  self.onmessage = async (ev) => {
    const m = ev.data;
    let result;
    try {
      importScripts(m.glueUrl);
      result = await self.runProbe({
        factory: self.Rapfi,
        baseUrl: m.baseUrl,
        glueUrl: m.glueUrl,
        threads: m.threads,
        stopTest: m.stopTest,
        repeats: m.repeats,
      });
    } catch (e) {
      result = { ok: false, stage: "worker", error: String((e && e.stack) || e) };
    }
    result.workerErrors = workerErrors;
    result.workerLocation = String(self.location);
    self.postMessage(result);
  };
}
