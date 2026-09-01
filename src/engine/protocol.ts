/**
 * piskvork/Gomocup 프로토콜 + Rapfi 확장 — 직렬화와 줄 분류.
 *
 * W1 은 **골격**이다. 여기 있는 것은 (a) 엔진을 띄우고 한 수를 받아 보는 데
 * 필요한 최소한과 (b) W3 가 채울 자리의 이름표다. 앱의
 * `data/engine/EngineCommand.kt` / `ResponseParser.kt` 가 원본이다.
 */

/** 엔진에 보내는 한 줄. 직렬화는 전부 여기를 지난다 — 화면이 문자열을 만들지 않는다. */
export type EngineCommand =
  | { kind: "about" }
  | { kind: "start"; size: number }
  | { kind: "rectstart"; width: number; height: number }
  | { kind: "info"; key: string; value: string | number }
  | { kind: "board"; stones: ReadonlyArray<{ x: number; y: number; own: boolean }> }
  | { kind: "turn"; x: number; y: number }
  | { kind: "begin" }
  | { kind: "stop" }
  | { kind: "yxnbest"; n: number }
  | { kind: "end" }
  | { kind: "raw"; line: string };

export function serialize(cmd: EngineCommand): string[] {
  switch (cmd.kind) {
    case "about":
      return ["ABOUT"];
    case "start":
      return [`START ${cmd.size}`];
    case "rectstart":
      return [`RECTSTART ${cmd.width},${cmd.height}`];
    case "info":
      return [`INFO ${cmd.key} ${cmd.value}`];
    case "board":
      // BOARD 는 여러 줄이고 DONE 으로 닫는다. own=true 가 «내 돌»이다.
      return ["BOARD", ...cmd.stones.map((s) => `${s.x},${s.y},${s.own ? 1 : 2}`), "DONE"];
    case "turn":
      return [`TURN ${cmd.x},${cmd.y}`];
    case "begin":
      return ["BEGIN"];
    case "stop":
      return ["YXSTOP"];
    case "yxnbest":
      return [`YXNBEST ${cmd.n}`];
    case "end":
      return ["END"];
    case "raw":
      return [cmd.line];
  }
}

/** 엔진이 뱉는 줄의 갈래. W3 가 각 갈래의 본문을 구조체로 판다. */
export type EngineLine =
  | { kind: "move"; x: number; y: number }
  | { kind: "ok" }
  | { kind: "error"; text: string }
  | { kind: "message"; text: string }
  | { kind: "info"; text: string }
  | { kind: "unknown"; text: string };

const MOVE = /^(\d{1,2}),(\d{1,2})$/;

export function classify(line: string): EngineLine {
  const t = line.trim();
  const m = MOVE.exec(t);
  if (m) return { kind: "move", x: Number(m[1]), y: Number(m[2]) };
  if (t === "OK") return { kind: "ok" };
  if (t.startsWith("ERROR")) return { kind: "error", text: t.slice(5).trim() };
  if (t.startsWith("MESSAGE")) return { kind: "message", text: t.slice(7).trim() };
  if (t.startsWith("INFO")) return { kind: "info", text: t.slice(4).trim() };
  return { kind: "unknown", text: t };
}
