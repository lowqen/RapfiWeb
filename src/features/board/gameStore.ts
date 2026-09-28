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
  type TapResult,
} from "../../core/model/game";
import {
  openingAreaOk,
  result as refereeResult,
  swapAfterFirstMove,
} from "../../core/model/referee";
import { useBoardStore } from "./boardStore";
import { setGameHandlers, useEngineStore } from "../../engine/engine-state";
import type { EngineCommand } from "../../engine/engine-types";

/**
 * 대국 상태 기계 — `data/game/GameRepositoryImpl.kt` 의 대국·개시·시계 부분.
 *
 * **이 파일에는 렌주 판정이 한 줄도 없다.** 금수는 엔진이 `YXSHOWFORBID` 로
 * 알려 주고, 승패만 `referee` 가 본다. 데스크톱·앱과 같은 분담이다.
 *
 * 개시에서 우리가 직접 정하는 것은 셋뿐이고, 모두 **데스크톱도 엔진에게 묻지
 * 않는** 것들이다:
 *   - 개시 영역 검사(`openingAreaOk`) — 손으로 놓는 첫 세 수
 *   - 「첫 수 이후 교환」의 교환 여부(`swapAfterFirstMove`) — 동전 던지기 포함
 *   - 그 규칙의 정해진 개시 두 수(`SWAP_FIRST_OPENING` / `SWAP_FIRST_REPLY`)
 *
 * 엔진에게 협상을 시키던 Soosorv-8·스왑2 는 빠졌다 — Rapfi 가 그 명령을 모른다
 * (`docs/오프닝-협상-엔진-지원.md`).
 *
 * **대국 시계는 없다.** 시계·시간 초과·수당 가산을 걷어냈다. 엔진의 한 수에 쓸
 * 시간만 `moveTimeMs` 하나로 정한다 — 0 이면 무제한(「지금 두기」까지 읽는다),
 * 아니면 매 수 그만큼(`INFO timeout_turn`, 대국 예산 없음). 데스크톱의 「사용자 정의
 * 레벨」에서 턴 시간만 남긴 것과 같다.
 */

/** 엔진 착수 시간 선택지(ms). 0 = 무제한. */
export const MOVE_TIME_CHOICES = [0, 1_000, 3_000, 5_000, 10_000, 30_000] as const;

/** 렌주에서는 장목이 흑의 **금수**라 승리 판정에서는 장목을 인정한다. */
const ALLOW_OVERLINE = true;

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
  /** 엔진이 한 수에 쓸 시간(ms). 0 = 무제한 — 「지금 두기」까지 읽는다. */
  moveTimeMs: number;
  prompt: GamePrompt | null;
  /** 금수 표시를 켤 것인가. */
  showForbidden: boolean;
  log: readonly string[];

  setComputerSide: (s: ComputerSide) => void;
  setOpening: (o: OpeningProtocol) => void;
  setMoveTime: (ms: number) => void;
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
  /** 빈 판까지 되돌린다(이동 바의 `|<`). 무른 수는 모두 앞으로 가기에 남는다. */
  undoAll: () => void;
  /**
   * 무른 수 하나를 다시 둔다(이동 바의 `>`). **착수가 아니라 기보 이동**이라
   * 엔진에게 두라고 하지 않는다 — 엔진 차례면 판을 눌러 시키는 것은 그대로다.
   */
  redoMove: () => void;
  /** 무른 수를 끝까지 다시 둔다(이동 바의 `>|`). */
  redoAll: () => void;
  resign: () => void;
  offerDraw: () => void;
  dismissPrompt: () => void;
  answerSwap: (yes: boolean) => void;
  /**
   * 「지금 두기」 — 생각 중인 엔진에게 지금까지의 최선수를 두게 한다. 무제한
   * 대국에서 엔진의 한 수를 끝내는 유일한 방법이다(데스크톱의 정지와 같다).
   */
  moveNow: () => void;
}

const board = () => useBoardStore.getState();
const engine = () => useEngineStore.getState();

/** 지금 둘 색. 돌 수가 짝수면 흑이다. */
const sideToMove = (moves: readonly Move[]): StoneColor => colorAt(moves.length);

/**
 * RIF 는 첫 세 수를 손으로 놓으므로 그 안에서는 엔진에게 두라고 하지 않는다 —
 * 다만 **빈 판**은 예외다(엔진이 흑이면 개시를 열 수 있다, main.c:2726).
 */
const openingLetsEngineMove = (o: OpeningProtocol, n: number): boolean =>
  !handEnteredOpening(o) || n >= 3 || n === 0;

export const useGameStore = create<GameState>((set, get) => {
  const log = (line: string) => set((s) => ({ log: [...s.log, line].slice(-LOG_LIMIT) }));

  const send = (...cmds: EngineCommand[]) => engine().send(...cmds);

  /**
   * 판이 바뀔 때마다의 승패 검사 — 데스크톱은 `make_move` 안에서 한다.
   * 결과가 사라지는 방향(무르기)도 반영한다.
   */
  const judge = () => {
    const r = refereeResult(board().render.stones, board().render.size, ALLOW_OVERLINE);
    const s = get();
    if (r && !s.result) {
      set({ result: r, thinking: false });
      log(`대국 종료 — ${r.winner ?? "무승부"} / ${r.end}`);
    } else if (!r && s.result) {
      set({ result: null });
    }
  };

  /** 돌 하나. */
  const place = (cell: Move) => {
    const moves = board().render.stones;
    if (!inBoard(cell, board().render.size)) return;
    if (moves.some((m) => sameMove(m, cell))) return;
    board().place(cell);
    judge();
    refreshForbidden();
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
   * 엔진 무응답 감시견.
   *
   * `thinking` 을 켜 두고 답을 기다리는 모든 자리에 바닥을 깐다. 답이 오지 않으면
   * 판이 통째로 잠기기 때문이다 — 이후 모든 탭이 「엔진이 생각 중입니다」로
   * 거절되고 시계만 흘러간다. W4 에서 실제로 겪은 고장이고, 그때 원인은 이
   * 엔진이 협상 명령을 모른다는 것이었다(`docs/오프닝-협상-엔진-지원.md`).
   *
   * 협상이 돌아올 때를 위해 **15초 바닥을 남겨 둔다.** 협상 응답은 탐색이 아니라
   * 즉답이므로 그보다 오래 걸릴 이유가 없고, 착수는 자기 예산에 여유를 더해 잰다.
   *
   * 늦게 온 답이 `thinking: false` 를 만나 조용히 버려지지 않도록, 풀 때
   * `YXSTOP` 도 함께 보낸다.
   *
   * 시험(node)에는 `window` 가 없다 — 감시견은 화면의 안전망이라 거기서는 걸지
   * 않는다. 덤으로 시험이 끝난 뒤 타이머가 남지 않는다.
   */
  const WATCHDOG_FLOOR_MS = 15_000;
  const WATCHDOG_SLACK_MS = 10_000;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const disarmWatchdog = () => {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const armWatchdog = (budgetMs: number) => {
    if (typeof window === "undefined") return;
    disarmWatchdog();
    watchdog = setTimeout(
      () => {
        watchdog = null;
        if (!get().thinking || get().result) return;
        send({ kind: "stop" });
        set({ thinking: false });
        prompt({ kind: "info", text: "엔진이 답하지 않습니다 — 손으로 이어서 두세요." });
        log("엔진 무응답 — 기다림을 풀었습니다");
      },
      Math.max(WATCHDOG_FLOOR_MS, budgetMs + WATCHDOG_SLACK_MS),
    );
  };

  /**
   * 엔진에게 지금 국면을 넘기고 두라고 한다.
   *
   * W3 의 `analyze` 와 달리 이쪽은 **착수**다 — `YXBOARD`+`YXNBEST` 가 아니라
   * 판을 통째로 준 뒤 `BEGIN`/`BOARD` 를 쓴다. 앱은 방해받지 않은 수순에서
   * `TURN` 한 줄로 줄이지만, 여기서는 언제나 판 전체를 보낸다 — 개시가 판을
   * 되감을 수 있어 «방해받지 않았다»를 따로 추적할 값이 하나 더 늘 뿐이다.
   */
  const engineTurn = () => {
    const s = get();
    if (s.result) return;
    const moves = board().render.stones;
    set({ thinking: true });
    if (s.moveTimeMs <= 0) {
      // **무제한: 엔진은 「지금 두기」까지 생각한다.** 데스크톱·앱의 기본 레벨
      // (level 0 — 시간·노드 무제한, 사용자가 멈추면 둔다)과 같다. 예전엔 여기서
      // 5초를 줬고 「앱의 기본값」이라고 적었는데, 틀린 말이었다.
      // 감시견도 걸지 않는다 — 끝을 정하는 것은 사용자다.
      void engine().play(board().placements(), moves.length === 0, { turnMs: Infinity });
      return;
    }
    // 한 수 예산만 준다. 대국 예산(`timeout_match`)은 0 — 대국 시계가 없다.
    const turnMs = Math.max(500, s.moveTimeMs);
    const budget = { turnMs, matchMs: 0 };
    // 감시견은 **엔진이 준비된 뒤에** 건다. 첫 수에는 엔진 기동(20MB 가중치
    // 내려받기)이 끼는데, 느린 회선에서 그 시간까지 세면 멀쩡한 대국을 끊는다.
    void engine()
      .play(board().placements(), moves.length === 0, budget)
      .then(() => {
        if (get().thinking) armWatchdog(turnMs);
      });
  };

  /** 엔진이 답해 차례가 사람에게 돌아왔다. */
  const handBackToHuman = () => {
    disarmWatchdog();
    set({ thinking: false });
  };

  // 엔진 쪽에 처리기를 걸어 둔다. `engine-state` 는 「대국」을 모르고, 대국이
  // 자기 손잡이를 등록한다 — 두 모듈이 서로를 import 하지 않게 하는 방향이다.
  //
  // **`return` 앞이어야 한다.** 아래쪽 함수 선언들 뒤(= `return` 다음)에 두면
  // 한 번도 실행되지 않는다 — 함수 **선언**은 끌어올려지지만 호출문은 아니다.
  // 이 자리를 두 번 틀렸다. 그때마다 엔진의 답이 대국에 닿지 않아 화면에서는
  // 「엔진이 영원히 생각 중」으로 보였다.
  setGameHandlers({
    onEngineMove,
    onOpening: (r) => {
      // 이 빌드는 협상을 걸지 않는다(파일 머리 주석). 그래도 오면 **삼키지
      // 않는다** — 「모르는 줄도 버리지 않는다」가 이 저장소의 규칙이다.
      disarmWatchdog();
      log(`예상치 못한 협상 응답: ${r.kind}`);
    },
    onForbid: (cells) => board().setForbidden(get().showForbidden ? cells : []),
  });

  return {
    computerSide: "none",
    opening: "none",
    thinking: false,
    result: null,
    moveTimeMs: 0,
    prompt: null,
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
      // 개시는 판이 빈 상태에서만 의미가 있다 — 규칙을 바꾸면 새 대국이다.
      get().newGame();
    },

    setMoveTime: (ms) => {
      const moveTimeMs = ms > 0 ? Math.round(ms) : 0;
      set({ moveTimeMs });
      log(`엔진 착수 시간: ${moveTimeMs === 0 ? "무제한" : `${moveTimeMs}ms`}`);
    },

    toggleForbidden: () => {
      set({ showForbidden: !get().showForbidden });
      refreshForbidden();
    },

    refreshForbidden,

    newGame: () => {
      disarmWatchdog();
      board().clear();
      board().setForbidden([]);
      set({ result: null, thinking: false, prompt: null, log: [] });
      send({ kind: "restart" });
      log("새 대국");
      // **엔진이 흑이어도 자동으로 두지 않는다** — 데스크톱·앱과 같이 사람이
      // 판을 한 번 눌러 «두어라»라고 해야 시작한다.
      refreshForbidden();
    },

    tap: (cell) => {
      const s = get();
      const size = board().render.size;
      if (!inBoard(cell, size)) return { kind: "ignored" };
      // 데스크톱은 탐색 중과 종국 뒤의 클릭을 삼킨다(main.c:2663 / 2676).
      if (s.thinking) {
        const reason =
          s.moveTimeMs > 0
            ? "엔진이 생각 중입니다"
            : "엔진이 생각 중입니다 — 「지금 두기」를 누르면 둡니다";
        return { kind: "rejected", reason };
      }
      if (s.result) {
        return {
          kind: "rejected",
          reason: "대국이 끝났습니다 — 무르거나 새 대국을 시작하세요",
        };
      }
      if (s.prompt) return { kind: "rejected", reason: "먼저 위 물음에 답해 주세요" };

      const moves = board().render.stones;
      if (moves.some((m) => sameMove(m, cell))) return { kind: "ignored" };

      // 엔진 차례에 누르면 «두어라»라는 뜻이다(main.c:2725).
      if (
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

      // 렌주 금수 — 데스크톱의 대화상자와 같이 거절한다.
      if (sideToMove(moves) === "black" && board().forbidden.some((m) => sameMove(m, cell))) {
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
        engineTurn();
      }
      return { kind: "placed" };
    },

    undoMove: () => rewind(1, "무르기"),

    undoAll: () => rewind(board().render.stones.length, "처음으로"),

    redoMove: () => replay(1, "다시 두기"),

    redoAll: () => replay(board().future.length, "끝으로"),

    resign: () => {
      const s = get();
      if (s.result) return;
      disarmWatchdog();
      // 기권하면 지금 둘 차례의 반대가 이긴다.
      const loser = sideToMove(board().render.stones);
      send({ kind: "yxresign" });
      set({
        result: { end: "resigned", winner: loser === "black" ? "white" : "black" },
        thinking: false,
      });
      log("기권했습니다 (yxresign)");
    },

    offerDraw: () => {
      const s = get();
      if (s.result) return;
      disarmWatchdog();
      send({ kind: "yxdraw" });
      set({ result: { end: "drawAgreed", winner: null }, thinking: false });
      log("무승부를 제안했습니다 (yxdraw)");
    },

    moveNow: () => {
      // 워커가 다음 조각 경계(≤ 500ms)에서 멈추고 마지막 조각의 최선수를 올린다.
      if (get().thinking) engine().stop();
    },

    dismissPrompt: () => {
      set({ prompt: null });
      refreshForbidden();
    },

    /**
     * 「색을 교환하시겠습니까?」의 답 — 「첫 수 이후 교환」에서만 나온다.
     *
     * 예: 데스크톱이 정해진 답수를 두고 색을 맞바꾼다(main.c:2468).
     * 아니오: 그대로 둔다. 다음은 사람(백)의 수다.
     */
    answerSwap: (yes) => {
      set({ prompt: null });
      if (!yes) {
        log("교환 안 함");
        refreshForbidden();
        return;
      }
      place(SWAP_FIRST_REPLY);
      applySwapSides();
      log("교환");
    },
  };

  /**
   * `n` 수 무르기 — 한 수 무르기와 처음으로가 같은 길을 걷는다.
   *
   * 엔진에 `TAKEBACK` 을 보내지 않는다 — 다음 요청이 `BOARD`/`YXBOARD` 로
   * 국면을 통째로 다시 세우므로, 엔진의 판은 그때 맞춰진다.
   */
  function rewind(n: number, what: string) {
    if (n <= 0 || board().render.stones.length === 0) return;
    disarmWatchdog();
    if (get().thinking) engine().stop();
    for (let i = 0; i < n && board().render.stones.length > 0; i++) board().undo();
    set({ thinking: false, prompt: null });
    judge();
    log(what);
    refreshForbidden();
  }

  /**
   * 무른 수를 `n` 개 다시 둔다. 생각 중이거나 물음이 떠 있으면 하지 않는다 —
   * `tap` 이 그때 판을 거절하는 것과 같은 이유다(엔진의 답이 엇갈린 판에 떨어진다).
   *
   * 금수 조회는 **끝에 한 번만** 한다. 한 수마다 물으면 `YXBOARD` 가 수만큼 간다.
   */
  function replay(n: number, what: string) {
    const s = get();
    if (n <= 0 || s.thinking || s.prompt) return;
    for (let i = 0; i < n; i++) {
      const next = board().future[0];
      if (!next) break;
      board().place(next);
      judge();
      if (get().result) break;
    }
    log(what);
    refreshForbidden();
  }

  /**
   * 사람 돌 하나 뒤의 개시 처리. **이미 국면을 넘겼거나 물음을 띄웠으면 `true`**
   * 를 돌려준다(데스크톱의 `flag`) — 그러면 호출부가 착수를 또 시키지 않는다.
   */
  function afterHumanMove(cell: Move): boolean {
    const s = get();
    const moves = board().render.stones;
    const n = moves.length;
    if (s.result) return true;

    // ── 첫 수 이후 교환 ─────────────────────────────────────────────
    if (s.opening === "swapFirst" && n === 1 && s.computerSide !== "none") {
      // 데스크톱은 경계에 걸린 두 개시에서 동전을 던진다(main.c:2777).
      if (swapAfterFirstMove(cell, board().render.size, Math.random() < 0.5)) {
        applySwapSides();
        prompt({ kind: "swapInfo" });
        return true;
      }
    }

    // ── 손으로 놓는 개시(RIF)의 영역 검사 ───────────────────────────
    //
    // 앱은 이 검사를 Soosorv 에만 걸었지만, RIF 도 첫 세 수를 천원 둘레에
    // 놓는 규칙이고 화면이 그렇게 안내한다. Soosorv 가 빠진 지금 그 조건을
    // 그대로 두면 검사가 아무 데도 걸리지 않으므로, **손으로 놓는 개시**로
    // 옮긴다 — 앱과의 의도된 차이다.
    if (handEnteredOpening(s.opening) && n === 3 && s.computerSide !== "black") {
      if (!openingAreaOk(moves, board().render.size)) {
        get().newGame();
        prompt({ kind: "illegalOpening" });
        return true;
      }
    }

    return false;
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
});

/**
 * **분석은 국면을 따라간다.** 분석을 켜 둔 채 수를 두거나 무르면 새 국면을 이어
 * 읽는다 — 앱의 분석 모드와 같다. 예전에는 착수가 나오면 분석이 옛 국면을 붙든 채
 * 돌거나(보드의 값 칩이 한 수 전 판을 말한다) 사용자가 다시 눌러야 했다.
 *
 * 화면이 아니라 스토어에 건다 — 설정 화면에서 「새 대국」을 눌러도 따라가야 한다.
 *
 * **한 박자 늦춰 판단한다.** 대국에서 사람이 두면 같은 호출 안에서 곧바로 엔진의
 * 착수(`play`)가 이어지고, 그 착수가 분석 의도를 끈다. 여기서 즉시 분석을 걸면
 * 착수 앞에 쓸데없는 분석 요청이 하나 끼어든다.
 */
let followScheduled = false;
useBoardStore.subscribe((s, prev) => {
  if (s.render.stones === prev.render.stones || followScheduled) return;
  // 「끝으로」처럼 한 번에 여러 수가 바뀌어도 분석 요청은 하나만.
  followScheduled = true;
  queueMicrotask(() => {
    followScheduled = false;
    const e = useEngineStore.getState();
    if (!e.analyzing || useGameStore.getState().thinking) return;
    void e.analyze(useBoardStore.getState().placements());
  });
});
