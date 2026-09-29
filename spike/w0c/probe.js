/**
 * W0c 측정 — 페이지 메인 스레드와 워커 **양쪽에서 똑같이** 도는 한 벌.
 *
 * 전역 `runProbe(opts)` 하나를 정의한다(클래식 스크립트 — 페이지는 <script>, 워커는
 * importScripts 로 읽는다). 결과는 JSON 한 덩어리이고, 실패해도 **어느 단계에서**
 * 멈췄는지와 마지막 엔진 줄들을 담아 돌려준다 — W0 의 「전 단계 시간 초과」는 원인을
 * 말하지 않았다.
 *
 * 재는 것:
 *   env      crossOriginIsolated · SharedArrayBuffer · hardwareConcurrency
 *   boot     팩토리 resolve 까지 · 첫 응답까지
 *   proto    비대칭 국면의 YXNBEST 답(빈 판의 7,7 이 아니어야 국면이 닿은 것이다)
 *   scaling  INFO THREAD_NUM n 마다 같은 국면 3초 × repeats → TOTALNODES/TOTALTIME(노드/초)
 *   block    YXNBEST 를 보내는 sendCommand 가 호출자를 얼마나 붙드는가
 *            (단일 빌드는 탐색 전체, 멀티는 ~0 이어야 한다)
 *   stop     탐색 2초째에 YXSTOP → 좌표가 돌아오기까지(멀티만)
 *   hostGap  호스트 스레드(페이지/워커)의 20ms 틱이 가장 오래 밀린 시간
 */
(function () {
  "use strict";

  /**
   * 비대칭 3수 국면(1 = 엔진 돌, 2 = 상대 돌). 외통이 없는 국면이어야 한다 — 외통이
   * 보이면 탐색이 일찍 끝나 초당 노드 수가 스레드가 아니라 국면을 잰다(처음 고른
   * 8수 국면은 +M19 였다). 실측: 3초에 깊이 15 안팎, 평가 −300 대.
   */
  const POSITION = "YXBOARD\n7,7,2\n7,8,1\n8,8,2\nDONE";
  const SMALL = POSITION;
  const MOVE = /^\d+,\d+$/;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function runProbe(opts) {
    const { factory, baseUrl, threads, stopTest, repeats } = opts;
    const out = {
      ok: false,
      stage: "init",
      env: {
        crossOriginIsolated: typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : null,
        sharedArrayBuffer: typeof SharedArrayBuffer === "function",
        hardwareConcurrency: (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      },
      bootMs: null,
      firstLineMs: null,
      version: null,
      maxThreadLine: null,
      proto: null,
      scaling: [],
      stop: null,
      hostMaxGapMs: 0,
      error: null,
      tail: [],
    };

    const lines = [];
    const waiters = [];
    const onLine = (l) => {
      const t = performance.now();
      lines.push({ t, l });
      if (out.firstLineMs === null) out.firstLineMs = Math.round(t - t0);
      for (const w of waiters.slice()) {
        if (w.re.test(l)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve({ t, l, i: lines.length - 1 });
        }
      }
    };
    // `from` 부터 이미 온 줄을 먼저 본다 — 단일 빌드는 sendCommand 안에서 탐색이
    // 끝나 답이 **보내는 호출이 돌아오기 전에** 와 있다.
    const waitFor = (re, ms, what, from) =>
      new Promise((resolve, reject) => {
        for (let k = from ?? lines.length; k < lines.length; k++) {
          if (re.test(lines[k].l)) return resolve({ t: lines[k].t, l: lines[k].l, i: k });
        }
        const w = { re, resolve };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) {
            waiters.splice(i, 1);
            reject(new Error(`${what}: ${ms}ms 안에 ${re} 없음`));
          }
        }, ms);
      });

    // 호스트 스레드 틱 — 이 스레드가 막히면 틱이 밀린다.
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      out.hostMaxGapMs = Math.max(out.hostMaxGapMs, Math.round(now - last - 20));
      last = now;
    }, 20);

    const t0 = performance.now();
    let M = null;
    const send = (s) => {
      const a = performance.now();
      M.sendCommand(s);
      return Math.round(performance.now() - a);
    };

    try {
      out.stage = "boot";
      const args = {
        locateFile: (p) => baseUrl + p,
        onReceiveStdout: onLine,
        onReceiveStderr: (l) => onLine("[stderr] " + l),
        print: () => {},
        printErr: () => {},
      };
      M = await factory(args);
      out.bootMs = Math.round(performance.now() - t0);
      if (typeof M.sendCommand !== "function") throw new Error("sendCommand 없음");

      out.stage = "handshake";
      let at = lines.length;
      send("info show_detail 3");
      send("yxshowinfo");
      out.maxThreadLine = (await waitFor(/MAX_THREAD_NUM/, 30000, "yxshowinfo", at)).l;
      at = lines.length;
      send("ABOUT");
      out.version = (await waitFor(/version\s*=/i, 10000, "ABOUT", at)).l;
      send("INFO RULE 4");
      at = lines.length;
      send("START 15");
      await waitFor(/^OK$/, 10000, "START", at);
      send("INFO timeout_match 0");

      // 국면이 실제로 닿는가 — 첫 탐색은 가중치 로드(~0.5s)를 포함한다.
      out.stage = "proto";
      send("INFO timeout_turn 500");
      send(SMALL);
      at = lines.length;
      const pBlock = send("YXNBEST 1");
      const pm = await waitFor(MOVE, 30000, "첫 탐색", at);
      // 좌표 뒤 정착 대기 — 멀티 엔진은 좌표를 찍은 뒤에도 잠깐 입력을 읽어, 곧바로 보낸
      // 명령을 토막 내거나 삼킨다(docs/W0c-결과.md 「입력 경합」). 앱과 같은 50ms.
      await sleep(50);
      out.proto = { bestmove: pm.l, blockMs: pBlock, notCenter: pm.l !== "7,7" };

      out.stage = "scaling";
      const hc = out.env.hardwareConcurrency || 4;
      for (const n of threads.filter((k) => k <= Math.max(2, hc * 2))) {
        // 같은 조건을 `repeats` 번 — 공유 러너는 같은 탐색이 두 번에 40% 흔들렸다(2차 런).
        const runs = [];
        for (let rep = 0; rep < (repeats || 1); rep++) {
          send(`INFO THREAD_NUM ${n}`);
          send("YXHASHCLEAR");
          send("INFO timeout_turn 3000");
          send(POSITION);
          const from = lines.length;
          const ts = performance.now();
          const block = send("YXNBEST 1");
          const done = await waitFor(MOVE, 30000, `탐색 ${n}스레드`, from);
          // 매크로태스크로 한 번 양보 — 단일 빌드는 답이 이미 와 있어 await 가 마이크로
          // 태스크로만 넘어가고, 그러면 호스트 틱이 탐색 사이에 한 번도 돌지 않는다.
          await sleep(50);
          const win = lines.slice(from, done.i + 1).map((x) => x.l);
          const lastOf = (re) => {
            for (let k = win.length - 1; k >= 0; k--) {
              const m = re.exec(win[k]);
              if (m) return m;
            }
            return null;
          };
          // 속도는 **TOTALNODES/TOTALTIME 로 직접** 잰다. 탐색 끝 요약 줄
          // (`MESSAGE Speed …`)은 멀티 스레드에서 빠지기도 한다 — 2차 런의 4스레드
          // 탐색은 `MESSAGE Bestline …` 으로 끝났고, 그때 앞 탐색의 줄을 집었다.
          const nodes = lastOf(/^INFO TOTALNODES (\d+)/);
          const time = lastOf(/^INFO TOTALTIME (\d+)/);
          const speed = lastOf(/^MESSAGE Speed (\d+)/);
          const depth = lastOf(/Depth (\d+)-(\d+)/);
          runs.push({
            rate:
              nodes && time && Number(time[1]) > 0
                ? Math.round((Number(nodes[1]) * 1000) / Number(time[1]))
                : null,
            speed: speed ? Number(speed[1]) : null,
            depth: depth ? `${depth[1]}-${depth[2]}` : null,
            wallMs: Math.round(done.t - ts),
            blockMs: block,
            // 탐색이 끝났다는 신호로 무엇을 쓸 수 있나 — 좌표 바로 앞 줄들.
            endLines: win.slice(-3),
          });
        }
        const rates = runs.map((r) => r.rate).filter((x) => x !== null);
        out.scaling.push({
          threads: n,
          // 잡음은 대개 **느려지는** 쪽이다(이웃 작업이 코어를 가져간다) — 가장 빠른 값을 쓴다.
          best: rates.length ? Math.max(...rates) : null,
          rates,
          blockMs: Math.max(...runs.map((r) => r.blockMs)),
          depth: runs.at(-1).depth,
          endLines: runs.at(-1).endLines,
          runs,
        });
      }

      if (stopTest) {
        out.stage = "stop";
        send("INFO THREAD_NUM 1");
        send("INFO timeout_turn 60000");
        send(POSITION);
        const from = lines.length;
        const block = send("YXNBEST 1");
        await sleep(2000);
        const ts = performance.now();
        send("YXSTOP");
        const done = await waitFor(MOVE, 15000, "YXSTOP 뒤 좌표", from);
        out.stop = { latencyMs: Math.round(done.t - ts), searchBlockMs: block };
      }

      out.stage = "done";
      out.ok = true;
    } catch (e) {
      out.error = String((e && e.message) || e);
    } finally {
      clearInterval(ticker);
      out.tail = lines.slice(-25).map((x) => x.l);
      try {
        if (M && typeof M.terminate === "function") M.terminate();
      } catch (_) {
        /* 종료는 ExitStatus 를 던진다 — 오류가 아니다 */
      }
    }
    return out;
  }

  self.runProbe = runProbe;
})();
