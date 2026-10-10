import { DbAggregator, type DbLine, type DbSnapshot } from "../../core/database/yixindb";
import type { Move } from "../../core/model/move";
import type { EngineCommand } from "../../engine/engine-types";
import { t } from "../../i18n/i18n";

/**
 * 엔진과 yixindb 가 말하는 길 하나 — 명령을 보내고, 그 명령의 끝을 알리는 줄을 기다린다.
 *
 * DB 명령은 **한 번에 하나**다. 답이 `DATABASE …` 줄 묶음일 뿐 어느 요청의 답인지 꼬리표가 없어서
 * (데스크톱은 `dbqueryseq`/`dbdoneseq` 로 센다) 겹쳐 보내면 앞 요청이 뒤 요청의 `DONE` 을 가져간다.
 * 그래서 요청은 줄을 서고, 앞 요청이 끝(또는 시간 끝)나야 다음이 나간다.
 *
 * 엔진이 DB 를 쥐고 있지 않으면 질의에 **아무 답도 하지 않는다**(`if (ctx.storage)`). 그래서
 * 모든 요청에 시간 끈이 있다 — 끈이 끊기면 `null` 이고, 부르는 쪽은 «답 없음»으로 읽는다.
 */

export interface DbPort {
  send(cmd: EngineCommand): void;
  /** 워커가 넘기는 DB 줄을 듣는다. 끊는 함수를 돌려준다. */
  listen(fn: (line: string) => void): () => void;
}

export interface DbReply {
  /** 이 요청 동안 받은 줄(주석의 이어지는 줄은 닫힌 `text` 하나로). */
  lines: DbLine[];
  snapshot: DbSnapshot;
}

const DEFAULT_TIMEOUT_MS = 8_000;

export class DbChannel {
  readonly agg: DbAggregator;
  private chain: Promise<unknown> = Promise.resolve();
  private waiter: ((l: DbLine) => void) | null = null;
  private unlisten: () => void;

  constructor(
    private readonly port: DbPort,
    size: number,
    fromWire: (row: number, col: number) => Move,
    /** 요청 밖에서 온 줄도 포함해 줄마다 — 화면의 기록용. */
    private readonly onLine?: (l: DbLine) => void,
  ) {
    this.agg = new DbAggregator(size, fromWire);
    this.unlisten = port.listen((text) => {
      const l = this.agg.consume(text);
      if (!l) return;
      this.onLine?.(l);
      this.waiter?.(l);
    });
  }

  close(): void {
    this.unlisten();
  }

  /**
   * 명령을 보내고 `until` 이 참인 줄을 기다린다. `until` 이 없으면 보내기만 한다(답하지 않는
   * 명령 — 주석 · 칸 글자 · 기록 하나 지우기). ERROR 는 곧장 끝낸다.
   */
  request(
    cmd: EngineCommand,
    until: ((l: DbLine, seen: readonly DbLine[]) => boolean) | null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<DbReply | null> {
    const run = () =>
      new Promise<DbReply | null>((resolve) => {
        if (!until) {
          this.port.send(cmd);
          resolve({ lines: [], snapshot: this.agg.snapshot() });
          return;
        }
        const lines: DbLine[] = [];
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          this.waiter = null;
          resolve(ok ? { lines, snapshot: this.agg.snapshot() } : null);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        this.waiter = (l) => {
          lines.push(l);
          if (l.kind === "error") finish(true);
          else if (until(l, lines)) finish(true);
        };
        this.port.send(cmd);
      });
    const p = this.chain.then(run, run);
    this.chain = p;
    return p;
  }
}

// ── 흔한 끝맺음 ───────────────────────────────────────────────────────

/** `yxquerydatabaseallt` — 칸들 · `DONE` 뒤의 `TEXT` 가 끝이다. */
export const untilText = (l: DbLine) => l.kind === "text";
/** `yxquerydatabaseone` · `yxedittvddatabase` — `ONE` 한 줄. */
export const untilOne = (l: DbLine) => l.kind === "one";
/** `yxdeletedatabaseall` — `Done deleting` 뒤의 `DONE`. */
export const untilDeleted = (l: DbLine, seen: readonly DbLine[]) =>
  l.kind === "done" && seen.some((x) => x.kind === "deleted");
/** `yxdbtotxtall` — `Wrote … database to …`. */
export const untilWrote = (l: DbLine) => l.kind === "wrote";

/** 답의 첫 오류 글, 없으면 null. */
export const replyError = (r: DbReply | null): string | null =>
  r === null
    ? t("엔진이 답하지 않았습니다(DB 가 붙어 있지 않을 수 있습니다)")
    : ((r.lines.find((l) => l.kind === "error") as { text: string } | undefined)?.text ?? null);
