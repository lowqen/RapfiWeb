import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chip, ChipGroup, Segmented } from "../../../components/controls";
import { fromLabel, type Move } from "../../../core/model/move";
import {
  ABBR,
  nameOf,
  NONSTD,
  ROMAJI,
  isDirect,
  representative,
} from "../../../core/opening/opening26";
import {
  NO_FILTER,
  filterActive,
  fiveMoveRanking,
  matchPlayers,
  openingRanking,
  rankingScore,
  type RankSide,
  type RankingFilter,
  type Split,
} from "../../../core/rif/rankings";
import { useGameStore } from "../../board/gameStore";
import { PackSourceBar, RifImportCard, WdlBar } from "../rif/RifParts";
import { fmtInt } from "../rif/format";
import { activePack, useRifStore } from "../rif/rifStore";
import { MiniBoard } from "../../../components/MiniBoard";
import { langOf, msg, pick, t } from "../../../i18n/i18n";

/**
 * 연구 ▸ 랭킹(W7) — 앱 `RankingsScreen` 의 이식. «사람들이 실제로 어떤 개시를 두고, 어떻게 이기나».
 *
 *   - 3수: 26주형(+ 규칙 밖) — 몇 판 · 흑 점수. 번호 순 · 판 수 순 · (거르면) 승률 순
 *   - 5수: 실제로 둔 5수 모양 — 많이 둔 순 60개
 *
 * 거르기: 선수(이름 · 나라) · 그 선수가 잡은 색 · 규칙. 승률 정렬은 **걸렀을 때만** 준다 — 모든
 * 판의 «가장 잘 이기는 개시»는 렌주에 대한 사실이지 사용자가 물은 것이 아니다(앱과 같다). 승률
 * 순은 윌슨 아래 끝으로 줄 세운다(한 판 1승이 20판 11승을 앞서지 않게).
 *
 * 줄을 누르면 그 수순을 보드에 올리고 연구 ▸ 오프닝으로 간다 — 거기서 다음 수 통계를 이어 본다.
 */

type Tab = "three" | "five";
type Sort = "number" | "games" | "rate";

const SIDE_OPTIONS: { value: RankSide; label: string }[] = [
  { value: "either", label: msg("어느 색이든") },
  { value: "black", label: msg("흑으로") },
  { value: "white", label: msg("백으로") },
];

const parseLine = (text: string): Move[] =>
  text
    .split(" ")
    .map((t) => fromLabel(t))
    .filter((m): m is Move => m !== null);

export function RankingScreen() {
  const ensure = useRifStore((s) => s.ensure);
  const ready = useRifStore((s) => s.ready);
  const hasRenjuNet = useRifStore((s) => s.pack !== null);
  const pack = useRifStore(activePack);
  const navigate = useNavigate();
  useEffect(() => void ensure(), [ensure]);

  const [tab, setTab] = useState<Tab>("three");
  const [sort, setSort] = useState<Sort>("games");
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<number[]>([]);
  const [rules, setRules] = useState<number[]>([]);
  const [side, setSide] = useState<RankSide>("either");
  const [allRules, setAllRules] = useState(false);

  // 자료가 바뀌면(RenjuNet ↔ 내 기보 · 새 파일) 선수 · 규칙 번호가 다른 표를 가리킨다 — 비운다.
  const [filtersFor, setFiltersFor] = useState(pack);
  if (filtersFor !== pack) {
    setFiltersFor(pack);
    setPlayers([]);
    setRules([]);
    setQuery("");
  }

  const isLocal = pack?.source === "local";
  const filter: RankingFilter = useMemo(
    () =>
      players.length || rules.length || side !== "either"
        ? { players: new Set(players), rules: new Set(rules), side }
        : NO_FILTER,
    [players, rules, side],
  );
  const active = filterActive(filter);
  const scoring: RankSide = side === "white" ? "white" : "black";
  const effectiveSort: Sort =
    sort === "rate" && !active ? "games" : sort === "number" && tab === "five" ? "games" : sort;

  const three = useMemo(() => (pack ? openingRanking(pack, filter) : null), [pack, filter]);
  const five = useMemo(
    () => (pack && tab === "five" ? fiveMoveRanking(pack, filter, 60) : []),
    [pack, filter, tab],
  );
  // 규칙은 RenjuNet 에 29가지다 — 칩을 다 펴면 화면을 덮는다. 판이 많은 순으로 몇 개만 보이고
  // 나머지는 «더 보기»로 접는다(고른 규칙은 접혀도 늘 보인다).
  const ruleOrder = useMemo(() => {
    if (!pack) return [];
    const n = new Array<number>(pack.rules.length).fill(0);
    for (const r of pack.games.rule) n[r] = (n[r] ?? 0) + 1;
    return n.map((count, i) => ({ i, count })).sort((a, b) => b.count - a.count);
  }, [pack]);
  const RULES_SHOWN = 6;
  const shownRules = allRules
    ? ruleOrder
    : ruleOrder.filter((r, k) => k < RULES_SHOWN || rules.includes(r.i));
  const suggestions = useMemo(
    () =>
      pack && !isLocal ? matchPlayers(pack, query, 8).filter((i) => !players.includes(i)) : [],
    [pack, query, players, isLocal],
  );

  const open = (moves: Move[], what: string) => {
    useGameStore.getState().loadMoves(moves, { what: `랭킹: ${what}` });
    navigate("/research/explorer");
  };

  const byRate = (a: Split, b: Split) => rankingScore(b, scoring) - rankingScore(a, scoring);
  const threeRows = (() => {
    if (!three) return [];
    const map = new Map(three.rows.map((r) => [r.opening, r.split]));
    // 26주형은 판이 없어도 늘 26줄(번호 순에서 빈 칸이 보여야 «안 두어진다»가 읽힌다).
    const all = Array.from({ length: NONSTD + 1 }, (_, i) => ({
      opening: i,
      split: map.get(i) ?? { total: 0, black: 0, white: 0, draw: 0 },
    })).filter((r) => r.opening !== NONSTD || r.split.total > 0);
    if (effectiveSort === "games")
      all.sort((a, b) => b.split.total - a.split.total || a.opening - b.opening);
    else if (effectiveSort === "rate")
      all.sort((a, b) => byRate(a.split, b.split) || a.opening - b.opening);
    return all;
  })();
  const fiveRows =
    effectiveSort === "rate" ? [...five].sort((a, b) => byRate(a.split, b.split)) : five;

  return (
    <div className="ranking">
      {ready && !hasRenjuNet && <RifImportCard compact={pack !== null} />}
      <PackSourceBar />

      {pack && three && (
        <>
          <section className="panel" aria-label={t("랭킹 거르기")}>
            <div className="ranking__head">
              <Segmented<Tab>
                label={t("랭킹 종류")}
                value={tab}
                options={[
                  { value: "three", label: t("3수 · 26주형") },
                  { value: "five", label: t("5수 모양") },
                ]}
                onChange={setTab}
              />
              <Segmented<Sort>
                label={t("정렬")}
                value={effectiveSort}
                options={[
                  ...(tab === "three" ? [{ value: "number" as const, label: t("번호") }] : []),
                  { value: "games", label: t("판 수") },
                  ...(active
                    ? [
                        {
                          value: "rate" as const,
                          label: side === "white" ? t("백 승률") : t("흑 승률"),
                        },
                      ]
                    : []),
                ]}
                onChange={setSort}
              />
            </div>

            {!isLocal && (
              <div className="ranking__filters">
                <label className="ranking__search">
                  <span className="field__label">{t("선수")}</span>
                  <input
                    className="ranking__input"
                    type="search"
                    placeholder={t("이름이나 나라(예: KOR)")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label={t("선수 찾기")}
                  />
                  {suggestions.length > 0 && (
                    <ul className="ranking__suggest" role="listbox" aria-label={t("선수 후보")}>
                      {suggestions.map((i) => (
                        <li key={i}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={false}
                            onClick={() => {
                              setPlayers((p) => [...p, i]);
                              setQuery("");
                            }}
                          >
                            <span lang={langOf(pack.players[i] ?? "")}>{pack.players[i]}</span>
                            <span className="ranking__country">{pack.playerCountry[i]}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </label>
                {players.length > 0 && (
                  <>
                    <ChipGroup label={t("고른 선수")}>
                      {players.map((i) => (
                        <Chip
                          key={i}
                          on
                          onClick={() => setPlayers((p) => p.filter((x) => x !== i))}
                        >
                          {pack.players[i]} ×<span className="sr-only"> {t("빼기")}</span>
                        </Chip>
                      ))}
                    </ChipGroup>
                    <Segmented<RankSide>
                      label={t("선수의 색")}
                      value={side}
                      options={SIDE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
                      onChange={setSide}
                    />
                  </>
                )}
                {pack.rules.length > 1 && (
                  <div className="ranking__rules">
                    <span className="field__label">{t("규칙")}</span>
                    <ChipGroup label={t("규칙")}>
                      {shownRules.map(({ i, count }) => (
                        <Chip
                          key={i}
                          on={rules.includes(i)}
                          title={t("{n}판", { n: fmtInt(count) })}
                          onClick={() =>
                            setRules((r) => (r.includes(i) ? r.filter((x) => x !== i) : [...r, i]))
                          }
                        >
                          {pack.rules[i]}
                        </Chip>
                      ))}
                      {ruleOrder.length > RULES_SHOWN && (
                        <button
                          type="button"
                          className="linkish ranking__more"
                          aria-expanded={allRules}
                          onClick={() => setAllRules((v) => !v)}
                        >
                          {allRules
                            ? t("접기")
                            : t("더 보기 ({n})", { n: ruleOrder.length - RULES_SHOWN })}
                        </button>
                      )}
                    </ChipGroup>
                  </div>
                )}
              </div>
            )}
            <p className="panel__hint tnum" data-k="ranking-total">
              {active
                ? t("고른 범위 {n}판", { n: fmtInt(three.total) })
                : t("{n}판", { n: fmtInt(three.total) })}
              {isLocal &&
                ` · ${t("내 기보(저장한 기보와 지금 판)로 센 것입니다. RenjuNet 파일을 넣으면 세계 대국으로 바뀝니다.")}`}
            </p>
          </section>

          <section
            className="panel"
            aria-label={tab === "three" ? t("26주형 랭킹") : t("5수 모양 랭킹")}
          >
            {tab === "three" ? (
              <ol className="ranklist" data-k="ranking-three">
                {threeRows.map((r, k) => (
                  <li key={r.opening}>
                    <button
                      type="button"
                      className="rankrow"
                      disabled={r.opening === NONSTD}
                      onClick={() => open(representative(r.opening), nameOf(r.opening))}
                    >
                      <span className="rankrow__rank tnum">
                        {effectiveSort === "number" ? "" : k + 1}
                      </span>
                      {r.opening === NONSTD ? (
                        <span className="rankrow__thumb rankrow__thumb--none" aria-hidden="true" />
                      ) : (
                        <MiniBoard moves={representative(r.opening)} className="rankrow__thumb" />
                      )}
                      <span className="rankrow__name">
                        {r.opening === NONSTD ? (
                          t("규칙 밖 개시")
                        ) : (
                          <>
                            <b>{nameOf(r.opening)}</b>
                            <span className="rankrow__sub">
                              {ABBR[r.opening]} ·{" "}
                              {isDirect(r.opening) ? t("직접주형") : t("간접주형")}
                              {pick(` · ${ROMAJI[r.opening]}`, "")}
                            </span>
                          </>
                        )}
                      </span>
                      <span className="rankrow__games tnum">
                        {r.split.total ? t("{n}판", { n: fmtInt(r.split.total) }) : t("없음")}
                      </span>
                      <WdlBar b={r.split.black} d={r.split.draw} w={r.split.white} compact />
                    </button>
                  </li>
                ))}
              </ol>
            ) : fiveRows.length === 0 ? (
              <p className="panel__hint">{t("다섯 수를 넘긴 판이 없습니다.")}</p>
            ) : (
              <ol className="ranklist" data-k="ranking-five">
                {fiveRows.map((r, k) => {
                  const moves = parseLine(r.moves);
                  return (
                    <li key={r.shape}>
                      <button
                        type="button"
                        className="rankrow"
                        onClick={() => open(moves, r.moves)}
                      >
                        <span className="rankrow__rank tnum">{k + 1}</span>
                        <MiniBoard moves={moves} className="rankrow__thumb" />
                        <span className="rankrow__name">
                          <b>{r.opening === NONSTD ? t("규칙 밖") : nameOf(r.opening)}</b>
                          <span className="rankrow__sub tnum">{r.moves.toUpperCase()}</span>
                        </span>
                        <span className="rankrow__games tnum">
                          {t("{n}판", { n: fmtInt(r.split.total) })}
                        </span>
                        <WdlBar b={r.split.black} d={r.split.draw} w={r.split.white} compact />
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>
      )}

      {ready && !pack && (
        <p className="explorer__note">
          {t(
            "아직 저장한 기보도 없습니다. 보드에서 둔 판이나 연 기보가 쌓이면 여기서 내 기보로도 셉니다.",
          )}
        </p>
      )}
    </div>
  );
}
