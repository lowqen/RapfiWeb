import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { db as defaultDb, type RapfiDb } from "../../data/db";
import { readAutosave, readSlot, writeAutosave, writeSlot } from "../../data/games";
import type { Move } from "../../core/model/move";
import { prepareLinkBackup } from "./linkBackup";

/**
 * 판 자동 저장 — 새로고침해도, 탭을 닫았다 열어도 보던 판이 그대로다.
 *
 * **두 탭의 판을 따로 남긴다** — [대국] 판은 `"autosave"` 자리, [분석] 판은 `"analysis"` 자리(갈라져
 * 나온 대국 수순 `base` 와 함께). 탭마다 판이 따로인 까닭과 규칙은 `gameStore` 의 `ParkedBoard`.
 * 예전 판본이 남긴 `"autosave"` 하나만 있으면 그것이 대국 판이고, 분석 판은 거기서 갈라진다.
 *
 * 기보(수순 + 무른 수 + 이름)만 남긴다. 대국 설정(개시 · 컴퓨터 색 · 시간)과 결과는
 * 남기지 않는다 — 결과는 판에서 다시 보이고(`loadMoves` 의 승패 검사), 엔진이 생각하던
 * 수는 새로고침과 함께 사라지는 것이 맞다.
 *
 * **되살리기가 끝나기 전에는 쓰지 않는다.** 그러지 않으면 막 뜬 빈 판이 저장된 판을
 * 덮어쓴다. 되살리는 사이 사용자가 먼저 돌을 놓았으면 그 판이 이긴다 — 되살리지 않는다.
 *
 * **국면 딥링크(`?p=`)로 열었으면 되살리지 않는다** — `initial` 이 그 수순이고, 링크의
 * 국면이 곧 지금 판이 되어 자동 저장 자리를 덮는다. 링크를 연다는 것은 그 판을 보겠다는
 * 뜻이기 때문이다. 덮이기 전에 두던 판은 `linkBackup.ts` 가 따로 보관하고 되돌릴 길을 준다.
 *
 * 쓰기는 마지막 변화 뒤 `delayMs` 만큼 기다려 한 번(「끝으로」처럼 여러 수가 한꺼번에
 * 바뀌어도 한 번). 페이지가 숨겨질 때는 기다리지 않고 바로 쓴다 — 언로드 중에는 비동기
 * 완료가 보장되지 않으므로 숨겨지는 순간(`visibilitychange`)이 마지막 기회다.
 */
export interface Autosave {
  /** 되살리기를 마쳤다(되살릴 것이 없었어도). 이 뒤로 변화가 저장된다. */
  ready: Promise<void>;
  /** 기다리던 쓰기를 지금 한다. */
  flush: () => Promise<void>;
  stop: () => void;
}

export function startAutosave(
  d: RapfiDb | null = defaultDb(),
  delayMs = 400,
  initial: readonly Move[] | null = null,
): Autosave {
  if (!d) {
    if (initial) loadLink(initial);
    return { ready: Promise.resolve(), flush: async () => {}, stop: () => {} };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let stopped = false;
  let unsubs: (() => void)[] = [];

  const write = async () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!dirty || stopped) return;
    dirty = false;
    const size = useBoardStore.getState().render.size;
    const { game, analysis, base } = useGameStore.getState().sessions();
    try {
      await writeAutosave(d, {
        name: game.name ?? "",
        size,
        moves: game.stones,
        future: game.future,
      });
      if (analysis) {
        await writeSlot(d, "analysis", {
          name: analysis.name ?? "",
          size,
          moves: analysis.stones,
          future: analysis.future,
          base: base ?? [],
        });
      }
    } catch {
      /* 저장소가 막혀도(용량 · 사생활 보호) 판은 그대로 돈다 */
    }
  };

  const schedule = () => {
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void write(), delayMs);
  };

  const onHide = () => {
    if (document.visibilityState === "hidden") void write();
  };

  const ready = (async () => {
    // 덮기 **전에** 두던 판을 보관해 둔다(링크가 없으면 지난번 보관판을 다시 띄운다).
    await prepareLinkBackup(d, initial);
    if (initial) {
      // [분석] 탭으로 열리면 링크의 국면은 분석 판에 오르고, 대국 판은 저장된 그대로 접어 둔다.
      if (useGameStore.getState().mode === "analysis") await restoreGameOnly();
      loadLink(initial);
      dirty = true; // 링크의 국면을 자동 저장 자리에 — 구독을 건 뒤 곧바로 쓴다
    } else {
      await restore();
    }
    if (stopped) return;
    unsubs = [
      useBoardStore.subscribe((s, prev) => {
        if (s.render.stones !== prev.render.stones || s.future !== prev.future) schedule();
      }),
      useGameStore.subscribe((s, prev) => {
        // 탭 전환은 두 판이 자리를 바꾸는 순간이라 **기다리지 않고** 쓴다 — 400ms 쉼을 기다리다가
        // 곧바로 새로고침 · 다른 주소로 가면 쓰기를 잃었다(언로드 중 비동기 쓰기는 보장되지 않는다).
        // 쓰기는 `setMode` 가 판을 다 갈아 끼운 **뒤**(마이크로태스크)에 — 모드만 바뀌고 보드는 아직 옛
        // 탭의 판인 중간 상태를 쓰면 분석 판이 대국 기보 자리에 들어간다(실제로 그렇게 덮였다).
        if (s.mode !== prev.mode) {
          dirty = true;
          queueMicrotask(() => void write());
          return;
        }
        if (
          s.gameName !== prev.gameName ||
          s.parkedGame !== prev.parkedGame ||
          s.parkedAnalysis !== prev.parkedAnalysis ||
          s.analysisBase !== prev.analysisBase
        )
          schedule();
      }),
    ];
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onHide);
      unsubs.push(() => document.removeEventListener("visibilitychange", onHide));
    }
    if (typeof window !== "undefined") {
      // 주소를 옮기거나 닫을 때 — visibilitychange 가 먼저 오지 않는 브라우저 · 경로를 위해 한 번 더.
      const onPageHide = () => void write();
      window.addEventListener("pagehide", onPageHide);
      unsubs.push(() => window.removeEventListener("pagehide", onPageHide));
    }
    if (dirty) schedule();
  })();

  async function restore() {
    try {
      const saved = await readAutosave(d!);
      const savedAnalysis = await readSlot(d!, "analysis");
      const { render, future } = useBoardStore.getState();
      const untouched = render.stones.length === 0 && future.length === 0;
      const usable = (x: typeof saved) =>
        x !== null && x.size === render.size && x.moves.length + x.future.length > 0;
      if (stopped || !untouched || !(usable(saved) || usable(savedAnalysis))) return;
      const game = saved && usable(saved) ? saved : null;
      const analysis = savedAnalysis && usable(savedAnalysis) ? savedAnalysis : null;
      const active = useGameStore.getState().mode === "game" ? game : (analysis ?? game);
      useGameStore.getState().restoreSessions(
        {
          game: {
            stones: game?.moves ?? [],
            future: game?.future ?? [],
            result: null,
            name: game?.name || null,
          },
          analysis: analysis && {
            stones: analysis.moves,
            future: analysis.future,
            result: null,
            name: analysis.name || null,
          },
          base: analysis?.base ?? null,
        },
        `지난 판을 이어서: ${active?.moves.length ?? 0}수`,
      );
    } catch {
      /* 읽지 못하면 새 판으로 시작한다 */
    }
  }

  /** 링크로 열 때 — 대국 판만 접어 둔다(분석 판 자리는 링크의 국면이 덮는다). */
  async function restoreGameOnly() {
    try {
      const saved = await readAutosave(d!);
      if (stopped || !saved || saved.moves.length + saved.future.length === 0) return;
      useGameStore.setState({
        parkedGame: {
          stones: saved.moves,
          future: saved.future,
          result: null,
          name: saved.name || null,
        },
        analysisBase: saved.moves,
      });
    } catch {
      /* 읽지 못하면 대국 판은 빈 판이다 */
    }
  }

  return {
    ready,
    flush: write,
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      unsubs.forEach((u) => u());
      unsubs = [];
    },
  };
}

/** 링크의 국면을 판에 올린다. */
function loadLink(moves: readonly Move[]) {
  useGameStore.getState().loadMoves(moves, { what: `링크로 연 국면: ${moves.length}수` });
}
