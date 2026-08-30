/**
 * W0-1 이 검사하는 것 — **한 곳에만** 적어 둔다.
 *
 * node(worker_threads)와 브라우저(Web Worker)가 같은 목록을 돌린다. 두 곳에서
 * 다른 것을 검사하면 "node 는 되는데 브라우저는 안 된다"가 전송 계층 탓인지
 * 검사 항목 탓인지 알 수 없게 된다.
 */

/** 엔진의 착수 응답. gomocup 은 `x,y` 한 줄로 답한다. */
export const MOVE = /^\s*\d+\s*,\s*\d+\s*$/;

export const STEPS = [
  {
    label: "1. ABOUT — 양방향 통신",
    send: "ABOUT",
    match: (l) => /name\s*=/i.test(l) || /rapfi/i.test(l),
    timeout: 15000,
  },
  {
    label: "2. START 15 — 핸드셰이크",
    send: "START 15",
    match: (l) => /^OK\b/i.test(l.trim()),
    timeout: 30000,
  },
  {
    // 응답이 없는 것이 정상이다. 여기서 확인하는 건 "여러 줄을 연달아 보내도
    // 링버퍼와 getline 이 어긋나지 않는다"이다.
    label: "3. INFO ×3 — 응답 없음이 정상",
    send: "INFO timeout_turn 3000\nINFO timeout_match 60000\nINFO max_node 200000",
    match: null,
  },
  {
    label: "4. BOARD 15×15 — 국면 전송",
    send: ["BOARD", "7,7,1", "7,8,2", "8,8,1", "6,7,2", "DONE"].join("\n"),
    match: (l) => MOVE.test(l),
    timeout: 60000,
  },
  {
    label: "5. TURN — 대화형 왕복",
    send: "TURN 6,6",
    match: (l) => MOVE.test(l),
    timeout: 60000,
  },
];

/** 마지막에 보내는 종료 명령. 엔진이 프로토콜 루프를 정상적으로 끝낸다. */
export const END_COMMAND = "END";

/**
 * 목록을 순서대로 돌린다.
 * @param {(text: string) => Promise<void>} send   stdin 에 한 덩어리 쓰기(백프레셔 때문에 비동기)
 * @param {(m, ms, label) => Promise<string>} waitFor  조건에 맞는 줄 기다리기
 * @param {(ms: number) => Promise<void>} sleep
 */
export async function runSteps({ send, waitFor, sleep }) {
  const results = [];
  for (const s of STEPS) {
    const t0 = nowMs();
    await send(s.send + "\n");
    if (s.match === null) {
      await sleep(150);
      results.push({ step: s.label, ok: true, ms: round(nowMs() - t0), got: "(응답 없음 — 정상)" });
      continue;
    }
    try {
      const line = await waitFor(s.match, s.timeout, s.label);
      results.push({ step: s.label, ok: true, ms: round(nowMs() - t0), got: line.slice(0, 90) });
    } catch (e) {
      results.push({ step: s.label, ok: false, ms: round(nowMs() - t0), got: String(e.message ?? e) });
      // 핸드셰이크가 안 되면 뒤 단계는 의미가 없다. 그래도 끝까지 돌려서
      // "어디까지 됐는가"를 남긴다 — 실패 보고에서 그게 가장 쓸모 있다.
    }
  }
  return results;
}

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const round = (v) => +v.toFixed(1);
