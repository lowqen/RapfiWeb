import type { Move } from "../model/move";
import { moveKey } from "../model/move";
import { boardGeometry, starPoints, type BoardGeometry } from "./board-geometry";
import type { BoardSkin } from "./board-skin";
import { DEFAULT_PALETTE, textForTag, type TagKind, type TagPalette, type TagText } from "./ladder";
import { FONT_STACKS } from "../design/tokens";

/**
 * 판 위 글자의 글꼴 — 캔버스의 `ctx.font` 는 CSS 변수(`var(--font-sans)`)를 풀지 못해 예전에는 모든
 * 판 글자(좌표 · 돌 번호 · 값)가 조용히 `10px sans-serif` 로 떨어졌다. 글꼴 이름을 그대로 넣는다.
 */
const FONT = FONT_STACKS.sans;

/**
 * 한 프레임에 필요한 전부 — 순수 데이터. `BoardRender` 의 이식본이다.
 *
 * 뷰모델이 이것을 만들고 렌더러가 받는다. 스킨은 여기 들어오지 않는다(테마는
 * 뷰모델이 모르는 것이라, `drawBoard` 에 따로 넘긴다) — 앱이 같은 이유로
 * 같은 분리를 했고, 그 덕에 같은 국면을 화면에는 밝게, 내보내기에는 어둡게
 * 그릴 수 있다.
 */
/**
 * 빈 점에 그리는 모양 표식 — 사람이 적은 값(흑 5수 유불리 등)용. 엔진 값 칩(`tags`)과
 * 일부러 다른 그림이다: 색 사다리가 아니라 **모양**이 뜻을 나른다.
 */
export interface BoardMark {
  shape: "circle" | "pentagon" | "square" | "triangle" | "cross";
  fill: string;
  /** 안쪽 점의 색, 없으면 `null`. */
  dot: string | null;
}

export interface BoardRender {
  size: number;
  /** 둔 순서. 짝수 인덱스가 흑. */
  stones: readonly Move[];
  lastMove: Move | null;
  forbidden: readonly Move[];
  /** 현재 국면에서 이어지는 PV 미리보기. */
  ghosts: readonly Move[];
  bestMark: Move | null;
  tags: ReadonlyMap<number, { label: string; kind: TagKind; winRatePct?: number }>;
  candidates: ReadonlyMap<number, "live" | "done">;
  loseCells: ReadonlySet<number>;
  blocked: ReadonlySet<number>;
  /** 모양 표식(`BoardMark`) — `moveKey` → 표식. 돌이 놓인 점에는 그리지 않는다. */
  marks: ReadonlyMap<number, BoardMark>;
  /** settings.txt 14행. */
  showNumbers: boolean;
  palette: TagPalette;
  /** 데스크톱 «Board Text Font»(44행)의 크기 부분. */
  textScale: number;
}

export const emptyRender = (size = 15): BoardRender => ({
  size,
  stones: [],
  lastMove: null,
  forbidden: [],
  ghosts: [],
  bestMark: null,
  tags: new Map(),
  candidates: new Map(),
  loseCells: new Set(),
  blocked: new Set(),
  marks: new Map(),
  showNumbers: true,
  palette: DEFAULT_PALETTE,
  textScale: 1,
});

// ── 레이어 1: 국면과 무관한 것 ────────────────────────────────────────
//
// 나무·격자·좌표·화점. 크기나 테마가 바뀔 때만 다시 그린다. 탐색이 도는 동안
// 초당 수십 번 다시 그려지는 것은 레이어 2뿐이고, 이 레이어는 그대로 아래 남는다.

/**
 * 판 자체: 둥근 모서리와 대각선으로 지는 빛.
 * 화면 끝까지 닿는 납작한 색 사각형과 draw call 수는 같지만, 하나만 «물건»으로 보인다.
 */
function drawWood(ctx: CanvasRenderingContext2D, g: BoardGeometry, skin: BoardSkin): void {
  const grad = ctx.createLinearGradient(0, 0, g.side, g.side);
  grad.addColorStop(0, skin.wood);
  grad.addColorStop(1, skin.woodEdge);
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, g.side, g.side, g.step * 0.5);
  ctx.fill();
}

/**
 * 좌표. 격자와 **다른** 색인 것이 중요하다 — 격자의 일부가 아니라 격자가 무엇인지
 * 말하는 라벨이라, 격자 색으로 칠하면 선이 두 줄 더 있는 것처럼 보인다.
 */
function drawLabels(ctx: CanvasRenderingContext2D, g: BoardGeometry, skin: BoardSkin): void {
  ctx.fillStyle = skin.label;
  ctx.font = `${g.step * 0.3}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < g.n; i++) {
    ctx.fillText(String.fromCharCode(65 + i), g.cx(i), g.origin - g.step * 0.4);
    ctx.fillText(String(g.n - i), g.origin * 0.42, g.cy(i));
  }
}

/** 레이어 1 전체. `(geometry, skin) => void` — 국면을 보지 않는다. */
export function drawStatic(ctx: CanvasRenderingContext2D, g: BoardGeometry, skin: BoardSkin): void {
  ctx.clearRect(0, 0, g.side, g.side);
  drawWood(ctx, g, skin);

  // 격자 — 바깥 네 줄이 두껍다. 진짜 판이 잘려 있는 방식이고, 테두리를 그리지 않고도
  // 두는 자리가 어디서 끝나는지 눈에 말해 준다.
  ctx.strokeStyle = skin.line;
  for (let i = 0; i < g.n; i++) {
    const edge = i === 0 || i === g.n - 1;
    ctx.lineWidth = edge ? g.hair * 1.8 : g.hair;
    line(ctx, g.cx(0), g.cy(i), g.cx(g.n - 1), g.cy(i));
    line(ctx, g.cx(i), g.cy(0), g.cx(i), g.cy(g.n - 1));
  }

  ctx.fillStyle = skin.line;
  for (const s of starPoints(g.n)) {
    circle(ctx, g.cx(s.x), g.cy(s.y), g.step * 0.11);
    ctx.fill();
  }

  drawLabels(ctx, g, skin);
}

// ── 레이어 2: 국면 ────────────────────────────────────────────────────

/**
 * 돌 하나.
 *
 * 채운 원과 돌을 가르는 것이 셋이고 어느 것도 draw call 하나 이상 들지 않는다:
 * **그림자**를 드리워 나무에 «칠해진» 것이 아니라 «놓인» 것이 되고, 얼굴이 왼쪽
 * 위에서 빛을 받는 **방사 그라디언트**이며(유리나 돌이 실제로 그렇다),
 * 테두리가 검정 외곽선이 아니라 **자기 색을 어둡게 한 것**이다 — 225개가 되면
 * 검정 외곽선은 그을음 격자가 된다. 하이라이트는 일부러 약하다: 이 도형이 이백 번
 * 반복되는데 그보다 반들거리면 보드가 장신구가 된다.
 */
function drawStone(
  ctx: CanvasRenderingContext2D,
  g: BoardGeometry,
  cx: number,
  cy: number,
  black: boolean,
  number: string,
  alpha: number,
  skin: BoardSkin,
): void {
  const r = g.radius;
  ctx.save();
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = skin.stoneShadow;
  circle(ctx, cx + r * 0.05, cy + r * 0.09, r * 1.03);
  ctx.fill();

  ctx.globalAlpha = alpha;
  const grad = ctx.createRadialGradient(
    cx - r * 0.34,
    cy - r * 0.38,
    0,
    cx - r * 0.34,
    cy - r * 0.38,
    r * 1.7,
  );
  grad.addColorStop(0, black ? skin.blackHigh : skin.whiteHigh);
  grad.addColorStop(1, black ? skin.blackLow : skin.whiteLow);
  ctx.fillStyle = grad;
  circle(ctx, cx, cy, r);
  ctx.fill();

  ctx.globalAlpha = alpha * 0.8;
  ctx.strokeStyle = black ? skin.blackRim : skin.whiteRim;
  ctx.lineWidth = g.hair;
  circle(ctx, cx, cy, r);
  ctx.stroke();

  if (number) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = black ? skin.whiteHigh : skin.blackLow;
    ctx.font = `600 ${r * 0.88}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(number, cx, cy);
  }
  ctx.restore();
}

/**
 * 한 교점의 값 — **글자만**(UI 개편 2차). 예전의 동그라미 칩을 걷어 판 위에 승률 · DB 값 · 정석 기호를
 * 글자로만 쓴다(데스크톱 Yixin 처럼). 색은 `textForTag`(색상이 값), 어두운 외곽선이 나무 위에서 글자를
 * 띄운다. 글자는 한 칸 폭을 넘지 않게 줄인다 — 옆 칸 글자와 붙지 않게.
 */
function drawTag(
  ctx: CanvasRenderingContext2D,
  g: BoardGeometry,
  cx: number,
  cy: number,
  text: string,
  colors: TagText,
  textScale: number,
): void {
  const scale = Math.min(1.4, Math.max(0.6, textScale));
  let size = g.radius * (text.length >= 4 ? 0.8 : text.length === 3 ? 0.9 : 1.05) * scale;
  ctx.font = `800 ${size}px ${FONT}`;
  // 외곽선까지 한 칸의 84% 안 — 옆 칸 글자와 틈이 남는다(«87%83%» 처럼 붙지 않게).
  const room = g.step * 0.84;
  const width = ctx.measureText(text).width * 1.2;
  if (width > room) {
    size *= room / width;
    ctx.font = `800 ${size}px ${FONT}`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, size * 0.2);
  ctx.strokeStyle = colors.outline;
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = colors.ink;
  ctx.fillText(text, cx, cy);
}

/** 레이어 2 전체. `(render, geometry, skin) => void` — 순수 함수다. */
export function drawDynamic(
  ctx: CanvasRenderingContext2D,
  render: BoardRender,
  g: BoardGeometry,
  skin: BoardSkin,
): void {
  ctx.clearRect(0, 0, g.side, g.side);
  const { radius: r, hair } = g;
  const cx = (m: Move) => g.cx(m.x);
  const cy = (m: Move) => g.cy(m.y);

  // 차단점: 엔진이 아예 고려하지 않는 곳이라 금수 표시보다 무겁게, 모든 것 아래에.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = skin.blocked;
  for (const key of render.blocked) {
    const m = fromKey(key, render.size);
    circle(ctx, cx(m), cy(m), r * 0.85);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = skin.blocked;
  ctx.lineWidth = hair * 2.4;
  for (const key of render.blocked) {
    const m = fromKey(key, render.size);
    cross(ctx, cx(m), cy(m), r * 0.85);
  }

  ctx.strokeStyle = skin.forbid;
  ctx.lineWidth = hair * 2;
  for (const m of render.forbidden) cross(ctx, cx(m), cy(m), r * 0.7);

  // 실시간 후보(POS = 살아 있음, DONE = 정해짐) — 돌 아래에 그린다.
  for (const [key, state] of render.candidates) {
    const m = fromKey(key, render.size);
    const live = state === "live";
    ctx.save();
    ctx.globalAlpha = live ? 0.75 : 0.45;
    ctx.fillStyle = live ? skin.candidate : skin.line;
    circle(ctx, cx(m), cy(m), r * (live ? 0.3 : 0.2));
    ctx.fill();
    ctx.restore();
  }

  ctx.strokeStyle = skin.forbid;
  ctx.lineWidth = hair * 1.7;
  for (const key of render.loseCells) {
    const m = fromKey(key, render.size);
    line(ctx, cx(m) - r * 0.5, cy(m), cx(m) + r * 0.5, cy(m));
  }

  // 빈 점의 분석 태그와 모양 표식. 돌이 놓인 점에는 그리지 않는다. 한 점에 둘 다 있으면(오프닝 탐색의
  // «판 수 칩» + «흑 5수 유불리») 칩을 가운데, 표식을 오른쪽 위 모서리에 작게 — 예전에는 칩이 표식을
  // 덮어 유불리가 판에서 사라졌다.
  const occupied = new Set(render.stones.map((m) => moveKey(m, render.size)));
  const corner: [Move, BoardMark][] = [];
  for (const [key, mark] of render.marks) {
    if (occupied.has(key)) continue;
    const m = fromKey(key, render.size);
    if (render.tags.get(key)?.label) corner.push([m, mark]);
    else drawMark(ctx, cx(m), cy(m), r * 0.62, mark, skin.line, hair);
  }
  render.stones.forEach((m, i) => {
    drawStone(ctx, g, cx(m), cy(m), i % 2 === 0, render.showNumbers ? String(i + 1) : "", 1, skin);
  });

  // 방금 둔 돌: 가장자리를 감싸는 얇은 링. 예전의 넓은 안쪽 링은 값 칩과 반지름도
  // 굵기도 같아서, 복잡한 보드에서 최신 수와 63% 가 똑같아 보였다.
  if (render.lastMove) {
    const m = render.lastMove;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = skin.stoneShadow;
    ctx.lineWidth = hair * 3;
    circle(ctx, cx(m), cy(m), r * 0.99);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = skin.lastMove;
    ctx.lineWidth = hair * 1.8;
    circle(ctx, cx(m), cy(m), r * 0.99);
    ctx.stroke();
  }

  // PV 고스트: 현재 국면에서 번호와 색을 이어 간다.
  const start = render.stones.length;
  render.ghosts.forEach((m, i) => {
    drawStone(
      ctx,
      g,
      cx(m),
      cy(m),
      (start + i) % 2 === 0,
      render.showNumbers ? String(i + 1) : "",
      0.4,
      skin,
    );
  });

  // 값 글자는 고스트 **위**에 — 칩을 걷고 글자만 남긴 뒤로는 반투명 고스트가 글자를 덮어 흐려졌다
  // (최선수 칸에는 늘 PV 의 첫 고스트가 앉는다). 외곽선이 있어 고스트 위에서도 읽힌다.
  for (const [key, tag] of render.tags) {
    if (!tag.label || occupied.has(key)) continue;
    const m = fromKey(key, render.size);
    drawTag(
      ctx,
      g,
      cx(m),
      cy(m),
      tag.label,
      textForTag(render.palette, tag.kind, tag.winRatePct),
      render.textScale,
    );
  }
  for (const [m, mark] of corner) {
    drawMark(ctx, cx(m) + r * 0.62, cy(m) - r * 0.62, r * 0.34, mark, skin.line, hair);
  }

  // 최선수: 어두운 후광 위의 밝은 링. 맨 나무 위에 앉는 만큼 어두운 값 칩 위에도
  // 앉으므로 둘 다에서 살아남아야 한다.
  if (render.bestMark) {
    const m = render.bestMark;
    ctx.strokeStyle = skin.bestHalo;
    ctx.lineWidth = hair * 3.8;
    circle(ctx, cx(m), cy(m), r * 0.87);
    ctx.stroke();
    ctx.strokeStyle = skin.best;
    ctx.lineWidth = hair * 2.1;
    circle(ctx, cx(m), cy(m), r * 0.87);
    ctx.stroke();
  }
}

// ── 작은 도구들 ──────────────────────────────────────────────────────

const fromKey = (key: number, size: number): Move => ({ x: key % size, y: Math.floor(key / size) });

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function cross(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  line(ctx, cx - r, cy - r, cx + r, cy + r);
  line(ctx, cx - r, cy + r, cx + r, cy - r);
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 두 레이어를 한 번에 — PNG 내보내기와 시험이 쓴다. */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  render: BoardRender,
  side: number,
  skin: BoardSkin,
): void {
  const g = boardGeometry(side, render.size);
  drawStatic(ctx, g, skin);
  drawDynamic(ctx, render, g, skin);
}

/**
 * 모양 표식 하나 — 앱 `MiniBoard.drawGradeMark` 의 다섯 모양. `GradeBadge`(SVG)와 같은
 * 기하라 판 위의 표식과 목록의 표식이 같은 그림이다.
 */
function drawMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  mark: BoardMark,
  rim: string,
  hair: number,
): void {
  ctx.save();
  ctx.lineWidth = hair * 1.2;
  ctx.strokeStyle = rim;
  ctx.fillStyle = mark.fill;
  const poly = (n: number, rr: number, dy = 0) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = ((-90 + (360 / n) * i) * Math.PI) / 180;
      const px = x + rr * Math.cos(a);
      const py = y + dy + rr * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  switch (mark.shape) {
    case "circle":
      circle(ctx, x, y, r * 0.9);
      ctx.fill();
      ctx.stroke();
      break;
    case "pentagon":
      poly(5, r);
      break;
    case "square":
      ctx.beginPath();
      ctx.rect(x - r * 0.78, y - r * 0.78, r * 1.56, r * 1.56);
      ctx.fill();
      ctx.stroke();
      break;
    case "triangle":
      poly(3, r * 1.05, r * 0.12);
      break;
    case "cross":
      ctx.strokeStyle = mark.fill;
      ctx.lineWidth = r * 0.36;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - r * 0.7, y - r * 0.7);
      ctx.lineTo(x + r * 0.7, y + r * 0.7);
      ctx.moveTo(x + r * 0.7, y - r * 0.7);
      ctx.lineTo(x - r * 0.7, y + r * 0.7);
      ctx.stroke();
      break;
  }
  if (mark.dot) {
    ctx.fillStyle = mark.dot;
    circle(ctx, x, y, r * 0.25);
    ctx.fill();
  }
  ctx.restore();
}
