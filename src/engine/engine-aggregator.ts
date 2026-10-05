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
  /** 이 탐색이 탐색 없는 즉답(좌표 한 줄뿐)으로 끝났는가 — `consume` 의 `bestMove`. */
  private instant = false;
  private realtimeBest: Move | null = null;
  private realtimeLine: readonly Move[] = [];
  private stats: SearchStats = EMPTY_STATS;

  /**
   * 조각을 넘나드는 깊이 바닥. 분석은 500ms 조각으로 도는데, 조각마다 엔진이
   * 반복 심화를 처음(깊이 2 안팎)부터 다시 연다 — 해시 덕에 금세 따라잡지만,
   * 그 사이에 얕은 PV·평가·후보가 화면을 덮으면 조각마다 보드가 **덜컥거린다**.
   * 한 세션 안에서는 이미 끝낸 깊이보다 얕은 결과를 따라잡을 때까지 보류한다.
   */
  private floor = 0;
  private shallow = false;

  /**
   * **노드·시간은 조각을 넘어 쌓는다.** 분석은 500ms 조각으로 돌고 조각마다 엔진에게는
   * 새 탐색이라, `TOTALNODES`·`TOTALTIME` 이 조각 머리에서 0 으로 돌아간다(캡처:
   * 앞 조각 끝 16118 · 618ms → 다음 조각 첫 줄 65 · 1ms). 그대로 그리면 노드와 시간이
   * 톱니처럼 오르내리고, 시간은 0.5초를 넘지 못한다. 끝난 조각의 몫은 `base` 에
   * 더하고, 도는 조각의 몫은 `slice` 에 두어 둘의 합을 그린다.
   */
  private baseNodes = 0;
  private baseTimeMs = 0;
  private sliceNodes = 0;
  private sliceTimeMs = 0;
  /** 이 탐색에서 카운터가 한 번이라도 왔는가 — 아직이면 화면은 「—」다. */
  private sawNodes = false;
  private sawTime = false;
  /** 엔진이 찍은 속도. 시간이 아직 0 일 때만 쓴다(그 뒤로는 누적 평균). */
  private engineSpeed: number | null = null;

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
    this.instant = false;
    this.floor = 0;
    this.shallow = false;
    this.baseNodes = 0;
    this.baseTimeMs = 0;
    this.sliceNodes = 0;
    this.sliceTimeMs = 0;
    this.sawNodes = false;
    this.sawTime = false;
    this.engineSpeed = null;
  }

  /**
   * 새 조각을 연다. 이미 끝낸 깊이까지 다시 올라올 동안은 화면을 건드리지 않는다.
   * 앞 조각의 노드·시간은 여기서 누적으로 넘긴다 — 엔진이 이제 0 부터 다시 센다.
   */
  beginSlice(): void {
    this.shallow = this.floor > 0;
    this.baseNodes += this.sliceNodes;
    this.baseTimeMs += this.sliceTimeMs;
    this.sliceNodes = 0;
    this.sliceTimeMs = 0;
  }

  /**
   * 도는 조각의 카운터를 올린다. **줄어드는 값은 받지 않는다** — 한 조각 안에서
   * 총계는 늘기만 하고, 사람이 읽는 줄의 `16K` 는 정확한 값보다 작게 반올림된다.
   */
  private counters(c: { nodes?: number | null; timeMs?: number | null; speed?: number | null }) {
    if (c.nodes != null) {
      this.sawNodes = true;
      this.sliceNodes = Math.max(this.sliceNodes, c.nodes);
    }
    if (c.timeMs != null) {
      this.sawTime = true;
      this.sliceTimeMs = Math.max(this.sliceTimeMs, c.timeMs);
    }
    if (c.speed != null) this.engineSpeed = c.speed;
    const nodes = this.baseNodes + this.sliceNodes;
    const timeMs = this.baseTimeMs + this.sliceTimeMs;
    this.stats = {
      ...this.stats,
      nodes: this.sawNodes ? nodes : null,
      timeMs: this.sawTime ? timeMs : null,
      // 누적 평균. 엔진의 SPEED 는 조각마다 0 에서 다시 올라오므로(조각 머리
      // 2206 → 끝 26123) 그대로 그리면 속도도 톱니가 된다.
      speed: this.sawNodes && timeMs > 0 ? Math.round((nodes * 1000) / timeMs) : this.engineSpeed,
    };
  }

  /** 응답 하나를 먹인다. 화면에 보일 것이 바뀌었으면 `true`. */
  consume(r: EngineResponse): boolean {
    switch (r.kind) {
      case "infoPvStart":
        this.sawInfoPv = true;
        // 얕은 조각 머리에서는 라운드를 넘기지 않는다 — 넘기면 두 라운드 뒤에
        // 앞 조각의 깊은 PV 가 「낡았다」며 지워진다(깊이는 이 뒤 DEPTH 줄에 온다).
        if (r.index === 0 && !this.shallow) {
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
        // 이 조각이 앞 조각이 끝낸 깊이까지 올라왔으면 다시 화면을 맡긴다.
        if (this.shallow && r.depth >= this.floor) this.shallow = false;
        if (this.shallow) return false;
        this.stats = { ...this.stats, depth: r.depth };
        return true;

      case "infoEval":
        this.curMate = r.mate;
        this.curEval = r.cp;
        if (this.shallow) return false;
        this.stats = { ...this.stats, mate: r.mate, evalCp: r.cp };
        return true;

      case "infoWinRate":
        this.curWinRate = r.winRate;
        if (this.shallow) return false;
        this.stats = { ...this.stats, winRatePct: pct(r.winRate) };
        return true;

      case "infoBestline":
        this.curLine = r.line;
        return false;

      case "infoPvDone": {
        if (this.shallow) return false;
        this.floor = Math.max(this.floor, this.curDepth);
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
        switch (r.key) {
          // **NODES 는 총계가 아니다** — Rapfi 에서는 PV 하나(루트 수 하나)의 노드
          // 수라, 멀티 PV 블록마다 3 → 4 → 21 → 10 처럼 오르내린다. 총계로 그리면
          // 노드 수가 들쭉날쭉 튄다. 총계는 TOTALNODES 가 나른다.
          case "NODES":
            return false;
          case "TOTALNODES":
          case "NODE": // 옛 Yixin 철자 — 총계다
            this.counters({ nodes: r.value });
            return true;
          case "TOTALTIME":
          case "TIME":
            this.counters({ timeMs: r.value });
            return true;
          case "SPEED":
            this.counters({ speed: r.value });
            return true;
          case "SELDEPTH":
            if (this.shallow) return false;
            this.stats = { ...this.stats, selDepth: r.value };
            return true;
        }
        return false;

      case "thinking": {
        // 노드·시간은 얕은 조각 머리에서도 **센다** — 깊이·평가처럼 되돌아가는 값이
        // 아니라 쌓이기만 하는 값이다. 탐색 끝 요약 줄(`Speed … | Node 36K |
        // Time 691ms`)은 반올림된 노드 대신 속도×시간으로 정확한 값을 되살린다.
        const exact =
          r.speed !== null && r.timeMs !== null ? Math.floor((r.speed * r.timeMs) / 1000) : null;
        this.counters({
          nodes: exact !== null && r.nodes !== null ? Math.max(exact, r.nodes) : r.nodes,
          timeMs: r.timeMs,
        });
        // 깊이·평가·PV 는 같은 규칙 — 얕은 조각 머리의 줄은 넘긴다.
        if (this.shallow || (r.depth !== null && r.depth < this.floor)) return true;
        this.stats = {
          ...this.stats,
          depth: r.depth ?? this.stats.depth,
          selDepth: r.selDepth ?? this.stats.selDepth,
          evalCp: r.evalCp ?? this.stats.evalCp,
          mate: r.mate ?? this.stats.mate,
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

      // 실시간 후보는 **지금 반복**의 것이라, 얕은 조각 머리에서는 화면을 흔들기만
      // 한다(특히 REFRESH 가 후보를 싹 지운다). 따라잡을 때까지 넘긴다.
      case "realtimeBest":
      case "realtimePos":
      case "realtimeDone":
      case "realtimeLose":
      case "realtimePv":
      case "realtimeRefresh":
        if (this.shallow) return false;
        return this.realtime(r);

      case "bestMove": {
        // **탐색 없는 즉답.** 빈 판(0수)에서 Rapfi 는 탐색하지 않고 천원(7,7)을 곧바로
        // 돌려준다 — PV · 깊이 · 평가 · 카운터가 한 줄도 없다. 오목을 완성하는 수 · 막아야만
        // 하는 수도 같다(tryTrivialBestmove). 예전엔 이 좌표를 흘려 스냅샷이 끝까지 비었고,
        // 화면은 «탐색 중»인데 아무것도 오지 않는 멈춘 모습이었다. 탐색이 무엇이든 말했으면
        // (PV · 실시간 · 카운터) 좌표는 그 탐색의 끝일 뿐이므로 건드리지 않는다.
        const head = r.moves[0];
        if (!head || this.pvs.size > 0 || this.realtimeBest || this.sawNodes || this.sawInfoPv) {
          return false;
        }
        this.instant = true;
        this.pvs.set(0, {
          index: 0,
          depth: 0,
          winRate: null,
          mate: null,
          evalCp: null,
          line: [head],
          round: this.round,
        });
        return true;
      }

      default:
        return false;
    }
  }

  private realtime(r: EngineResponse): boolean {
    switch (r.kind) {
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
      instant: this.instant,
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
