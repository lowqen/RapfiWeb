/**
 * 멀티스레드 WASM 엔진 앞의 **명령 관문** — wasm-pbrain.mjs 가 multi-* 변형에서 쓴다(단일 변형은 쓰지 않는다).
 *
 * 멀티 변형(PROXY_TO_PTHREAD)에서 `Module.sendCommand` 는 **곧바로** 돌아오고, 탐색은 엔진 pthread 에서 돌며 답은 비동기로 온다.
 * 그래서 들어오는 명령을 그대로 넘기면 앱이 이미 겪은 사고가 난다(src/engine/engine-worker.ts `SETTLE_MS` 주석):
 *
 *   엔진은 좌표 줄을 찍은 **뒤에도** 탐색 스레드가 잠깐 입력을 계속 읽는다(탐색 중 YXSTOP 감시). 그 틈에 다음 명령을 보내면 두 스레드가
 *   입력을 나눠 먹어 명령이 토막 나거나 통째로 사라지고, 엔진이 **영원히 무응답**이 된다. 5ms 만 기다려도 120회 연속 0건.
 *
 * 관문의 규칙:
 *   1. 여러 줄 명령(BOARD · YXBOARD · YXBLOCK · YXBLOCKUNDO … DONE)은 모아서 **한 번에** 넘긴다(단일 변형 어댑터와 같은 규칙).
 *   2. 탐색 명령(BOARD · TURN · BEGIN)을 넘기면 「탐색 중」이 된다. 탐색 중에는 정지(YXSTOP · STOP)와 END 만 곧바로 넘기고
 *      나머지는 줄 세운다.
 *   3. 좌표 줄이 오면 탐색이 끝난 것이다. `settleMs`(기본 50 — 앱과 같은 값) 뒤에 줄 선 명령을 순서대로 넘긴다. 그중 탐색 명령이
 *      있으면 거기서 다시 「탐색 중」이 되고 나머지는 계속 기다린다.
 *   4. 탐색 명령을 넘긴 뒤 `firstLineMs`(기본 5초) 동안 엔진이 **한 줄도** 내지 않으면 명령이 사라진 것으로 보고 `onFatal` —
 *      어댑터는 오류를 찍고 비정상 종료한다. 러너는 그것을 크래시로 세고 엔진을 새로 띄운다. 매달려 있는 것보다 낫다.
 *
 * 시계 · 타이머는 주입한다(시험이 가짜 시계로 돈다).
 */

export const MULTI_LINE = /^(BOARD|YXBOARD|YXBLOCK|YXBLOCKUNDO)$/i;
/** 넘기면 엔진이 좌표 줄로 답하는 명령 — 그동안 엔진 스레드가 입력을 본다 */
export const SEARCH = /^(BOARD|TURN|BEGIN)\b/i;
/** 탐색 중에도 곧바로 넘기는 명령 */
export const PASS_DURING_SEARCH = /^(YXSTOP|STOP|END)\b/i;
export const MOVE_LINE = /^\d+\s*,\s*\d+$/;

export class PbrainGate {
  /**
   * @param {{
   *   send: (cmd: string) => void,
   *   onFatal: (reason: string) => void,
   *   settleMs?: number,
   *   firstLineMs?: number,
   *   setTimer?: (fn: () => void, ms: number) => unknown,
   *   clearTimer?: (id: unknown) => void,
   * }} opts
   */
  constructor({
    send,
    onFatal,
    settleMs = 50,
    firstLineMs = 5000,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(/** @type {any} */ (id)),
  }) {
    this.send = send;
    this.onFatal = onFatal;
    this.settleMs = settleMs;
    this.firstLineMs = firstLineMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    /** @type {"idle" | "searching" | "settling"} */
    this.state = "idle";
    /** @type {string[]} */
    this.queue = [];
    /** @type {string[] | null} */
    this.block = null;
    this.settleTimer = null;
    this.watchTimer = null;
    this.dead = false;
  }

  /** 러너가 보낸 한 줄(stdin) */
  input(raw) {
    if (this.dead) return;
    const line = raw.trim();
    if (!line) return;
    if (this.block) {
      this.block.push(line);
      if (/^DONE$/i.test(line)) {
        const cmd = this.block.join("\n");
        this.block = null;
        this.#submit(cmd);
      }
      return;
    }
    if (MULTI_LINE.test(line)) this.block = [line];
    else this.#submit(line);
  }

  /** 엔진이 낸 한 줄(onReceiveStdout) */
  output(raw) {
    if (this.dead) return;
    const line = raw.trim();
    if (this.watchTimer !== null) {
      this.clearTimer(this.watchTimer);
      this.watchTimer = null;
    }
    if (this.state === "searching" && MOVE_LINE.test(line)) {
      this.state = "settling";
      this.settleTimer = this.setTimer(() => {
        this.settleTimer = null;
        this.state = "idle";
        this.#flush();
      }, this.settleMs);
    }
  }

  /** 끝낼 때 — 타이머를 치운다(남은 타이머가 프로세스를 붙들지 않게) */
  close() {
    this.dead = true;
    for (const t of [this.settleTimer, this.watchTimer]) if (t !== null) this.clearTimer(t);
    this.settleTimer = this.watchTimer = null;
    this.queue.length = 0;
  }

  #submit(cmd) {
    if (this.state === "idle") return this.#pass(cmd);
    if (PASS_DURING_SEARCH.test(cmd)) return this.send(cmd);
    this.queue.push(cmd);
  }

  #pass(cmd) {
    if (SEARCH.test(cmd)) {
      this.state = "searching";
      this.watchTimer = this.setTimer(() => {
        this.watchTimer = null;
        if (this.dead) return;
        this.dead = true;
        this.onFatal(
          `탐색 명령 뒤 ${this.firstLineMs}ms 동안 엔진 출력이 없음 — 명령이 입력에서 사라진 것으로 본다: ${cmd.split("\n")[0]}`,
        );
      }, this.firstLineMs);
    }
    this.send(cmd);
  }

  #flush() {
    while (this.state === "idle" && this.queue.length && !this.dead) this.#pass(this.queue.shift());
  }
}
