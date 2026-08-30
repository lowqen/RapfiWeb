/** 브라우저 워커 어댑터. 시작 메시지 하나를 받고 그대로 세션에 넘긴다. */
import { makeBlockingStdin } from "./sab-stdin.js";
import { runEngineSession } from "./engine-core.js";

self.onmessage = async (ev) => {
  const { factoryUrl, wasmUrl, files, channel } = ev.data;
  let blocks = 0;
  await runEngineSession({
    post: (m) => self.postMessage(m),
    factoryUrl,
    wasmUrl,
    files,
    stdin: { fn: makeBlockingStdin(channel, { onBlock: () => blocks++ }), blocks: () => blocks },
  });
};
