import { create } from "zustand";
import { inBoard, label, move, sameMove, type Move } from "../../core/model/move";
import {
  colorAt,
  enginePlays,
  handEnteredOpening,
  swappedSide,
  type ComputerSide,
  type GamePrompt,
  type GameResult,
  type OpeningProtocol,
  type StoneColor,
  type Swap2Choice,
  type TapResult,
} from "../../core/model/game";
import {
  EMPTY_CLOCK,
  addIncrement as addClockIncrement,
  engineTimeLeftMs,
  leftTurnMs,
  playerTimedOut,
  start as startClock,
  stop as stopClock,
  tick as tickClock,
  withLimits,
  type ClockSide,
  type GameClock,
} from "../../core/model/clock";
import {
  openingAreaOk,
  result as refereeResult,
  swapAfterFirstMove,
} from "../../core/model/referee";
import { useBoardStore } from "./boardStore";
import { setGameHandlers, useEngineStore } from "../../engine/engine-state";
import type { OpeningResponse } from "../../engine/engine-client";
import type { EngineCommand } from "../../engine/engine-types";

/**
 * 대국 상태 기계 — `data/game/GameRepositoryImpl.kt` 의 대국·협상·시계 부분.
 *
 * **협상은 엔진이 한다.** 우리가 규칙을 다시 구현하는 것이 아니라, `yxswap2step*` /
 * `yxsoosorvstep*` 로 물어보고 `MESSAGE SWAP2 …` / `MESSAGE SOOSORV …` 로 오는 답을
 * 화면과 보드에 옮긴다. 데스크톱이 그렇게 하고(main.c), 앱도 그대로 옮겼다.
 * 그래서 이 파일에는 「누가 언제 무엇을 묻는가」만 있고 렌주 판정은 한 줄도 없다.
 *
 * 예외가 셋 있는데, 모두 데스크톱이 **스스로** 정하는 것이라 옮겼다:
 *   - 개시 영역 검사(`openingAreaOk`) — RIF·Soosorv 의 첫 세 수
 *   - 「첫 수 이후 교환」의 교환 여부(`swapAfterFirstMove`) — 동전 던지기 포함
 *   - 그 규칙의 정해진 개시 두 수(`SWAP_FIRST_OPENING` / `SWAP_FIRST_REPLY`)
 *
 * **시계는 `place()` 가 건드리지 않는다.** 앱과 같다: 시계는 «엔진에게 넘길 때»
 * 컴퓨터로, «엔진이 답할 때» 사람으로 넘어가고 가산은 그 두 자리에서만 붙는다.
 * 돌 하나마다 시계를 만지면 협상처럼 한쪽이 여러 수를 두는 구간에서 어긋난다.
 */

/** 렌주에서는 장목이 흑의 **금수**라 승리 판정에서는 장목을 인정한다. */
const ALLOW_OVERLINE = true;

/** Soosorv 의 5수 후보 개수. 데스크톱의 N 대화상자와 같이 1~8. */
export const FIFTH_COUNT_RANGE = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const MAX_FIFTH = 8;

/** 시간 제한이 없을 때 한 수에 쓰는 예산. */
const DEFAULT_TURN_MS = 5_000;

const LOG_LIMIT = 30;

/**
 * 「첫 수 이후 교환」에서 데스크톱이 스스로 두는 정해진 두 수
 * (main.c:2733 `make_move(1, 7)` 와 2468 `make_move(4, 5)` — 데스크톱 순서로 y,x).
 */
const SWAP_FIRST_OPENING = move(7, 1);
const SWAP_FIRST_REPLY = move(5, 4);

interface GameState {
  computerSide: ComputerSide;
  opening: OpeningProtocol;
  /** 대국 탐색이 돌고 있다(데스크톱의 `isthinking`). */
  thinking: boolean;
  result: GameResult | null;
  clock: GameClock;
  prompt: GamePrompt | null;
  /** Soosorv `move5N`: 5수 후보를 몇 개 내는가. */
  fifthCount: number;
  /** 5수 후보가 판에 올라와 있고 하나를 골라야 한다. */
  offeringFifth: boolean;
  /** 5수 단계가 끝났다(데스크톱의 `refreshboardflag2`). */
  fifthStageDone: boolean;
  swapDone: boolean;
  /** 금수 표시를 켤 것인가. */
  showForbidden: boolean;
  log: readonly string[];

  setComputerSide: (s: ComputerSide) => void;
  setOpening: (o: OpeningProtocol) => void;
  setClockLimits: (
    limits: Partial<Pick<GameClock, "limited" | "turnLimitMs" | "matchLimitMs" | "incrementMs">>,
  ) => void;
  toggleForbidden: () => void;
  /**
   * 금수 목록을 다시 받아 온다. 화면이 **엔진이 준비되는 순간** 한 번 부른다 —
   * 그 전에는 물어볼 상대가 없어서 조용히 넘어가기 때문이다.
   */
  refreshForbidden: () => void;

  newGame: () => void;
  tap: (cell: Move) => TapResult;
  /** 한 수 무르기. 끝난 대국도 다시 열린다. */
  undoMove: () => void;
  resign: () => void;
  offerDraw: () => void;
  dismissPrompt: () => void;
  answerSwap: (yes: boolean) => void;
  answerSwap2: (choice: Swap2Choice) => void;
  answerFifthCount: (n: number) => void;

  /** 시계 틱. 화면이 250ms 마다 부른다. */
  advanceClock: (deltaMs: number) => void;
}

const board = () => useBoardStore.getState();
const engine = () => useEngineStore.getState();

/** 지금 둘 색. 돌 수가 짝수면 흑이다. */
const sideToMove = (moves: readonly Move[]): StoneColor => colorAt(moves.length);

/**
 * RIF·Soosorv 는 첫 세 수를 손으로 놓으므로 그 안에서는 엔진에게 두라고 하지
 * 않는다 — 다만 **빈 판**은 예외다(엔진이 흑이면 개시를 열 수 있다, main.c:2726).
 */
const openingLetsEngineMove = (o: OpeningProtocol, n: number): boolean =>
  !handEnteredOpening(o) || n >= 3 || n === 0;

export const useGameStore = create<GameState>((set, get) => {
  const log = (line: string) => set((s) => ({ log: [...s.log, line].slice(-LOG_LIMIT) }));

  const send = (...cmds: EngineCommand[]) => engine().send(...cmds);

  const addIncrement = (side: ClockSide) =>
    set((s) => ({ clock: addClockIncrement(s.clock, side) }));

  /** 시계를 그쪽으로 넘긴다. */
  const runClock = (side: ClockSide) => set((s) => ({ clock: startClock(s.clock, side) }));

  /**
   * 판이 바뀔 때마다의 승패 검사 — 데스크톱은 `make_move` 안에서 한다.
   * 결과가 사라지는 방향(무르기)도 반영한다.
   */
  const judge = () => {
    const r = refereeResult(board().render.stones, board().render.size, ALLOW_OVERLINE);
    const s = get();
    if (r && !s.result) {
      set((st) => ({ result: r, thinking: false, clock: stopClock(st.clock) }));
      log(`대국 종료 — ${r.winner ?? "무승부"} / ${r.end}`);
    } else if (!r && s.result) {
      set({ result: null });
    }
  };

  /** 돌 하나. **시계는 건드리지 않는다** — 위 파일 주석 참고. */
  const place = (cell: Move) => {
    const moves = board().render.stones;
    if (!inBoard(cell, board().render.size)) return;
    if (moves.some((m) => sameMove(m, cell))) return;
    board().place(cell);
    judge();
    refreshForbidden();
  };

  /** 판을 `count` 개까지 되감는다(데스크톱의 반복 `change_piece`). */
  const rewindTo = (count: number) => {
    const moves = board().render.stones;
    if (moves.length <= count) return;
    board().setStones(moves.slice(0, count));
  };

  const prompt = (p: GamePrompt) => set({ prompt: p });

  /**
   * 금수 목록을 다시 받아 온다 — 앱의 `refreshForbidden` 과 같은 조건이다.
   *
   * **탐색 중에는 절대 묻지 않는다.** `YXSHOWFORBID` 앞의 `YXBOARD` 가 엔진의
   * 국면을 갈아 끼우므로 돌고 있는 탐색을 방해한다. 그리고 사람이 흑을 잡고
   * 흑 차례일 때만 의미가 있다 — 금수는 흑에게만 있다.
   */
  function refreshForbidden() {
    const s = get();
    const wanted =
      s.showForbidden &&
      !s.thinking &&
      !s.result &&
      sideToMove(board().render.stones) === "black" &&
      !enginePlays(s.computerSide, "black") &&
      // 「기동해 있고 놀고 있다」 — searching 이면 위 주석대로 건드리지 않는다.
      engine().status === "ready";
    if (!wanted) {
      if (board().forbidden.length) board().setForbidden([]);
      return;
    }
    send({ kind: "yxboard", stones: board().placements() }, { kind: "yxshowforbid" });
  }

  const applySwapSides = () => {
    set((s) => ({ computerSide: swappedSide(s.computerSide) }));
    log("색 교환");
    refreshForbidden();
  };

  /**
   * 엔진에게 지금 국면을 넘기고 두라고 한다.
   *
   * W3 의 `analyze` 와 달리 이쪽은 **착수**다 — `YXBOARD`+`YXNBEST` 가 아니라
   * 판을 통째로 준 뒤 `BEGIN`/`BOARD` 를 쓴다. 앱은 방해받지 않은 수순에서
   * `TURN` 한 줄로 줄이지만, 여기서는 언제나 판 전체를 보낸다 — 협상이 판을
   * 되감는 규칙이 셋이라 «방해받지 않았다»를 따로 추적할 값이 하나 더 늘 뿐이다.
   */
  const engineTurn = () => {
    const s = get();
    if (s.result) return;
    const moves = board().render.stones;
    const clock = startClock(s.clock, "computer");
    set({ thinking: true, clock });
    engine().play(
      board().placements(),
      moves.length === 0,
      clock.limited
        ? {
            turnMs: Math.max(500, leftTurnMs(clock, "computer")),
            matchLeftMs: engineTimeLeftMs(clock),
          }
        : { turnMs: DEFAULT_TURN_MS },
    );
  };

  /**
   * 사람이 만든 국면을 엔진에게 **판정**시킨다 — Swap2 의 2·3단계뿐이다.
   * 착수가 아니므로 분석 보드(`YXBOARD`)로 넘긴 뒤 단계 명령을 보낸다.
   *
   * Soosorv 는 이걸 쓰지 않는다: `yxsoosorvstep<n>` 이 **수 목록을 스스로 들고
   * 가기 때문**이다(명령 정의의 주석 참고). 거기서 판을 한 번 더 밀면 같은 국면을
   * 두 번 말하는 셈이 된다.
   */
  const askEngine = (...step: EngineCommand[]) => {
    addIncrement("human");
    set((s) => ({ thinking: true, clock: startClock(s.clock, "computer") }));
    send({ kind: "yxboard", stones: board().placements() }, ...step);
  };

  /** Soosorv 의 단계 명령 — 사람의 가산만 붙이고 그대로 보낸다. */
  const sendStep = (cmd: EngineCommand) => {
    addIncrement("human");
    send(cmd);
  };

  /** 엔진이 답해 차례가 사람에게 돌아왔다. */
  const handBackToHuman = () => {
    addIncrement("computer");
    set({ thinking: false });
    runClock("human");
  };

  /**
   * 엔진이 먼저 움직여야 하는 협상을 연다(`new_game_resetclock`, main.c:4263).
   * 컴퓨터가 흑일 때의 Swap2·Soosorv 만 해당한다.
   */
  const startOpening = () => {
    const s = get();
    if (s.computerSide !== "black") return;
    if (s.opening === "swap2") {
      set((st) => ({ thinking: true, clock: startClock(st.clock, "computer") }));
      send({ kind: "yxswap2step", step: 1 });
    } else if (s.opening === "soosorv") {
      set((st) => ({ thinking: true, clock: startClock(st.clock, "computer") }));
      send({ kind: "yxsoosorvstep", step: 1 });
    }
  };

  // 엔진 쪽에 처리기를 걸어 둔다. `engine-state` 는 「대국」을 모르고, 대국이
  // 자기 손잡이를 등록한다 — 두 모듈이 서로를 import 하지 않게 하는 방향이다.
  //
  // **`return` 앞이어야 한다.** 처음에는 파일 맨 아래, 아래쪽 함수 선언들 뒤에
  // 두었는데 그 자리는 `return` 다음이라 **한 번도 실행되지 않았다**. 선언은
  // 끌어올려지지만 호출문은 아니다 — 엔진의 답이 대국에 닿지 않아 협상이
  // 통째로 죽어 있었고, 시험 열넷이 그것을 잡았다.
  setGameHandlers({
    onEngineMove,
    onOpening,
    onForbid: (cells) => board().setForbidden(get().showForbidden ? cells : []),
  });

  return {
    computerSide: "none",
    opening: "none",
    thinking: false,
    result: null,
    clock: EMPTY_CLOCK,
    prompt: null,
    fifthCount: 1,
    offeringFifth: false,
    fifthStageDone: false,
    swapDone: false,
    showForbidden: true,
    log: [],

    setComputerSide: (computerSide) => {
      set({ computerSide });
      log(`컴퓨터: ${computerSide}`);
      refreshForbidden();
    },

    setOpening: (opening) => {
      set({ opening });
      log(`오프닝: ${opening}`);
      // 협상은 판이 빈 상태에서만 의미가 있다 — 규칙을 바꾸면 새 대국이다.
      get().newGame();
    },

    setClockLimits: (limits) =>
      set((s) => ({
        clock: withLimits(s.clock, {
          limited: limits.limited ?? s.clock.limited,
          turnLimitMs: limits.turnLimitMs ?? s.clock.turnLimitMs,
          matchLimitMs: limits.matchLimitMs ?? s.clock.matchLimitMs,
          incrementMs: limits.incrementMs ?? s.clock.incrementMs,
        }),
      })),

    toggleForbidden: () => {
      set({ showForbidden: !get().showForbidden });
      refreshForbidden();
    },

    refreshForbidden,

    newGame: () => {
      board().clear();
      board().setForbidden([]);
      set((s) => ({
        result: null,
        thinking: false,
        prompt: null,
        offeringFifth: false,
        fifthStageDone: false,
        fifthCount: 1,
        swapDone: false,
        log: [],
        clock: {
          ...EMPTY_CLOCK,
          limited: s.clock.limited,
          turnLimitMs: s.clock.turnLimitMs,
          matchLimitMs: s.clock.matchLimitMs,
          incrementMs: s.clock.incrementMs,
          running: "human",
        },
      }));
      send({ kind: "restart" });
      log("새 대국");
      // 엔진이 먼저 말해야 하는 협상만 여기서 연다. **평범한 규칙에서 엔진이 흑
      // 이어도 자동으로 두지 않는다** — 데스크톱·앱과 같이 사람이 판을 한 번
      // 눌러 «두어라»라고 해야 시작한다.
      startOpening();
      refreshForbidden();
    },

    tap: (cell) => {
      const s = get();
      const size = board().render.size;
      if (!inBoard(cell, size)) return { kind: "ignored" };
      // 데스크톱은 탐색 중과 종국 뒤의 클릭을 삼킨다(main.c:2663 / 2676).
      if (s.thinking) return { kind: "rejected", reason: "엔진이 생각 중입니다" };
      if (s.result) {
        return {
          kind: "rejected",
          reason: "대국이 끝났습니다 — 무르거나 새 대국을 시작하세요",
        };
      }
      if (s.prompt) return { kind: "rejected", reason: "먼저 위 물음에 답해 주세요" };

      const moves = board().render.stones;
      const occupied = moves.some((m) => sameMove(m, cell));

      // Swap2 의 개시 돌은 **색과 무관하게 사람이 놓는다** — 그래서 여느 차례
      // 검사보다 앞에 온다. 이걸 뒤에 두면 「컴퓨터 백」에서 백 돌을 놓을 수 없다.
      if (s.opening === "swap2" && (moves.length < 3 || (moves.length < 5 && !s.swapDone))) {
        return occupied ? { kind: "ignored" } : swap2Tap(cell);
      }

      // 엔진 차례에 누르면 «두어라»라는 뜻이다(main.c:2725).
      if (
        !s.offeringFifth &&
        enginePlays(s.computerSide, sideToMove(moves)) &&
        openingLetsEngineMove(s.opening, moves.length)
      ) {
        if (s.opening === "swapFirst" && moves.length === 0 && s.computerSide !== "both") {
          // 데스크톱은 이 규칙을 정해진 한 수로 열고 교환할지 묻는다(main.c:2731).
          place(SWAP_FIRST_OPENING);
          prompt({ kind: "swap" });
          return { kind: "placed" };
        }
        engineTurn();
        return { kind: "ignored" };
      }

      if (occupied) {
        // Soosorv: 올라온 5수 후보 중 하나를 고르는 탭이다(main.c:2752).
        const number = moves.findIndex((m) => sameMove(m, cell)) + 1;
        if (
          s.opening === "soosorv" &&
          s.offeringFifth &&
          s.computerSide !== "white" &&
          number >= 4
        ) {
          set({ offeringFifth: false });
          rewindTo(4);
          place(cell);
          log(`5수 선택: ${label(cell, size)}`);
          return { kind: "placed" };
        }
        return { kind: "ignored" };
      }

      // 렌주 금수 — 데스크톱의 대화상자와 같이 거절한다. 5수 후보를 올리는
      // 중에는 검사하지 않는다(그 단계에서는 금수 위에도 후보를 놓는다).
      if (
        !s.offeringFifth &&
        sideToMove(moves) === "black" &&
        board().forbidden.some((m) => sameMove(m, cell))
      ) {
        prompt({ kind: "forbidden", cell });
        return { kind: "rejected", reason: `금수입니다 (${label(cell, size)})` };
      }

      place(cell);
      const handled = afterHumanMove(cell);
      const next = get();
      if (
        !next.result &&
        !handled &&
        enginePlays(next.computerSide, sideToMove(board().render.stones)) &&
        openingLetsEngineMove(next.opening, board().render.stones.length)
      ) {
        addIncrement("human");
        engineTurn();
      }
      return { kind: "placed" };
    },

    undoMove: () => {
      if (board().render.stones.length === 0) return;
      // 엔진에 `TAKEBACK` 을 보내지 않는다 — 다음 요청이 `BOARD`/`YXBOARD` 로
      // 국면을 통째로 다시 세우므로, 엔진의 판은 그때 맞춰진다.
      if (get().thinking) send({ kind: "stop" });
      board().undo();
      set((s) => ({ thinking: false, prompt: null, clock: stopClock(s.clock) }));
      judge();
      log("무르기");
      refreshForbidden();
    },

    resign: () => {
      const s = get();
      if (s.result) return;
      // 기권하면 지금 둘 차례의 반대가 이긴다.
      const loser = sideToMove(board().render.stones);
      send({ kind: "yxresign" });
      set({
        result: { end: "resigned", winner: loser === "black" ? "white" : "black" },
        thinking: false,
        clock: stopClock(s.clock),
      });
      log("기권했습니다 (yxresign)");
    },

    offerDraw: () => {
      const s = get();
      if (s.result) return;
      send({ kind: "yxdraw" });
      set({
        result: { end: "drawAgreed", winner: null },
        thinking: false,
        clock: stopClock(s.clock),
      });
      log("무승부를 제안했습니다 (yxdraw)");
    },

    dismissPrompt: () => {
      set({ prompt: null });
      refreshForbidden();
    },

    /**
     * 「교환하시겠습니까?」의 답. 규칙마다 뒤가 다르다 — 데스크톱을 그대로 옮긴다.
     */
    answerSwap: (yes) => {
      const s = get();
      const moves = board().render.stones;
      set({ prompt: null });
      addIncrement("human");
      if (!yes) {
        // Swap2 는 «아니오»에서도 색이 넘어간다(main.c:2485).
        if (s.opening === "swap2") applySwapSides();
        log("교환 안 함");
        return;
      }
      switch (s.opening) {
        case "swap2":
          engineTurn();
          break;
        case "soosorv":
          applySwapSides();
          // 가산은 위에서 이미 붙였다 — 여기서는 단계만 보낸다.
          send(
            moves.length === 3
              ? { kind: "yxsoosorvstep", step: 3, moves }
              : { kind: "yxsoosorvstep", step: 5, fifthCount: s.fifthCount, moves },
          );
          break;
        case "swapFirst":
          place(SWAP_FIRST_REPLY);
          applySwapSides();
          break;
        default:
          break;
      }
      log("교환");
    },

    answerSwap2: (choice) => {
      set({ prompt: null });
      log(`스왑2: ${choice}`);
      switch (choice) {
        case "stayWhite":
          // 사람이 백을 유지한다 — 다음은 사람의 수다.
          set({ swapDone: true });
          break;
        case "swap":
          addIncrement("human");
          applySwapSides();
          set({ swapDone: true });
          engineTurn();
          break;
        case "addTwo":
          // 두 수를 더 놓는다 — 사람이 판에 직접 놓는다.
          set({ swapDone: false });
          break;
      }
      refreshForbidden();
    },

    answerFifthCount: (n) => {
      const count = Math.min(MAX_FIFTH, Math.max(1, Math.round(n)));
      set({ prompt: null, fifthCount: count });
      log(`5수 후보 ${count}개`);
      sendStep({
        kind: "yxsoosorvstep",
        step: 4,
        fifthCount: count,
        moves: board().render.stones,
      });
    },

    advanceClock: (deltaMs) => {
      const s = get();
      if (!s.clock.running || s.result) return;
      const next = tickClock(s.clock, deltaMs);
      // 데스크톱은 **사람 쪽만** 경고하고, 한 번만 한다(timeoutflag).
      if (playerTimedOut(next) && !next.timedOutNotified) {
        set({
          clock: { ...stopClock(next), timedOutNotified: true },
          result: { end: "timeout", winner: "white" },
          thinking: false,
          prompt: { kind: "timeout" },
        });
        return;
      }
      set({ clock: next });
    },
  };

  /**
   * Swap2 개시: 두 수 놓고 판정, 두 수 더 놓고 판정(main.c:2683).
   * 어느 색이든 **사람이 판에 놓는다** — 협상은 색이 아직 정해지지 않은 단계다.
   */
  function swap2Tap(cell: Move): TapResult {
    const s = get();
    const n = board().render.stones.length;
    const engineBlack = enginePlays(s.computerSide, "black");
    const engineWhite = enginePlays(s.computerSide, "white");

    if (n < 2 && !engineBlack) {
      place(cell);
      return { kind: "placed" };
    }
    if (n === 2 && !engineBlack) {
      place(cell);
      askEngine({ kind: "yxswap2step", step: 2 });
      return { kind: "placed" };
    }
    if (n === 3 && !engineWhite && !s.swapDone) {
      place(cell);
      return { kind: "placed" };
    }
    if (n === 4 && !engineWhite && !s.swapDone) {
      place(cell);
      askEngine({ kind: "yxswap2step", step: 3 });
      return { kind: "placed" };
    }
    return { kind: "ignored" };
  }

  /**
   * 사람 돌 하나 뒤의 개시 처리. **이미 엔진에게 국면을 넘겼으면 `true`** 를
   * 돌려준다(데스크톱의 `flag`) — 그러면 호출부가 착수를 또 시키지 않는다.
   */
  function afterHumanMove(cell: Move): boolean {
    const s = get();
    const moves = board().render.stones;
    const n = moves.length;
    let handled = false;
    if (s.result) return true;

    // ── 첫 수 이후 교환 ─────────────────────────────────────────────
    if (s.opening === "swapFirst" && n === 1 && s.computerSide !== "none") {
      // 데스크톱은 경계에 걸린 두 개시에서 동전을 던진다(main.c:2777).
      if (swapAfterFirstMove(cell, board().render.size, Math.random() < 0.5)) {
        applySwapSides();
        prompt({ kind: "swapInfo" });
      }
    }

    // ── Soosorv-8 ───────────────────────────────────────────────────
    if (s.opening === "soosorv" && n === 3 && s.computerSide !== "black") {
      if (!openingAreaOk(moves, board().render.size)) {
        get().newGame();
        prompt({ kind: "illegalOpening" });
        return true;
      }
    }
    if (
      s.opening === "soosorv" &&
      n === 3 &&
      s.computerSide !== "none" &&
      s.computerSide !== "black"
    ) {
      sendStep({ kind: "yxsoosorvstep", step: 2, moves });
      handled = true;
    }
    if (
      s.opening === "soosorv" &&
      n === 4 &&
      s.computerSide !== "none" &&
      s.computerSide !== "white"
    ) {
      // 데스크톱은 여기서 N 을 묻고 그 답과 함께 4단계를 보낸다.
      prompt({ kind: "fifthCount" });
      handled = true;
    }
    if (
      s.opening === "soosorv" &&
      n >= 5 &&
      n <= 4 + s.fifthCount &&
      s.computerSide !== "none" &&
      s.computerSide !== "black"
    ) {
      if (!s.fifthStageDone) set({ offeringFifth: true });
      if (get().offeringFifth) handled = true;
    }
    if (
      s.opening === "soosorv" &&
      n === 4 + s.fifthCount &&
      s.computerSide !== "none" &&
      s.computerSide !== "black" &&
      !s.fifthStageDone
    ) {
      set({ offeringFifth: false, fifthStageDone: true });
      sendStep({ kind: "yxsoosorvstep", step: 6, moves: board().render.stones });
      handled = true;
    }

    return handled;
  }

  /** 엔진이 한 수(밸런스 탐색이면 두 수)를 답했다 — main.c:13934. */
  function onEngineMove(moves: readonly Move[]) {
    if (!get().thinking) return;
    const size = board().render.size;
    const onBoard = board().render.stones;
    handBackToHuman();

    const legal = moves.filter((m) => inBoard(m, size) && !onBoard.some((p) => sameMove(p, m)));
    if (legal.length === 0) {
      // 데스크톱은 둘 수 없는 답을 대국의 끝으로 친다(13955).
      const loser = sideToMove(onBoard);
      set({ result: { end: "resigned", winner: loser === "black" ? "white" : "black" } });
      log("엔진이 둘 수 없는 자리를 보냈습니다");
      return;
    }
    for (const m of legal) place(m);

    const next = get();
    if (!next.result && enginePlays(next.computerSide, sideToMove(board().render.stones))) {
      engineTurn();
    }
  }

  /**
   * 협상 응답. 데스크톱의 `onOpeningMove`/`onOpeningSwap`/`SoosorvFifth` 세 갈래.
   *
   * 여기서 하는 일은 **판에 올리고 무엇을 물을지 정하는 것**뿐이다 — 규칙 판단은
   * 엔진이 이미 했다.
   */
  function onOpening(r: OpeningResponse) {
    if (get().result) return;

    if (r.kind === "openingMove") {
      place(r.move);
      if (r.swap2 && r.index === 3) {
        handBackToHuman();
        prompt({ kind: "swap2" });
      } else if (r.swap2 && r.index === 5) {
        handBackToHuman();
        set({ swapDone: true });
        prompt({ kind: "swap" });
      } else if (!r.swap2 && r.index === 3) {
        handBackToHuman();
        prompt({ kind: "swap" });
      } else if (!r.swap2 && r.index === 4) {
        // MOVE4 는 N 도 함께 알리고, 후보를 보여 주기 시작한다.
        handBackToHuman();
        set((st) => ({
          fifthCount: r.fifthCount ?? st.fifthCount,
          offeringFifth: st.fifthStageDone ? st.offeringFifth : true,
        }));
        prompt({ kind: "swap", fifthCount: get().fifthCount });
      }
      // MOVE1/2(그리고 Swap2 의 MOVE4)는 그냥 판 위의 돌이다.
      return;
    }

    if (r.kind === "openingSwap") {
      const moves = board().render.stones;
      if (r.swap2 && r.which === 1 && !r.yes) {
        // 엔진이 백을 유지하고 이어 둔다(main.c:13367).
        set({ swapDone: true });
        engineTurn();
      } else if (r.swap2 && r.which === 1 && r.yes) {
        handBackToHuman();
        set({ swapDone: true });
        applySwapSides();
        prompt({ kind: "swapInfo" });
      } else if (r.swap2 && r.yes) {
        // 둘째 물음(main.c:13405).
        handBackToHuman();
        log("컴퓨터가 흑을 선택했습니다");
      } else if (r.swap2) {
        log("컴퓨터가 백을 선택했습니다");
        applySwapSides();
        engineTurn();
      } else if (r.yes) {
        // Soosorv: 예 = 엔진이 색을 가져간다.
        handBackToHuman();
        applySwapSides();
        prompt({ kind: "swapInfo" });
      } else if (r.which === 1) {
        send({ kind: "yxsoosorvstep", step: 3, moves });
      } else {
        send({
          kind: "yxsoosorvstep",
          step: 5,
          fifthCount: get().fifthCount,
          moves,
        });
      }
      return;
    }

    // soosorvFifth
    if (r.stage === "choose") {
      // 엔진이 제시된 5수 중 하나를 골랐다 — 판을 넷으로 되감고 그 하나만 둔다(13502).
      rewindTo(4);
      if (r.move) place(r.move);
      engineTurn();
      return;
    }
    if (r.stage === "refresh") {
      set({ offeringFifth: true });
      return;
    }
    if (r.stage === "done") {
      handBackToHuman();
      set((st) => ({
        fifthStageDone: true,
        offeringFifth: st.fifthCount === 1 ? false : st.offeringFifth,
      }));
      return;
    }
    // offer
    if (r.move) place(r.move);
  }
});
