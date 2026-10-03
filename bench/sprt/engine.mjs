/**
 * Gomocup(piskvork) 엔진 프로세스 하나 — SPRT 러너가 판마다 쓴다.
 *
 * 파이프를 다루는 규칙(데드락 · 누수 방지):
 *   - **stdout 과 stderr 를 늘 끝까지 읽는다.** 엔진은 MESSAGE/INFO 를 많이 찍는다. 우리가 기다리는 줄이 없을
 *     때도 읽지 않으면 파이프 버퍼(리눅스 64KB · 윈도 4KB 남짓)가 차고, 엔진은 write 에서 멈춘 채 수를 못 낸다.
 *     줄은 기다리는 쪽이 있으면 넘기고, 아니면 최근 `tailSize` 줄만 진단용으로 남긴다(메모리도 새지 않게).
 *   - stdin 쓰기는 **역압을 따른다**: write 가 false 면 'drain' 을 기다린다(시간 제한). EPIPE 같은 쓰기 오류는
 *     'error' 로 와서 프로세스를 죽은 것으로 표시한다 — 처리하지 않으면 노드 전체가 죽는다.
 *   - 무엇을 기다리든 **시간 제한**이 있고, 기다리는 중 프로세스가 끝나면 즉시 실패로 깨운다.
 *   - 끝낼 때는 END → 유예 → kill 순서이고, 끝난 뒤 세 스트림을 닫는다. `exited` 로 끝남을 확인할 수 있다.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class EngineError extends Error {
  /** @param {"timeout"|"crash"|"protocol"|"spawn"} kind */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** 모든 엔진 프로세스 — 러너가 끝에서 누수를 확인하고, 신호를 받으면 한꺼번에 죽인다. */
export const LIVE = new Set();

export class Engine {
  /**
   * @param {{ name: string, cmd: string, args?: string[], cwd?: string, init?: string[],
   *           startTimeoutMs?: number, tailSize?: number, log?: (line: string) => void }} spec
   */
  constructor(spec) {
    this.spec = spec;
    this.name = spec.name;
    this.tail = [];
    this.waiters = [];
    this.exitCode = undefined;
    this.about = null;
    this.child = null;
    this.exited = null;
  }

  get alive() {
    return this.child !== null && this.exitCode === undefined;
  }

  /** 띄우고 `INFO`(규칙 등) → START → OK 까지. `warmup` 이면 짧은 탐색 한 번으로 가중치까지 풀어 둔다. */
  async start({ boardSize = 15, rule = 4, info = [], warmup = false } = {}) {
    const { cmd, args = [], cwd } = this.spec;
    const child = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    LIVE.add(this);

    this.exited = new Promise((resolve) => {
      const done = (why) => {
        if (this.exitCode !== undefined) return;
        this.exitCode = why;
        LIVE.delete(this);
        this.#failAll(new EngineError("crash", `${this.name}: 프로세스가 끝났습니다(${why})`));
        resolve(why);
      };
      child.once("exit", (code, signal) => done(code ?? (signal ? `signal ${signal}` : null)));
      // 띄우기 실패(ENOENT 등)는 'exit' 없이 'error' 만 온다 — 끝난 것으로 친다.
      child.once("error", (e) => {
        if (child.pid === undefined) done(`spawn ${e.code ?? e.message}`);
      });
    });
    const spawned = new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", (e) =>
        reject(new EngineError("spawn", `${this.name}: 띄우지 못함 — ${e.message}`)),
      );
    });
    // spawn 이후의 'error'(kill 실패 등)도 받아 둔다 — 처리하지 않은 'error' 는 노드를 죽인다.
    child.on("error", (e) => this.#note(`[spawn error] ${e.message}`));
    child.stdin.on("error", (e) => {
      this.#note(`[stdin error] ${e.code ?? e.message}`);
      this.#failAll(
        new EngineError("crash", `${this.name}: stdin 쓰기 실패(${e.code ?? e.message})`),
      );
    });
    child.stdout.on("error", () => {});
    child.stderr.on("error", () => {});

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => this.#onLine(line.trim()));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      for (const l of chunk.split(/\r?\n/)) if (l) this.#note(`[stderr] ${l}`);
    });

    await spawned;
    const t = this.spec.startTimeoutMs ?? 60_000;
    for (const c of [`INFO RULE ${rule}`, ...info]) await this.send(c);
    await this.send(`START ${boardSize}`);
    await this.waitFor((l) => l === "OK", t, "START → OK");
    for (const c of this.spec.init ?? []) await this.send(c);
    await this.send("ABOUT");
    this.about = await this.waitFor((l) => /name\s*=/i.test(l), 10_000, "ABOUT").catch(() => null);
    if (warmup) {
      // 가중치는 첫 탐색에서야 풀린다(느린 기계에서 1초 남짓). 판 안에서 일어나면 첫 수가 시간 초과로
      // 지므로 여기서 짧게 한 번 생각시켜 둔다. 러너는 판마다 TIMEOUT_TURN 을 다시 보낸다.
      await this.send("INFO TIMEOUT_TURN 50");
      await this.play([[7, 7]], { timeoutMs: t });
    }
    return this;
  }

  #note(line) {
    this.tail.push(line);
    if (this.tail.length > (this.spec.tailSize ?? 200)) this.tail.shift();
    this.spec.log?.(`${this.name}| ${line}`);
  }

  #onLine(line) {
    if (!line) return;
    this.#note(line);
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      if (w.match(line)) {
        this.waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(line);
        return;
      }
    }
  }

  #failAll(err) {
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  /** `match` 가 참인 다음 줄. 시간 초과 · 프로세스 종료는 EngineError 로. */
  waitFor(match, timeoutMs, what) {
    if (!this.alive)
      return Promise.reject(new EngineError("crash", `${this.name}: 죽은 엔진(${what})`));
    return new Promise((resolve, reject) => {
      const w = { match, resolve, reject, timer: null };
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new EngineError("timeout", `${this.name}: ${what} — ${timeoutMs}ms 안에 응답 없음`));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  /** 한 줄(또는 여러 줄 블록) 보내기. 역압을 따른다. */
  async send(text, drainTimeoutMs = 10_000) {
    if (!this.alive || this.child.stdin.destroyed || !this.child.stdin.writable)
      throw new EngineError("crash", `${this.name}: 보낼 수 없음(죽었거나 stdin 이 닫힘)`);
    if (this.child.stdin.write(text + "\n")) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new EngineError("timeout", `${this.name}: stdin 이 ${drainTimeoutMs}ms 동안 비지 않음`),
        );
      }, drainTimeoutMs);
      const onDrain = () => (cleanup(), resolve());
      const onGone = () => (
        cleanup(),
        reject(new EngineError("crash", `${this.name}: 쓰는 중 종료`))
      );
      const cleanup = () => {
        clearTimeout(timer);
        this.child.stdin.off("drain", onDrain);
        this.child.stdin.off("close", onGone);
      };
      this.child.stdin.once("drain", onDrain);
      this.child.stdin.once("close", onGone);
    });
  }

  /** 새 판 — RESTART → OK(판과 탐색 기억을 비운다). */
  async newGame(timeoutMs = 30_000) {
    await this.send("RESTART");
    await this.waitFor((l) => l === "OK", timeoutMs, "RESTART → OK");
  }

  /**
   * 국면 전체를 BOARD 로 주고 수를 받는다. 매 수 국면 전체를 주므로 앞 수에서 무슨 일이 있었든 엔진과
   * 러너의 판이 어긋나지 않는다.
   * @param {[number, number][]} moves 지금까지의 수(첫 수가 흑)
   * @returns {Promise<{ move: [number, number], ms: number }>}
   */
  async play(moves, { timeLeftMs, timeoutMs }) {
    const toMove = moves.length % 2;
    const rows = moves.map(([x, y], i) => `${x},${y},${i % 2 === toMove ? 1 : 2}`);
    if (timeLeftMs != null)
      await this.send(`INFO TIME_LEFT ${Math.max(0, Math.round(timeLeftMs))}`);
    const t0 = performance.now();
    const reply = this.waitFor(
      (l) => /^\d+\s*,\s*\d+$/.test(l),
      timeoutMs,
      `${moves.length + 1}수째`,
    );
    reply.catch(() => {}); // send 가 먼저 실패해도 처리되지 않은 거부가 남지 않게
    await this.send(["BOARD", ...rows, "DONE"].join("\n"));
    const line = await reply;
    const [x, y] = line.split(",").map((s) => Number(s.trim()));
    return { move: [x, y], ms: performance.now() - t0 };
  }

  /** 수를 내지 않는 질의 — 흑 차례 국면의 금수 목록(YXSHOWFORBID). 심판 엔진이 쓴다. */
  async forbidden(moves, timeoutMs = 10_000) {
    const rows = moves.map(([x, y], i) => `${x},${y},${i % 2 === 0 ? 1 : 2}`); // 흑 = SELF
    await this.send(["YXBOARD", ...rows, "DONE"].join("\n"));
    await this.send("YXSHOWFORBID");
    const line = await this.waitFor((l) => /^FORBID\b/i.test(l), timeoutMs, "YXSHOWFORBID");
    const digits = line.replace(/^FORBID\s*/i, "").replace(/\.$/, "");
    const out = [];
    for (let i = 0; i + 4 <= digits.length; i += 4)
      out.push([Number(digits.slice(i, i + 2)), Number(digits.slice(i + 2, i + 4))]);
    return out;
  }

  /** END → 유예 → kill. 끝난 뒤 스트림을 닫는다. 여러 번 불러도 된다. */
  async stop(graceMs = 3000) {
    if (!this.child) return;
    if (this.alive) {
      try {
        await this.send("END", 1000);
      } catch {
        /* 이미 닫힘 */
      }
      if (!(await within(this.exited, graceMs))) {
        this.child.kill("SIGKILL");
        if (!(await within(this.exited, graceMs))) this.#note("[stop] kill 뒤에도 끝나지 않음");
      }
    }
    this.#failAll(new EngineError("crash", `${this.name}: 멈춤`));
    for (const s of [this.child.stdin, this.child.stdout, this.child.stderr]) s?.destroy();
  }

  /** 진단 — 마지막 줄 몇 개 */
  lastLines(n = 8) {
    return this.tail.slice(-n);
  }
}

/** `promise` 가 `ms` 안에 끝나면 true. 타이머는 어느 쪽이든 치운다(남은 타이머가 프로세스를 붙들지 않게). */
function within(promise, ms) {
  let timer;
  return Promise.race([
    promise.then(() => true),
    new Promise((r) => (timer = setTimeout(() => r(false), ms))),
  ]).finally(() => clearTimeout(timer));
}
