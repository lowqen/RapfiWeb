import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { db as defaultDb, type RapfiDb } from "../../data/db";
import { readAutosave, writeAutosave } from "../../data/games";

/**
 * 판 자동 저장 — 새로고침해도, 탭을 닫았다 열어도 보던 판이 그대로다.
 *
 * 기보(수순 + 무른 수 + 이름)만 남긴다. 대국 설정(개시 · 컴퓨터 색 · 시간)과 결과는
 * 남기지 않는다 — 결과는 판에서 다시 보이고(`loadMoves` 의 승패 검사), 엔진이 생각하던
 * 수는 새로고침과 함께 사라지는 것이 맞다.
 *
 * **되살리기가 끝나기 전에는 쓰지 않는다.** 그러지 않으면 막 뜬 빈 판이 저장된 판을
 * 덮어쓴다. 되살리는 사이 사용자가 먼저 돌을 놓았으면 그 판이 이긴다 — 되살리지 않는다.
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

export function startAutosave(d: RapfiDb | null = defaultDb(), delayMs = 400): Autosave {
  if (!d) return { ready: Promise.resolve(), flush: async () => {}, stop: () => {} };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let stopped = false;
  let unsubs: (() => void)[] = [];

  const write = async () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!dirty || stopped) return;
    dirty = false;
    const { render, future } = useBoardStore.getState();
    try {
      await writeAutosave(d, {
        name: useGameStore.getState().gameName ?? "",
        size: render.size,
        moves: render.stones,
        future,
      });
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
    try {
      const saved = await readAutosave(d);
      const { render, future } = useBoardStore.getState();
      const untouched = render.stones.length === 0 && future.length === 0;
      if (
        !stopped &&
        saved &&
        untouched &&
        saved.size === render.size &&
        saved.moves.length + saved.future.length > 0
      ) {
        useGameStore.getState().loadMoves(saved.moves, {
          future: saved.future,
          name: saved.name || null,
          what: `지난 판을 이어서 — ${saved.moves.length}수`,
        });
      }
    } catch {
      /* 읽지 못하면 새 판으로 시작한다 */
    }
    if (stopped) return;
    unsubs = [
      useBoardStore.subscribe((s, prev) => {
        if (s.render.stones !== prev.render.stones || s.future !== prev.future) schedule();
      }),
      useGameStore.subscribe((s, prev) => {
        if (s.gameName !== prev.gameName) schedule();
      }),
    ];
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onHide);
      unsubs.push(() => document.removeEventListener("visibilitychange", onHide));
    }
  })();

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
