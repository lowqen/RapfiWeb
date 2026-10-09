import { useEffect, useMemo } from "react";
import { positionKey } from "../../core/model/move";
import { positionValue, type DbPositionValue, type DbSnapshot } from "../../core/database/yixindb";
import { useEngineStore } from "../../engine/engine-state";
import { useDbStore } from "../database/dbStore";
import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";

/**
 * 보드 화면의 DB(W8) — DB 화면에 가지 않아도 지금 국면의 기록이 판 · 평가 바 · 국면 카드에 온다
 * (데스크톱이 `show_database` 를 켜 둔 채 두는 것과 같다).
 *
 * **언제 묻는가.** 판이 바뀔 때, DB 가 붙을 때, 엔진이 놀게 될 때(탐색이 DB 에 쓴 것을 줍는다).
 * 연달아 바뀌면(「끝으로」 · 형세 그래프 끌기) 마지막 국면 하나만 묻는다(`REFRESH_DELAY_MS`).
 *
 * **언제 묻지 않는가.** 대국에서 엔진이 수를 생각하는 동안과 리뷰 · 증명이 엔진을 쥐고 있는
 * 동안. 워커는 줄에 선 요청이 있으면 도는 탐색을 다음 조각 경계에서 비키게 하는데(분석은 곧바로
 * 다시 잇는다), 무제한 착수가 비키면 「지금 두기」 없이 수를 둬 버린다 — 질의 하나가 대국의 수를
 * 바꾸면 안 된다. 그 사이에 바뀐 판은 엔진이 손을 놓는 순간 다시 묻는다.
 */
const REFRESH_DELAY_MS = 150;

/** 보드 화면이 한 번 건다 — 판 · DB · 엔진 상태를 보고 지금 국면을 다시 묻는다. */
export function useBoardDbSync(): void {
  const on = useDbStore((s) => s.status === "on");
  const stones = useBoardStore((s) => s.render.stones);
  const thinking = useGameStore((s) => s.thinking);
  const owned = useEngineStore((s) => s.owner !== null);
  const idle = useEngineStore((s) => s.status === "ready");
  useEffect(() => {
    if (!on || thinking || owned) return;
    const t = setTimeout(() => {
      // 기다리는 사이에 엔진이 대국의 수를 받았을 수 있다(양쪽 컴퓨터) — 그때는 건너뛴다.
      if (useGameStore.getState().thinking || useEngineStore.getState().owner) return;
      void useDbStore.getState().refresh(useBoardStore.getState().render.stones);
    }, REFRESH_DELAY_MS);
    return () => clearTimeout(t);
  }, [on, stones, thinking, owned, idle]);
}

export interface BoardDb {
  snap: DbSnapshot;
  /** 자식 값으로 읽은 국면 값(`positionValue`) — 읽을 수 없으면 null. */
  value: DbPositionValue | null;
}

/**
 * 지금 판의 DB 모습 — DB 가 붙어 있고 마지막으로 읽은 국면이 **지금 판과 같을 때만**. 무르거나
 * 새로 둔 직후, 새 답이 오기 전에는 앞 국면의 칩 · 값을 그리지 않는다(엔진 분석과 같은 규칙).
 */
export function useBoardDb(): BoardDb | null {
  const on = useDbStore((s) => s.status === "on");
  const view = useDbStore((s) => s.view);
  const stones = useBoardStore((s) => s.render.stones);
  const size = useBoardStore((s) => s.render.size);
  return useMemo(() => {
    if (!on || !view || positionKey(view.moves, size) !== positionKey(stones, size)) return null;
    const n = stones.length;
    return {
      snap: view.snapshot,
      value: positionValue(view.snapshot, n % 2 === 0, size * size - n),
    };
  }, [on, view, stones, size]);
}
