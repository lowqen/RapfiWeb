import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BoardCanvas } from "../../core/board/BoardCanvas";
import type { BoardMark, BoardRender } from "../../core/board/board-renderer";
import type { TagKind } from "../../core/board/ladder";
import { label, moveKey, sameMove, type Move } from "../../core/model/move";
import { chain, gradeAt } from "../../core/opening/opening-name";
import { keyOf, transpositions } from "../../core/opening/frame";
import { theoryNext } from "../../core/opening/explore";
import type { Grade } from "../../core/opening/tables";
import { gameMoves, gamesThrough, lookup } from "../../core/rif/query";
import { RES_BLACK, RES_DRAW, RES_WHITE } from "../../core/rif/rif-parse";
import { GradeBadge } from "../../components/GradeBadge";
import { useOpeningTables } from "../../data/opening-tables";
import { useBoardStore } from "../board/boardStore";
import { useGameStore } from "../board/gameStore";
import { PackSourceBar, RifImportCard, WdlBar } from "./rif/RifParts";
import { fmtInt } from "./rif/format";
import { activePack, useRifStore } from "./rif/rifStore";
import { langOf, localized, msg, pick, t } from "../../i18n/i18n";

/**
 * 연구 ▸ 오프닝 — 앱 `OpeningExplorerSection` 의 이식. 이름 사슬 · 환원 · 이론 다음 수(W6a, 팩 없이)
 * 에 **빈도 통계**(W7 — RenjuNet `.rif` 나 내 기보로 만든 팩)를 얹는다.
 *
 * 판은 보드 화면과 **같은 판**이다 — 여기서 둔 수는 보드에도 있고, 보드에서 둔 수를 여기서 이어
 * 본다. 그래서 보드의 두 스토어를 직접 읽는다(`features/README.md` 의 예외).
 *
 * 다음 수 표는 앱과 같이 **둔 수 ∪ 이론 수**다 — 많이 둔 수부터, 그다음 흑에게 좋은 이론 수부터.
 * 판 위에는 둔 수마다 판 수 칩(색 = 둘 차례의 점수), 둔 적 없는 이론 수에는 등급 표식을 그린다.
 * 둘 수 있는 것은 표에 있는 수뿐이다 — 여기는 기록과 이론을 훑는 곳이고, 아무 데나 두는 것은
 * 보드 화면의 일이다.
 */

const fmtLine = (moves: readonly Move[], size: number) =>
  moves.map((m) => label(m, size)).join(" ");

/** 판 수를 칩 한 칸에 — 1234 → «1.2k». */
const chipCount = (n: number) =>
  n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

interface NextRow {
  readonly move: Move;
  readonly name: string | null;
  readonly grade: Grade | null;
  readonly n: number;
  readonly b: number;
  readonly d: number;
  readonly w: number;
}

const RESULT_TEXT: Readonly<Record<number, string>> = localized({
  [RES_BLACK]: msg("흑 승"),
  [RES_WHITE]: msg("백 승"),
  [RES_DRAW]: msg("무"),
});

const GAMES_SHOWN = 50;

export function OpeningExplorer() {
  const render = useBoardStore((s) => s.render);
  const future = useBoardStore((s) => s.future);
  const tables = useOpeningTables((s) => s.tables);
  const loaded = useOpeningTables((s) => s.loaded);
  const ensure = useRifStore((s) => s.ensure);
  const ready = useRifStore((s) => s.ready);
  const hasRenjuNet = useRifStore((s) => s.pack !== null);
  const pack = useRifStore(activePack);
  const navigate = useNavigate();
  const { stones, size } = render;
  useEffect(() => void ensure(), [ensure]);

  const names = useMemo(() => chain(stones, tables, size), [stones, tables, size]);
  const grade = useMemo(() => gradeAt(stones, tables, size), [stones, tables, size]);
  const theory = useMemo(() => theoryNext(stones, tables, size), [stones, tables, size]);
  const stat = useMemo(() => (pack ? lookup(pack, stones) : null), [pack, stones]);
  const offFrame = stones.length > 0 && keyOf(stones, size) === null;
  const alts = useMemo(() => {
    const self = keyOf(stones, size);
    return transpositions(stones, size)
      .filter((l) => keyOf(l, size) !== self)
      .map((l) => ({ line: l, chain: chain(l, tables, size) }));
  }, [stones, tables, size]);

  // 둔 수 ∪ 이론 수(앱 `ExplorerLookup.nextRows`): 많이 둔 수부터, 그다음 흑에게 좋은 이론 수부터.
  const rows: NextRow[] = useMemo(() => {
    const byKey = new Map<number, NextRow>();
    for (const t of theory)
      byKey.set(moveKey(t.move, size), {
        move: t.move,
        name: t.name,
        grade: t.grade,
        n: 0,
        b: 0,
        d: 0,
        w: 0,
      });
    for (const nx of stat?.next ?? []) {
      const k = moveKey(nx.move, size);
      const t = byKey.get(k);
      const next = [...stones, nx.move];
      byKey.set(k, {
        move: nx.move,
        name: t?.name ?? null,
        grade: t?.grade ?? gradeAt(next, tables, size),
        n: nx.n,
        b: nx.b,
        d: nx.d,
        w: nx.w,
      });
    }
    return [...byKey.values()].sort(
      (a, b) =>
        b.n - a.n ||
        (b.grade?.code ?? -99) - (a.grade?.code ?? -99) ||
        Number(b.name !== null) - Number(a.name !== null) ||
        moveKey(a.move, size) - moveKey(b.move, size),
    );
  }, [theory, stat, stones, tables, size]);
  const blackToMove = stones.length % 2 === 0;

  // 판에는 돌과 «표에 있는 다음 수»만 — 엔진 표식은 얹지 않는다(여기는 기록과 이론이다).
  const view: BoardRender = useMemo(() => {
    const tags = new Map<number, { label: string; kind: TagKind; winRatePct?: number }>();
    const marks = new Map<number, BoardMark>();
    const candidates = new Map<number, "live" | "done">();
    for (const r of rows) {
      const k = moveKey(r.move, size);
      const decided = r.b + r.d + r.w;
      // 둔 수는 판 수 칩, 등급이 있으면 표식도 — 둘 다 있으면 렌더러가 표식을 칩 모서리에 작게 단다.
      if (r.grade) marks.set(k, { shape: r.grade.mark, fill: r.grade.fill, dot: r.grade.dot });
      if (r.n > 0) {
        // 칩의 색은 **둘 차례의** 점수 — 엔진 값 칩과 같은 읽기(높으면 그 수를 둔 쪽이 잘 됐다).
        const mover = blackToMove ? r.b : r.w;
        tags.set(k, {
          label: chipCount(r.n),
          kind: "rate",
          winRatePct: decided ? ((mover + r.d / 2) / decided) * 100 : 50,
        });
      } else if (!r.grade) candidates.set(k, "done");
    }
    return { ...render, tags, bestMark: null, ghosts: [], loseCells: new Set(), candidates, marks };
  }, [render, rows, size, blackToMove]);

  const play = useCallback(
    (m: Move) => {
      const g = useGameStore.getState();
      const head = future[0];
      g.loadMoves([...stones, m], {
        // 무른 수와 같은 수면 앞날을 지킨다 — 보드의 「앞으로」와 같은 규칙.
        future: head && sameMove(head, m) ? future.slice(1) : [],
        name: g.gameName,
        what: `오프닝 탐색: ${label(m, size)}`,
      });
    },
    [stones, future, size],
  );

  const onTap = useCallback(
    (m: Move) => {
      if (rows.some((r) => sameMove(r.move, m))) play(m);
    },
    [rows, play],
  );

  const undo = useGameStore((s) => s.undoMove);
  const undoAll = useGameStore((s) => s.undoAll);

  // 대국 목록 — 펼칠 때만 센다(수순 열 전체를 훑는다).
  const [showGames, setShowGames] = useState(false);
  const [needle, setNeedle] = useState("");
  const games = useMemo(() => {
    if (!showGames || !pack || !stat) return null;
    const q = needle.trim().toLowerCase();
    return gamesThrough(pack, stones, {
      limit: GAMES_SHOWN,
      ...(q
        ? {
            accept: (g: number) =>
              pack.players[pack.games.black[g]!]!.toLowerCase().includes(q) ||
              pack.players[pack.games.white[g]!]!.toLowerCase().includes(q),
          }
        : {}),
    });
  }, [showGames, pack, stat, stones, needle]);

  const openGame = (g: number) => {
    if (!pack) return;
    const moves = gameMoves(pack, g);
    const black = pack.players[pack.games.black[g]!];
    const white = pack.players[pack.games.white[g]!];
    useGameStore.getState().loadMoves(moves, {
      name:
        pack.source === "renjunet"
          ? `${black} - ${white}`
          : (pack.tournaments[pack.games.tour[g]!] ?? null),
      what: `오프닝 탐색: 대국 열기`,
    });
    navigate("/board");
  };

  return (
    <div className="explorer">
      <div className="explorer__board">
        <BoardCanvas render={view} onTap={onTap} zoomable={false} keyboard />
      </div>
      <div className="panel__actions explorer__nav">
        <button type="button" onClick={undoAll} disabled={stones.length === 0}>
          {t("처음으로")}
        </button>
        <button type="button" onClick={undo} disabled={stones.length === 0}>
          {t("한 수 무르기")}
        </button>
        <Link className="btn" to="/board">
          {t("보드에서 보기")}
        </Link>
      </div>

      {ready && !hasRenjuNet && <RifImportCard compact />}
      <PackSourceBar />

      <section className="panel">
        <h2 className="panel__title">{t("국면")}</h2>
        <dl className="kv">
          <dt>{t("수순")}</dt>
          <dd className="tnum" data-k="explorer-line">
            {stones.length ? fmtLine(stones, size) : t("시작 국면")}
          </dd>
          <dt>{t("이름")}</dt>
          <dd data-k="explorer-chain" lang={langOf(names.join(" "))}>
            {names.length ? names.join(" › ") : t("없음")}
          </dd>
          {grade && (
            <>
              <dt>{t("유불리")}</dt>
              <dd>
                <GradeBadge grade={grade} />
              </dd>
            </>
          )}
          {pack && (
            <>
              <dt>{pack.source === "renjunet" ? t("대국") : t("내 기보")}</dt>
              <dd data-k="explorer-games" className="explorer__stat">
                {stat ? (
                  <>
                    <span className="tnum">{t("{n}판", { n: fmtInt(stat.n) })}</span>
                    <WdlBar b={stat.b} d={stat.d} w={stat.w} />
                  </>
                ) : stones.length > pack.maxPlies ? (
                  t("{n}수까지 셉니다", { n: pack.maxPlies })
                ) : (
                  t("이 국면을 지난 판이 없습니다")
                )}
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className="panel">
        <h2 className="panel__title">
          {t("다음 수")}{" "}
          <span className="panel__status">{rows.length ? t("{n}곳", { n: rows.length }) : ""}</span>
        </h2>
        {rows.length === 0 ? (
          <p className="panel__hint">
            {stat
              ? t("이 국면에서 더 둔 판이 없습니다.")
              : stones.length >= 5
                ? t(
                    "이름과 흑 5수 유불리는 5수까지입니다. 그 뒤로는 기록(통계)이나 엔진이 읽습니다(보드 ▸ 분석).",
                  )
                : offFrame
                  ? t("이 수순은 표준 개시 틀(1수 천원 · 3수까지 가운데 5×5)을 벗어났습니다.")
                  : t(
                      "표에 이 국면의 다음 수가 없습니다. 대부분의 4수에는 이름이 없고, 그것이 정상입니다.",
                    )}
          </p>
        ) : (
          <ul className="theory" aria-label={t("다음 수")}>
            {rows.map((r) => (
              <li key={moveKey(r.move, size)}>
                <button
                  type="button"
                  className={"theory__row" + (pack ? " theory__row--stat" : "")}
                  onClick={() => play(r.move)}
                >
                  <span className="theory__move tnum">{label(r.move, size)}</span>
                  <span className="theory__name" lang={langOf(r.name ?? "")}>
                    {r.name ?? ""}
                    {r.grade && (
                      <>
                        {" "}
                        <GradeBadge grade={r.grade} compact />
                      </>
                    )}
                  </span>
                  {pack && (
                    <>
                      <span className="theory__games tnum">
                        {r.n ? t("{n}판", { n: fmtInt(r.n) }) : ""}
                      </span>
                      {r.n ? <WdlBar b={r.b} d={r.d} w={r.w} compact /> : <span />}
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pack && stat && (
        <section className="panel" aria-label={t("이 국면을 지난 대국")}>
          <h2 className="panel__title">
            {t("대국")}{" "}
            <span className="panel__status tnum">
              {games
                ? games.matched > GAMES_SHOWN
                  ? t("{n}판 중 {shown}판", { n: fmtInt(games.matched), shown: GAMES_SHOWN })
                  : t("{n}판", { n: fmtInt(games.matched) })
                : t("{n}판", { n: fmtInt(stat.n) })}
            </span>
          </h2>
          {!showGames ? (
            <div className="panel__actions">
              <button type="button" onClick={() => setShowGames(true)}>
                {t("대국 목록 보기")}
              </button>
            </div>
          ) : (
            <>
              {pack.source === "renjunet" && (
                <input
                  className="ranking__input explorer__needle"
                  type="search"
                  placeholder={t("선수 이름으로 거르기")}
                  aria-label={t("선수 이름으로 거르기")}
                  value={needle}
                  onChange={(e) => setNeedle(e.target.value)}
                />
              )}
              <ol className="gamelist" data-k="explorer-gamelist">
                {games?.games.map((g) => (
                  <li key={g}>
                    <button type="button" className="gamelist__row" onClick={() => openGame(g)}>
                      <span className="gamelist__year tnum">
                        {pack.tourYear[pack.games.tour[g]!] || ""}
                      </span>
                      <span className="gamelist__players">
                        {pack.players[pack.games.black[g]!]}{" "}
                        <span className="gamelist__vs">vs</span>{" "}
                        {pack.players[pack.games.white[g]!]}
                      </span>
                      <span className="gamelist__res" data-res={pack.games.res[g]}>
                        {RESULT_TEXT[pack.games.res[g]!] ?? t("결과 모름")}
                      </span>
                      <span className="gamelist__tour">
                        {pack.tournaments[pack.games.tour[g]!]}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {games && games.matched === 0 && (
                <p className="panel__hint">{t("그 이름의 선수가 둔 판이 없습니다.")}</p>
              )}
            </>
          )}
        </section>
      )}

      {alts.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">{t("환원: 같은 돌, 다른 수순")}</h2>
          <p className="panel__hint">
            {t(
              "돌과 색이 같으니 한 판이고 유불리와 통계도 하나지만, 수순이 달라 이름은 다를 수 있습니다.",
            )}
          </p>
          <ul className="theory">
            {alts.map((a) => (
              <li key={fmtLine(a.line, size)} className="theory__row theory__row--static">
                <span className="theory__move tnum">{fmtLine(a.line, size)}</span>
                <span className="theory__name" lang={langOf(a.chain.join(" "))}>
                  {a.chain.join(" › ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="explorer__note">
        {t(
          "1~3수 이름은 계산하고, 4수 이름 249개와 흑 5수 유불리 1,889모양은 내장 표에서 읽습니다(유불리 출처: Renju Atlas, CC0 1.0).",
        )}
        {!loaded && ` ${t("표를 받는 중입니다…")}`}{" "}
        {t(
          "빈도 통계는 RenjuNet .rif 를 넣으면(이 브라우저 안에서만 만들고 보관) 세계 대국으로, 없으면 내 기보로 셉니다.",
        )}
        {pick("", ` ${t("4수 이름은 한국어 원표 그대로입니다.")}`)}
      </p>
    </div>
  );
}
