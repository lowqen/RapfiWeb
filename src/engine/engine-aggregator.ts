import { moveKey, type Move } from "../core/model/move";
import {
  EMPTY_STATS,
  type AnalysisSnapshot,
  type CellTag,
  type EngineResponse,
  type PvSnapshot,
  type SearchStats,
} from "./engine-types";

/**
 * 줄 단위 스트림을 보드가 그릴 수 있는 스냅샷으로 잇는다.
 * `SearchAggregator.kt` 의 이식본이고, 데스크톱 디스패처(main.c `iochannelout_watch`)의
 * 칸별 태그 장부까지 따라간다:
 *
 *  - `INFO PV <i>` … `INFO PV DONE` 한 블록이 PV 하나를 확정한다
 *  - DONE 에서 그 PV 의 BESTLINE 머리에 태그를 붙인다(외통이면 `W<n>`/`L<n>`, 아니면 `nn%`)
 *  - `INFO PV 0` 이 새 라운드를 연다. 두 라운드 전 것은 그때 지운다 —
 *    깊이는 자기 자신과 같을 수 있어 «이번 것»의 도장이 되지 못한다
 *  - `MESSAGE REALTIME …` 이 실시간 오버레이를 움직인다
 *
 * 데스크톱과 달리 **부분 스냅샷도 낸다**(깊이·평가·승률이 도착하는 대로). 그래야
 * 보드가 DONE 을 기다리지 않고 즉시 반응한다.
 */
export class SearchAggregator {
  private curIndex = 0;
  private curDepth = 0;
  private curMate: number | null = null;
  private curEval: number | null = null;
  private curWinRate: number | null = null;
  private curLine: readonly Move[] = [];

  private numPv = 1;
  private round = 0;

  /**
   * 진짜 `INFO PV` 블록을 한 번이라도 봤는가. 상세 모드에서는 두 출력 형식이 함께
   * 오는데, 사람이 읽는 줄은 첫 PV 만 나른다 — 이게 켜진 뒤로 `thinking` 은
   * 카운터만 보태고 PV 집합은 건드리지 않는다.
   */
  private sawInfoPv = false;
  private realtimeBest: Move | null = null;
  private realtimeLine: readonly Move[] = [];
  private stats: SearchStats = EMPTY_STATS;

  private readonly pvs = new Map<number, PvSnapshot>();
  private readonly tags = new Map<number, CellTag>();
  private readonly candidates = new Map<number, "live" | "done">();
  private readonly loseCells = new Set<number>();

  constructor(private readonly size: number) {}

  /** 새 탐색을 연다. 오버레이만 비우고 통계는 첫 줄이 덮는다. */
  reset(): void {
    this.pvs.clear();
    this.tags.clear();
    this.candidates.clear();
    this.loseCells.clear();
    this.realtimeBest = null;
    this.realtimeLine = [];
    this.stats = EMPTY_STATS;
    this.round = 0;
    this.sawInfoPv = false;
  }

  /** 응답 하나를 먹인다. 화면에 보일 것이 바뀌었으면 `true`. */
  consume(r: EngineResponse): boolean {
    switch (r.kind) {
      case "infoPvStart":
        this.sawInfoPv = true;
        if (r.index === 0) {
          this.round++;
          // 지지난 라운드가 남긴 것은 방금 끝난 라운드가 갱신하지 않았다는 뜻이다.
          for (const [k, pv] of this.pvs) if (pv.round < this.round - 1) this.pvs.delete(k);
          for (const [k, t] of this.tags) if (t.round < this.round - 1) this.tags.delete(k);
        }
        this.curIndex = r.index;
        this.curMate = null;
        this.curEval = null;
        this.curWinRate = null;
        this.curLine = [];
        return false;

      case "infoNumPv": {
        this.numPv = Math.max(1, r.count);
        let removed = false;
        for (const k of [...this.pvs.keys()]) {
          if (k >= this.numPv) {
            this.pvs.delete(k);
            removed = true;
          }
        }
        return removed;
      }

      case "infoDepth":
        this.curDepth = r.depth;
        this.stats = { ...this.stats, depth: r.depth };
        return true;

      case "infoEval":
        this.curMate = r.mate;
        this.curEval = r.cp;
        this.stats = { ...this.stats, mate: r.mate, evalCp: r.cp };
        return true;

      case "infoWinRate":
        this.curWinRate = r.winRate;
        this.stats = { ...this.stats, winRatePct: pct(r.winRate) };
        return true;

      case "infoBestline":
        this.curLine = r.line;
        return false;

      case "infoPvDone": {
        this.pvs.set(this.curIndex, {
          index: this.curIndex,
          depth: this.curDepth,
          winRate: this.curWinRate,
          mate: this.curMate,
          evalCp: this.curEval,
          line: this.curLine,
          round: this.round,
        });
        const head = this.curLine[0];
        if (head) this.tags.set(moveKey(head, this.size), this.tagFor());
        // 이 라운드의 마지막 PV — 이번에 안 쓰인 것은 낡았다.
        if (this.curIndex + 1 >= this.numPv) {
          for (const [k, t] of this.tags) if (t.round < this.round) this.tags.delete(k);
        }
        return true;
      }

      case "infoStat":
        this.stats = {
          ...this.stats,
          nodes: r.key === "NODE" || r.key === "NODES" ? r.value : this.stats.nodes,
          speed: r.key === "SPEED" ? r.value : this.stats.speed,
          timeMs: r.key === "TIME" ? r.value : this.stats.timeMs,
        };
        return true;

      case "thinking": {
        this.stats = {
          ...this.stats,
          depth: r.depth ?? this.stats.depth,
          selDepth: r.selDepth ?? this.stats.selDepth,
          evalCp: r.evalCp ?? this.stats.evalCp,
          mate: r.mate ?? this.stats.mate,
          nodes: r.nodes ?? this.stats.nodes,
          speed: r.speed ?? this.stats.speed,
          timeMs: r.timeMs ?? this.stats.timeMs,
        };
        // 상세 모드가 살아 있으면 PV 는 그쪽이 권위다.
        if (!this.sawInfoPv && r.line.length > 0) {
          this.pvs.set(0, {
            index: 0,
            depth: r.depth ?? 0,
            winRate: null,
            mate: r.mate,
            evalCp: r.evalCp,
            line: r.line,
            round: this.round,
          });
        }
        return true;
      }

      case "realtimeBest":
        this.realtimeBest = r.move;
        return true;
      case "realtimePos":
        this.candidates.set(moveKey(r.move, this.size), "live");
        return true;
      case "realtimeDone":
        this.candidates.set(moveKey(r.move, this.size), "done");
        return true;
      case "realtimeLose":
        this.loseCells.add(moveKey(r.move, this.size));
        return true;
      case "realtimePv":
        this.realtimeLine = r.line;
        return true;
      case "realtimeRefresh":
        this.candidates.clear();
        this.loseCells.clear();
        return true;

      default:
        return false;
    }
  }

  snapshot(): AnalysisSnapshot {
    const ordered = [...this.pvs.values()].sort((a, b) => a.index - b.index);
    const first = ordered[0];
    const bestLine = this.realtimeLine.length > 0 ? this.realtimeLine : (first?.line ?? []);
    return {
      stats: this.stats,
      pvs: ordered,
      tags: new Map(this.tags),
      candidates: new Map(this.candidates),
      loseCells: new Set(this.loseCells),
      bestMove: this.realtimeBest ?? bestLine[0] ?? null,
      bestLine,
    };
  }

  /**
   * 이 PV 머리에 붙일 라벨. 외통이면 `W<n>`/`L<n>`(사실), 아니면 `nn%`(숫자).
   * 보드에서 굵기가 그 둘을 가른다.
   */
  private tagFor(): CellTag {
    const mate = this.curMate;
    if (mate !== null && mate !== 0) {
      return mate > 0
        ? { label: `W${mate}`, kind: "win", round: this.round }
        : { label: `L${-mate}`, kind: "lose", round: this.round };
    }
    const p = pct(this.curWinRate ?? 0.5);
    return { label: `${p}%`, kind: "rate", winRatePct: p, round: this.round };
  }
}

/**
 * 엔진의 승률을 퍼센트 정수로. 엔진은 0..1 로도 0..100 으로도 보낼 수 있어
 * 둘 다 받는다 — 1 을 넘으면 이미 퍼센트라고 본다.
 */
function pct(winRate: number): number {
  const v = winRate > 1 ? winRate : winRate * 100;
  return Math.min(100, Math.max(0, Math.round(v)));
}
