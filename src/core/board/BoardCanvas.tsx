import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { label, sameMove, type Move } from "../model/move";
import { t } from "../../i18n/i18n";
import { boardGeometry } from "./board-geometry";
import { drawStatic, drawDynamic, type BoardRender } from "./board-renderer";
import { readBoardSkin, type BoardSkin } from "./board-skin";
import {
  IDENTITY,
  LONG_PRESS_MS,
  clampTransform,
  isNearIntersection,
  moveAt,
  zoomAt,
  type ViewTransform,
} from "./board-interaction";

/**
 * 보드 하나. **캔버스 두 장**을 겹친다.
 *
 *   레이어 1 (아래)  나무·격자·좌표·화점 — 크기나 테마가 바뀔 때만 다시 그린다
 *   레이어 2 (위)    돌·링·후보·차단점·값 칩 — 국면이 바뀔 때마다 다시 그린다
 *
 * 나누는 이유는 탐색 중이다. 엔진이 도는 동안 레이어 2는 초당 여러 번 다시
 * 그려지는데, 그때마다 격자 15+15 줄과 좌표 30개를 같이 그릴 이유가 없다.
 * 정적 레이어는 그대로 아래 남아 있으면 된다.
 */
export interface BoardCanvasProps {
  render: BoardRender;
  onTap?: (m: Move) => void;
  onLongPress?: (m: Move) => void;
  /** 확대를 허용할 것인가. 작은 미리보기 보드에서는 끈다. */
  zoomable?: boolean;
  /**
   * 키보드로 둘 수 있는가(W10) — 보드가 Tab 으로 초점을 받고, 방향키로 커서를 옮겨 Enter · Space 로
   * `onTap` 한다. 누르면 두는 보드에만 켠다(보기 전용 보드에 초점이 멈추면 Tab 이 헛걸음한다).
   */
  keyboard?: boolean;
  className?: string;
}

export function BoardCanvas({
  render,
  onTap,
  onLongPress,
  zoomable = true,
  keyboard = false,
  className,
}: BoardCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const dynamicRef = useRef<HTMLCanvasElement>(null);

  const [side, setSide] = useState(0);
  const [skin, setSkin] = useState<BoardSkin | null>(null);
  const [view, setView] = useState<ViewTransform>(IDENTITY);

  const geometry = useMemo(
    () => (side > 0 ? boardGeometry(side, render.size) : null),
    [side, render.size],
  );

  // ── 크기: 컨테이너를 따라가고, 그릴 때만 DPR 을 곱한다 ───────────────
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) setSide(Math.floor(Math.min(box.width, box.height)));
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // ── 스킨: 테마가 바뀌면 다시 읽는다 ─────────────────────────────────
  //
  // 색은 CSS 변수 한 군데에만 있고 Canvas 는 그것을 읽는다. `data-theme` 이
  // 바뀌는 순간(그리고 시스템 테마가 바뀌는 순간) 다시 읽어야 보드가 따라온다.
  useEffect(() => {
    const root = document.documentElement;
    const reread = () => setSkin(readBoardSkin(root));
    reread();
    const observer = new MutationObserver(reread);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", reread);
    return () => {
      observer.disconnect();
      mq.removeEventListener("change", reread);
    };
  }, []);

  const setupCanvas = useCallback((canvas: HTMLCanvasElement | null, px: number) => {
    if (!canvas || px <= 0) return null;
    const dpr = window.devicePixelRatio || 1;
    // 실제 픽셀은 DPR 배, CSS 크기는 그대로. 그리기 좌표는 CSS 픽셀로 유지된다.
    const want = Math.round(px * dpr);
    if (canvas.width !== want || canvas.height !== want) {
      canvas.width = want;
      canvas.height = want;
    }
    canvas.style.width = `${px}px`;
    canvas.style.height = `${px}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }, []);

  useEffect(() => {
    if (!geometry || !skin) return;
    const ctx = setupCanvas(staticRef.current, side);
    if (ctx) drawStatic(ctx, geometry, skin);
  }, [geometry, skin, side, setupCanvas]);

  useEffect(() => {
    if (!geometry || !skin) return;
    const ctx = setupCanvas(dynamicRef.current, side);
    if (ctx) drawDynamic(ctx, render, geometry, skin);
  }, [geometry, skin, side, render, setupCanvas]);

  // ── 입력 ────────────────────────────────────────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    downAt: number;
    startX: number;
    startY: number;
    moved: boolean;
    longPressTimer: number | null;
    pinchDistance: number | null;
    panned: boolean;
  } | null>(null);

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const host = hostRef.current;
    if (!host) return { x: 0, y: 0 };
    const box = host.getBoundingClientRect();
    // 컨테이너가 보드보다 클 수 있다(가운데 정렬) — 보드 원점 기준으로 옮긴다.
    return {
      x: e.clientX - box.left - (box.width - side) / 2,
      y: e.clientY - box.top - (box.height - side) / 2,
    };
  };

  const cancelLongPress = () => {
    const g = gesture.current;
    if (g?.longPressTimer != null) {
      window.clearTimeout(g.longPressTimer);
      g.longPressTimer = null;
    }
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = localPoint(e);

    if (pointers.current.size === 2) {
      cancelLongPress();
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        ...(gesture.current ?? {
          downAt: 0,
          startX: 0,
          startY: 0,
          moved: true,
          longPressTimer: null,
          panned: false,
        }),
        moved: true,
        pinchDistance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
      };
      return;
    }

    gesture.current = {
      downAt: performance.now(),
      startX: p.x,
      startY: p.y,
      moved: false,
      panned: false,
      pinchDistance: null,
      longPressTimer: onLongPress
        ? window.setTimeout(() => {
            const g = gesture.current;
            if (!g || g.moved) return;
            g.longPressTimer = null;
            g.moved = true; // 롱프레스가 났으면 탭은 나지 않는다
            onLongPress(moveAt(p.x, p.y, side, render.size, view));
          }, LONG_PRESS_MS)
        : null,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;

    // 두 손가락 = 확대. 배율만 다루고 이동은 clampTransform 이 정리한다.
    if (pointers.current.size === 2 && g.pinchDistance != null && zoomable) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (d > 0 && g.pinchDistance > 0) {
        const mid = localPoint({
          clientX: (a!.x + b!.x) / 2,
          clientY: (a!.y + b!.y) / 2,
        });
        setView((v) => zoomAt(v, side, d / g.pinchDistance!, mid.x, mid.y));
      }
      g.pinchDistance = d;
      return;
    }

    const p = localPoint(e);
    const dx = p.x - g.startX;
    const dy = p.y - g.startY;
    if (!g.moved && Math.hypot(dx, dy) > 6) {
      g.moved = true;
      cancelLongPress();
    }
    // 드래그로 보드를 미는 것은 **확대 상태에서만**. 배율 1에서 미끄러지면 사고다.
    if (g.moved && view.scale > 1 && zoomable) {
      g.panned = true;
      g.startX = p.x;
      g.startY = p.y;
      setView((v) => clampTransform({ ...v, panX: v.panX + dx, panY: v.panY + dy }, side));
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    cancelLongPress();
    if (!g) return;
    if (pointers.current.size > 0) return; // 핀치 중 한 손가락만 뗀 것

    const p = localPoint(e);
    const tapped = !g.moved && !g.panned;
    gesture.current = null;
    if (!tapped || !onTap) return;
    // 교점에서 너무 먼 클릭은 무시한다 — 여백을 눌렀다고 A15 에 두면 안 된다.
    if (!isNearIntersection(p.x, p.y, side, render.size, view)) return;
    onTap(moveAt(p.x, p.y, side, render.size, view));
  };

  // ── 키보드(W10) ─────────────────────────────────────────────────────
  // 커서는 초점을 받을 때 마지막 수(없으면 천원)에서 시작한다. 방향키는 판 안에서 멈춘다.
  const [cursor, setCursor] = useState<Move | null>(null);
  const [focused, setFocused] = useState(false);
  const centre = (): Move => ({ x: render.size >> 1, y: render.size >> 1 });
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!keyboard || e.altKey || e.ctrlKey || e.metaKey) return;
    const cur = cursor ?? render.stones.at(-1) ?? centre();
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = step[e.key];
    if (d) {
      const n = render.size - 1;
      setCursor({
        x: Math.min(n, Math.max(0, cur.x + d[0])),
        y: Math.min(n, Math.max(0, cur.y + d[1])),
      });
    } else if (e.key === "Enter" || e.key === " ") {
      onTap?.(cur);
    } else return;
    // 보드 위의 방향키는 커서의 것이다 — 기보 넘기기(MoveTransport)는 `defaultPrevented` 를 보고 비켜선다.
    e.preventDefault();
  };
  const stoneAt = (m: Move) => render.stones.findIndex((s) => sameMove(s, m));
  const cursorText = (m: Move) => {
    const i = stoneAt(m);
    const what = i < 0 ? t("빈 칸") : i % 2 === 0 ? t("흑 돌") : t("백 돌");
    return `${label(m, render.size)} ${what}`;
  };
  const shownCursor = keyboard && focused ? (cursor ?? render.stones.at(-1) ?? centre()) : null;

  const onWheel = (e: ReactWheelEvent) => {
    if (!zoomable) return;
    const p = localPoint(e);
    setView((v) => zoomAt(v, side, e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y));
  };

  // 확대 중에는 브라우저의 기본 제스처(스크롤·페이지 확대)를 우리가 가져간다.
  const touchAction = zoomable ? "none" : "auto";

  return (
    <div
      ref={hostRef}
      className={className ? `board ${className}` : "board"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{ touchAction }}
      {...(keyboard && {
        tabIndex: 0,
        role: "application",
        "aria-roledescription": t("오목판"),
        "aria-label": t("오목판: 방향키로 칸을 고르고 Enter 로 둡니다"),
        onKeyDown,
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
      })}
    >
      <div
        className="board__view"
        style={{
          width: side,
          height: side,
          transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.scale})`,
        }}
      >
        <canvas ref={staticRef} className="board__layer" aria-hidden="true" />
        <canvas
          ref={dynamicRef}
          className="board__layer"
          role="img"
          aria-label={t("{size}×{size} 오목판, 돌 {n}개", {
            size: render.size,
            n: render.stones.length,
          })}
        />
        {shownCursor && geometry && (
          <span
            className="board__cursor"
            aria-hidden="true"
            style={{
              left: geometry.cx(shownCursor.x),
              top: geometry.cy(shownCursor.y),
              width: geometry.step,
              height: geometry.step,
            }}
          />
        )}
      </div>
      {keyboard && (
        <span className="sr-only" aria-live="polite">
          {shownCursor ? cursorText(shownCursor) : ""}
        </span>
      )}
      {view.scale > 1 && (
        <button
          type="button"
          className="board__reset"
          onClick={() => setView(IDENTITY)}
          title={t("확대 해제")}
        >
          {t("{n}× 해제", { n: view.scale.toFixed(1) })}
        </button>
      )}
    </div>
  );
}
