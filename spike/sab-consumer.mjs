/** test-sab.mjs 의 소비자. 엔진이 하는 일(바이트 단위 동기 읽기)만 흉내낸다. */
import { parentPort, workerData } from "node:worker_threads";
import { makeBlockingStdin } from "./src/sab-stdin.js";

let blocks = 0;
const read = makeBlockingStdin(workerData.channel, { onBlock: () => blocks++ });

const bytes = [];
let sawEof = false;
for (;;) {
  const b = read();
  if (b === null) {
    sawEof = true;
    break;
  }
  bytes.push(b);
}

parentPort.postMessage({
  text: Buffer.from(bytes).toString("utf8"),
  blocks,
  sawEof,
});
