import { DEFAULT_SIZE, type Move } from "../model/move";
import { nameOf } from "../opening/opening26";
import { t } from "../../i18n/i18n";
import {
  MO_GUI_NODES,
  MO_MAX_STONES,
  MoveOrderSet,
  cellName,
  formatCount,
  opening26Of,
  rule2Cells,
  xform,
  xformName,
  type Completion,
  type MoveOrderChild,
  type MoveOrderGhost,
} from "./move-order";

/**
 * 수순 탐색기의 한 판 — `MoveOrderSet` 하나를 들고 화면이 묻는 것(만들기 · 파고들기 · 되짚기 ·
 * 처음 · 완성)에 **스냅샷**으로 답한다. 워커(`features/research/sequence`)가 이것을 들고 돌고,
 * 시험과 워커가 없는 곳은 같은 것을 그 자리에서 돌린다 — 두 길이 같은 코드다.
 *
 * 문구(머리줄 · 이유 · 주형)는 앱 `MoveOrderViewModel` 의 것을 순수 함수로 옮겼다.
 */

/** 데스크톱의 체크 상자 넷. */
export interface MoveOrderRules {
  /** 1~4수의 천원 / 3×3 / 5×5 / 7×7. */
  openingRule: boolean;
  /** 마지막 수 전의 오목 금지. */
  noFive: boolean;
  /** 2수를 H9 / I9 로(오프닝 규칙의 하위 규칙). */
  move2Fix: boolean;
  /** 회전 · 반전 배치를 합친다(환원). */
  symmetry: boolean;
}

export const DEFAULT_RULES: MoveOrderRules = {
  openingRule: true,
  noFive: true,
  move2Fix: true,
  symmetry: true,
};

/** 화면이 그리는 전부 — 구조화 복제로 워커 경계를 넘는다(`bigint` 포함). */
export interface MoveOrderView {
  readonly total: number;
  readonly overflow: boolean;
  readonly variantCount: number;
  readonly blackCount: number;
  readonly whiteCount: number;
  readonly prefix: readonly number[];
  readonly children: readonly MoveOrderChild[];
  readonly ghosts: readonly MoveOrderGhost[];
  /** 지금 길을 지나는 수순 수(갈래 몫의 분모). */
  readonly branch: number;
  readonly aliveCount: number;
  readonly soleAlive: number | null;
  readonly identityAlive: boolean;
}

export type BuildResult =
  { kind: "empty" } | { kind: "tooBig" } | { kind: "ok"; view: MoveOrderView };

export class MoveOrderSession {
  private set: MoveOrderSet | null = null;

  build(cells: readonly number[], size: number, rules: MoveOrderRules): BuildResult {
    this.set = null;
    if (cells.length === 0) return { kind: "empty" };
    const s = MoveOrderSet.create(cells, size, {
      openingRule: rules.openingRule,
      noFive: rules.noFive,
      move2Fix: rules.openingRule && rules.move2Fix,
      withSymmetry: rules.symmetry,
      maxNodes: MO_GUI_NODES,
    });
    if (!s) return { kind: "tooBig" };
    this.set = s;
    return { kind: "ok", view: this.view() };
  }

  drill(cell: number): MoveOrderView | null {
    const s = this.set;
    if (!s || s.total <= 0) return null;
    return s.drill(cell) ? this.view() : null;
  }

  back(): MoveOrderView | null {
    return this.set?.back() ? this.view() : null;
  }

  root(): MoveOrderView | null {
    if (!this.set) return null;
    this.set.root();
    return this.view();
  }

  complete(): Completion | null {
    const s = this.set;
    return s && s.total > 0 ? s.complete() : null;
  }

  private view(): MoveOrderView {
    const s = this.set!;
    const counted = s.total > 0;
    return {
      total: s.total,
      overflow: s.overflow,
      variantCount: s.variantCount,
      blackCount: s.blackCount,
      whiteCount: s.whiteCount,
      prefix: [...s.prefix],
      children: counted ? s.children() : [],
      ghosts: s.ghosts(),
      branch: counted ? s.branchCount() : 0,
      aliveCount: s.aliveCount(),
      soleAlive: s.soleAliveTransform(),
      identityAlive: s.identityAlive(),
    };
  }
}

// ── 문구 ─────────────────────────────────────────────────────────────

export function headline(v: MoveOrderView): string {
  const stones = t("흑 {b} · 백 {w}", { b: v.blackCount, w: v.whiteCount });
  if (v.overflow) return `${stones} · ${t("경우의 수가 너무 많아 정확한 집계 생략")}`;
  if (v.total <= 0) return `${stones} · ${t("이 규칙에서는 만들 수 없는 배치")}`;
  if (v.variantCount > 1)
    return `${stones} · ${t("수순 {n}가지 (배치 {k}종)", { n: formatCount(v.total), k: v.variantCount })}`;
  return `${stones} · ${t("수순 {n}가지", { n: formatCount(v.total) })}`;
}

export const tooBig = (): string =>
  t("국면이 너무 큽니다. 색깔당 최대 {n}개까지.", { n: MO_MAX_STONES });

/** 만들 수 없을 때 **어느 규칙이 물었는지**가 흥미로운 부분이다(main.c:6074-6110). */
export function note(
  v: MoveOrderView,
  line: readonly Move[],
  size: number,
  rules: MoveOrderRules,
): string {
  if (v.total > 0 && rules.symmetry && v.variantCount > 1) {
    return t("(회전·반전 {k}종을 같은 모양으로 합산)", { k: v.variantCount });
  }
  if (v.total > 0 || v.overflow || !rules.openingRule) return "";
  if (size % 2 === 0) return t("(오프닝 규칙은 홀수 판에서만 적용됩니다)");
  const ctr = Math.floor(size / 2);
  const tengen = ctr * size + ctr;
  if (!line.some((m) => m.y * size + m.x === tengen)) {
    return t("(천원에 흑돌이 없습니다: 1수는 반드시 중앙이어야 합니다)");
  }
  const r2 = rule2Cells(size);
  if (rules.move2Fix && r2) {
    const hasR2 = [0, 1, 2, 3, 4, 5, 6, 7].some((t) =>
      line.some((m) => {
        const c = xform(t, size, m.y * size + m.x);
        return c === r2[0] || c === r2[1];
      }),
    );
    if (!hasR2) {
      return rules.symmetry
        ? t("(어떤 배치에서도 2수가 H9/I9에 오지 않습니다)")
        : t("(H9/I9에 백돌이 없습니다. 환원을 켜 보세요)");
    }
  }
  return t("(3×3 / 5×5 / 7×7 상자를 만족하는 수순이 없습니다)");
}

/**
 * 주형은 **파고든** 수순을 따른다(3수 이상 파고들었으면) — 같은 돌을 지나는 다른 수순이 다른
 * 주형을 이루고, 그것을 보는 곳이 여기다(main.c:5889-5917).
 */
export function openingLabel(
  v: MoveOrderView | null,
  line: readonly Move[],
  size: number,
): string | null {
  let src: readonly number[];
  if (v && v.prefix.length >= 3) src = v.prefix;
  else if (line.length >= 3) src = line.slice(0, 3).map((m) => m.y * size + m.x);
  else return null;
  const id = opening26Of(src[0]!, src[1]!, src[2]!, size);
  if (id === null) return null;
  const tag = id < 13 ? `D${id + 1}` : `I${id - 12}`;
  return t("주형: {name} ({tag})", { name: nameOf(id), tag });
}

export const breadcrumb = (v: MoveOrderView, size = DEFAULT_SIZE): string =>
  v.prefix.length === 0
    ? t("처음부터")
    : t("수순: {line}", { line: v.prefix.map((c) => cellName(c, size)).join(" ") });

export function orientation(v: MoveOrderView, rules: MoveOrderRules): string | null {
  if (!rules.symmetry || v.variantCount <= 1) return null;
  return v.aliveCount === 1
    ? xformName(v.soleAlive ?? 0)
    : t("배치 {k}종 진행 중", { k: v.aliveCount });
}

/**
 * 실제 대국의 다음 수 — 파고든 길이 원래 방향의 실제 수순의 머리일 때만(main.c:5941-5949).
 * 아니면 -1.
 */
export function actualNext(v: MoveOrderView, line: readonly Move[], size: number): number {
  const p = v.prefix;
  if (!v.identityAlive || p.length >= line.length) return -1;
  for (let i = 0; i < p.length; i++) if (line[i]!.y * size + line[i]!.x !== p[i]) return -1;
  const m = line[p.length]!;
  return m.y * size + m.x;
}
