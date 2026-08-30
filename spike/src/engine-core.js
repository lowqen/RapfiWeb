/**
 * Emscripten 모듈 하나를 띄우고 프로토콜 루프를 시작하는 공통부.
 *
 * 브라우저 워커와 node 의 worker_threads 가 **같은 코드**를 쓴다. W0-1 을 두 곳에서
 * 같은 방식으로 재현할 수 있어야 "브라우저라서 안 됐다/됐다"를 가릴 수 있다.
 *
 * 빌드가 `-sINVOKE_RUN=0` 이라 모듈 생성과 main() 시작 사이에 창이 열린다.
 * 그 창에서 가중치와 config.toml 을 FS 에 써 넣고 cwd 를 옮긴다 — 엔진은
 * `--config` 인자가 없어 **cwd 에서** 그 파일들을 찾기 때문이다.
 */

/**
 * @param {object}   opts
 * @param {string}   opts.factoryUrl  `rapfi-<variant>.js` 의 URL (ESM, default export)
 * @param {string}   [opts.wasmUrl]   `.wasm` 을 다른 경로에서 받을 때
 * @param {Array<{name: string, bytes: Uint8Array}>} opts.files  cwd 에 놓을 파일들
 * @param {() => (number|null)} opts.stdin  바이트 하나를 주는 동기 함수
 * @param {(line: string) => void} opts.onLine   stdout 한 줄
 * @param {(line: string) => void} [opts.onErr]  stderr 한 줄
 */
export async function createEngine({ factoryUrl, wasmUrl, files, stdin, onLine, onErr }) {
  const mod = await import(factoryUrl);
  const createRapfi = mod.default ?? mod.createRapfi;
  if (typeof createRapfi !== "function") {
    throw new Error(
      `${factoryUrl} 에서 팩토리를 찾지 못했습니다 — ` +
        `-sMODULARIZE/-sEXPORT_ES6 가 링크에 안 먹었을 수 있습니다 (키: ${Object.keys(mod)})`,
    );
  }

  const Module = await createRapfi({
    noInitialRun: true,
    // FS.init() 이 런타임 초기화 때 이 값을 집어간다. 그래서 모듈 생성 인자로
    // 넘겨야 하고, 생성된 뒤에 붙이면 늦는다.
    stdin,
    print: onLine,
    printErr: onErr ?? onLine,
    locateFile: (path) => (wasmUrl && path.endsWith(".wasm") ? wasmUrl : path),
  });

  const FS = Module.FS;
  if (!FS) {
    throw new Error("Module.FS 가 없습니다 — -sEXPORTED_RUNTIME_METHODS 에 FS 가 빠졌습니다");
  }
  try {
    FS.mkdir("/work");
  } catch {
    /* 이미 있으면 그만 */
  }
  for (const f of files) FS.writeFile("/work/" + f.name, f.bytes);
  FS.chdir("/work");

  return Module;
}

/**
 * main() 을 돌린다. **동기로 블로킹한다** — 워커에서만 부를 것.
 * EXIT_RUNTIME=1 이라 main 이 돌아오면 Emscripten 이 ExitStatus 를 던진다.
 */
export function runMain(Module) {
  try {
    const code = Module.callMain([]);
    return { exitCode: typeof code === "number" ? code : 0 };
  } catch (e) {
    if (e && (e.name === "ExitStatus" || typeof e.status === "number")) {
      return { exitCode: e.status ?? 0 };
    }
    throw e;
  }
}

/**
 * 워커 한 세션. `post` 는 드라이버로 메시지를 보내는 함수다.
 *
 * **여기서 알아낸 것 하나**: `runMain` 이 시작되면 워커의 이벤트 루프가 멈추므로
 * 워커의 onmessage 는 더 이상 돌지 않는다. 즉 정지 명령은 postMessage 로는 못 가고
 * 반드시 stdin(`YXSTOP`)으로 가야 한다. 계획서 §3 의 "정상 정지 = YXSTOP 한 줄,
 * terminate 는 최후 수단"이 선택이 아니라 구조적 결론이라는 뜻이다.
 */
export async function runEngineSession({ post, factoryUrl, wasmUrl, files, stdin }) {
  const blocks = () => (stdin.blocks ? stdin.blocks() : 0);
  const onLine = (line) => post({ type: "line", line, t: now() });
  try {
    const Module = await createEngine({
      factoryUrl,
      wasmUrl,
      files,
      stdin: stdin.fn,
      onLine,
      onErr: (line) => post({ type: "line", line: "[stderr] " + line, t: now() }),
    });
    post({ type: "ready", t: now() });
    const { exitCode } = runMain(Module);
    // blocks > 0 이 "엔진이 실제로 stdin 에서 잤다"는 증거다. 0 이면 블로킹이
    // 한 번도 안 일어난 것이고, 그건 우리가 검증하려던 경로가 아니다.
    post({ type: "exit", code: exitCode, blocks: blocks(), t: now() });
  } catch (e) {
    post({ type: "error", message: String((e && e.stack) || e), t: now() });
  }
}

export const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();
