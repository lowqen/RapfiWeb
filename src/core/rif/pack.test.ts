import { describe, expect, it } from "vitest";
import { canonical as posCanonical, tf } from "../model/pos-key";
import { DEFAULT_SIZE, label, move, sameMove, type Move } from "../model/move";
import { classify } from "../opening/opening26";
import { RifStreamParser, RES_BLACK, RES_DRAW, RES_WHITE } from "./rif-parse";
import { buildPack, packBytes, rifInput, type RenjuPack } from "./pack";
import { blackScore, gameMoves, gamesThrough, lookup } from "./query";
import {
  NO_FILTER,
  fiveMoveRanking,
  matchPlayers,
  openingRanking,
  rankingScore,
  score,
} from "./rankings";

/**
 * W7 변환기 — 파싱 · 팩 · 조회 · 랭킹. **RenjuNet 기보는 쓰지 않는다**(저장소에 둘 수 없다) — 같은
 * 모양의 합성 `.rif` 를 만든다. 실제 파일과의 대조(국면 116,191개 = 데스크톱 팩)는
 * `tools/w7/rif-crosscheck.ts` 가 로컬에서 한다.
 */

const size = DEFAULT_SIZE;
const L = (m: Move) => label(m, size).toLowerCase();

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 천원에서 시작해 둘레로 번지는 판 — 같은 개시가 잦아 국면이 겹친다(실제 기보처럼). */
function randomGame(r: () => number, n: number): Move[] {
  const out: Move[] = [move(7, 7)];
  const used = new Set([7 * size + 7]);
  while (out.length < n) {
    const base = out[Math.floor(r() * out.length)]!;
    const m = move(
      Math.min(14, Math.max(0, base.x + Math.floor(r() * 3) - 1)),
      Math.min(14, Math.max(0, base.y + Math.floor(r() * 3) - 1)),
    );
    if (used.has(m.y * size + m.x)) {
      if (used.size > 200) break;
      continue;
    }
    used.add(m.y * size + m.x);
    out.push(m);
  }
  return out;
}

interface SynthGame {
  id: number;
  black: number;
  white: number;
  rule: number;
  tournament: number;
  bresult: string;
  moves: string;
  info?: string | undefined;
}

function rifXml(games: SynthGame[]): string {
  const head = `<?xml version="1.0"?>
<database version="1.0" date="2026-07-31">
<!-- It is forbidden to use any contents of this database ... <game id="999"> 주석 안의 태그는 무시 -->
<countries>
<country id="1" name="Estonia" abbr="EST" reversed="0" />
<country id="6" name="Republic of Korea" abbr="KOR" reversed="1" />
</countries>
<rules>
<rule id="1" name="Classic" category="1">
<info>- The first player puts one of the 26 openings.</info>
</rule>
<rule id="11" name="Yamaguchi" category="1">
<info>- x</info>
</rule>
</rules>
<openings>
<opening id="21" abbr="i8" name="indirect 8" />
</openings>
<players>
<player id="1" name="Ando" surname="Meritee" country="1" />
<player id="2" name="Kim" surname="O&apos;Neil &amp; co" country="6" />
<player id="3" name="" surname="" country="9" />
<player id="4" name="김" surname="렌주 🀄" country="6" />
</players>
<tournaments>
<tournament id="1" name="Team World Championship 2006" year="2006" rated="1" />
<tournament id="5" name="Open &quot;B&quot;" year="2005" rated="0" />
</tournaments>
<games>
`;
  const body = games
    .map(
      (g) =>
        `<game id="${g.id}" publisher="1" tournament="${g.tournament}" round="F2" rule="${g.rule}" black="${g.black}" white="${g.white}" bresult="${g.bresult}" btime="1" opening="21" alt="" swap="R">\n<move>${g.moves}</move>\n${g.info ? `<info>${g.info}</info>\n` : ""}</game>\n`,
    )
    .join("");
  return head + body + "</games>\n</database>\n";
}

function parseIn(text: string, cut: (i: number) => number): ReturnType<RifStreamParser["finish"]> {
  const p = new RifStreamParser(size);
  for (let i = 0; i < text.length;) {
    const n = Math.max(1, cut(i));
    p.push(text.slice(i, i + n));
    i += n;
  }
  return p.finish();
}

/** 결과가 다양한 합성 대국 `n` 판 — 일부는 같은 판의 대칭 상 · 전치(같은 색 순서 바꿈). */
function synthGames(n: number, seed: number): { games: SynthGame[]; lines: Move[][] } {
  const r = rng(seed);
  const games: SynthGame[] = [];
  const lines: Move[][] = [];
  const results = ["1", "0", "0.5"];
  for (let i = 0; i < n; i++) {
    let line: Move[];
    if (i > 10 && r() < 0.3) {
      // 앞선 판의 대칭 상 — 정규화가 묶어야 한다
      const t = Math.floor(r() * 8);
      line = lines[Math.floor(r() * lines.length)]!.map((m) => tf(t, size, m));
    } else if (i > 10 && r() < 0.15) {
      // 전치 — 흑의 둘째 · 셋째 수를 맞바꾼다
      line = [...lines[Math.floor(r() * lines.length)]!];
      if (line.length > 4) [line[2], line[4]] = [line[4]!, line[2]!];
    } else line = randomGame(r, 3 + Math.floor(r() * 30));
    lines.push(line);
    games.push({
      id: i + 1,
      black: 1 + (i % 4),
      white: 1 + ((i + 1) % 4),
      rule: i % 4 === 0 ? 11 : 1,
      tournament: i % 2 ? 5 : 1,
      bresult: results[i % 3]!,
      moves: line.map(L).join(" "),
      info: i % 7 === 0 ? "comment <with> no tags" : undefined,
    });
  }
  return { games, lines };
}

describe("RIF 스트리밍 파서", () => {
  const { games } = synthGames(40, 1);
  const bad: SynthGame[] = [
    { ...games[0]!, id: 1001, moves: "" }, // 빈 수순
    { ...games[0]!, id: 1002, moves: "h8 h9 h8" }, // 같은 칸 반복
    { ...games[0]!, id: 1003, moves: "h8 z9" }, // 판 밖
    { ...games[0]!, id: 1004, moves: "h8 h16" }, // 판 밖 행
    { ...games[0]!, id: 1005, bresult: "0.25" }, // 결과 이상
    { ...games[0]!, id: 1 }, // 중복 id
  ];
  const xml = rifXml([...games, ...bad]);

  it("바이트를 어디서 끊어도 같다 — UTF-8 글자 한가운데서 끊겨도(파일 스트림 그대로)", () => {
    const bytes = new TextEncoder().encode(xml);
    const whole = new RifStreamParser(size);
    whole.pushBytes(bytes);
    const w = whole.finish();
    expect(w.players.get(4)).toEqual({ name: "김", surname: "렌주 🀄", country: 6 });
    const r = rng(3);
    for (const step of [1, 2, 3, 5, 0]) {
      const p = new RifStreamParser(size);
      for (let i = 0; i < bytes.length;) {
        const n = step || 1 + Math.floor(r() * 4000);
        p.pushBytes(bytes.subarray(i, i + n));
        i += n;
      }
      const got = p.finish();
      expect(got.games.count).toBe(w.games.count);
      expect([...got.games.moves]).toEqual([...w.games.moves]);
      expect(got.players).toEqual(w.players);
      expect(got.skipped).toEqual(w.skipped);
    }
  });

  it("조각을 어디서 끊어도 결과가 같다(요소가 경계에 걸쳐도)", () => {
    const whole = parseIn(xml, () => xml.length);
    const r = rng(9);
    for (const cut of [() => 1, () => 7, () => 1 + Math.floor(r() * 97), () => 4096]) {
      const p = parseIn(xml, cut);
      expect(p.games.count).toBe(whole.games.count);
      expect([...p.games.moves]).toEqual([...whole.games.moves]);
      expect([...p.games.res]).toEqual([...whole.games.res]);
      expect(p.skipped).toEqual(whole.skipped);
    }
  });

  it("데스크톱 · 앱과 같은 판을 받고, 버린 까닭을 센다", () => {
    const p = parseIn(xml, () => 333);
    expect(p.date).toBe("2026-07-31");
    expect(p.games.count).toBe(40);
    expect(p.skipped).toEqual({ empty_moves: 1, bad_moves: 3, bad_bresult: 1, dup_or_bad_id: 1 });
    // 결과 부호(freq35): 1 → 흑승 2, 0 → 백승 0, 0.5 → 무 1
    expect([...p.games.res.slice(0, 3)]).toEqual([RES_BLACK, RES_WHITE, RES_DRAW]);
    // 수순 바이트는 보드 인덱스 — 첫 수는 천원
    expect(p.games.moves[0]).toBe(7 * size + 7);
    // 표와 엔티티
    expect(p.players.get(2)).toEqual({ name: "Kim", surname: "O'Neil & co", country: 6 });
    expect(p.tournaments.get(5)).toEqual({ name: 'Open "B"', year: 2005, rated: false });
    expect(p.rules.get(11)).toBe("Yamaguchi");
    expect(p.countries.get(6)).toBe("KOR");
  });
});

/** 순진한 기준: pos-key 문자열 키로 접두 국면을 세고, 다음 수는 키 프레임에서 접는다. */
function naiveCounts(lines: Move[][], res: number[], maxPlies: number) {
  const pos = new Map<
    string,
    { n: number; b: number; d: number; w: number; next: Map<string, number> }
  >();
  lines.forEach((line, g) => {
    const Lp = Math.min(line.length, maxPlies);
    for (let i = 0; i <= Lp; i++) {
      const pre = line.slice(0, i);
      const c = posCanonical(pre, size);
      let e = pos.get(c.key);
      if (!e) pos.set(c.key, (e = { n: 0, b: 0, d: 0, w: 0, next: new Map() }));
      e.n++;
      if (res[g] === RES_BLACK) e.b++;
      else if (res[g] === RES_DRAW) e.d++;
      else e.w++;
      if (i < Lp) {
        // 다음 수의 동치류 = 그 수를 둔 국면의 키(같은 국면에서 같은 키로 가는 수는 같은 수다)
        const child = posCanonical([...pre, line[i]!], size).key;
        e.next.set(child, (e.next.get(child) ?? 0) + 1);
      }
    }
  });
  return pos;
}

describe("팩 — 접두 국면 집계", () => {
  const { games, lines } = synthGames(600, 42);
  const parsed = parseIn(rifXml(games), () => 5000);
  const pack: RenjuPack = buildPack(rifInput(parsed, { name: "synth.rif", size: 1 }, 0), {
    maxPlies: 12,
    minGames: 1,
  });
  const res = [...parsed.games.res];

  it("국면 수 · 판 수 · 결과가 pos-key 로 순진하게 센 것과 같다", () => {
    const naive = naiveCounts(lines, res, 12);
    expect(pack.pos.n.length).toBe(naive.size);
    // 모든 접두 국면을 팩에서 찾아 견준다
    for (const line of lines) {
      for (let i = 0; i <= Math.min(line.length, 12); i++) {
        const pre = line.slice(0, i);
        const s = lookup(pack, pre);
        const e = naive.get(posCanonical(pre, size).key)!;
        expect(s, pre.map(L).join(" ")).not.toBeNull();
        expect([s!.n, s!.b, s!.d, s!.w]).toEqual([e.n, e.b, e.d, e.w]);
        // 다음 수: 판 위로 되돌린 수를 두면 그 자식 국면 키가 순진한 다음 수 목록과 같은 몫이다
        const fromPack = new Map<string, number>();
        for (const nx of s!.next) {
          expect(pre.some((m) => sameMove(m, nx.move))).toBe(false); // 빈 칸에 그린다
          const child = posCanonical([...pre, nx.move], size).key;
          fromPack.set(child, (fromPack.get(child) ?? 0) + nx.n);
        }
        expect(fromPack).toEqual(e.next);
      }
    }
  });

  it("minGames 아래 국면은 버리고, 다음 수는 판 수 내림차순이다", () => {
    const p2 = buildPack(rifInput(parsed, { name: "s", size: 1 }, 0), {
      maxPlies: 12,
      minGames: 2,
    });
    for (let i = 0; i < p2.pos.n.length; i++) expect(p2.pos.n[i]).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < p2.pos.n.length; i++) {
      for (let k = p2.pos.edgeStart[i]! + 1; k < p2.pos.edgeStart[i + 1]!; k++)
        expect(p2.edges.n[k - 1]).toBeGreaterThanOrEqual(p2.edges.n[k]!);
    }
    // 빈 판 = 모든 판
    expect(lookup(p2, [])!.n).toBe(parsed.games.count);
    expect(p2.stats.peakBytes).toBeGreaterThan(0);
    expect(packBytes(p2)).toBeGreaterThan(0);
  });

  it("대국 목록: 그 국면을 지난 판(전치 · 대칭 상 포함)을 모두 찾는다", () => {
    const target = lines[0]!.slice(0, 5);
    const want = lines
      .map((l, g) => ({ l, g }))
      .filter(
        ({ l }) =>
          l.length >= 5 && posCanonical(l.slice(0, 5), size).key === posCanonical(target, size).key,
      )
      .map(({ g }) => g);
    const got = gamesThrough(pack, target);
    expect(got.games).toEqual(want);
    expect(got.matched).toBe(want.length);
    expect(lookup(pack, target)!.n).toBe(want.length);
    // 거르기와 한도
    const only = gamesThrough(pack, target, { accept: (g) => g === want[0], limit: 1 });
    expect(only).toEqual({ games: [want[0]], matched: 1 });
    expect(gameMoves(pack, want[0]!)).toEqual(lines[want[0]!]);
  });

  it("랭킹: 26주형 · 5수 모양 · 선수 거르기 · 윌슨 아래 끝", () => {
    const all = openingRanking(pack, NO_FILTER);
    expect(all.total).toBe(lines.length);
    const want = new Map<number, number>();
    for (const l of lines) {
      const o = classify(l.slice(0, 3));
      want.set(o, (want.get(o) ?? 0) + 1);
    }
    expect(new Map(all.rows.map((r) => [r.opening, r.split.total]))).toEqual(want);

    const five = fiveMoveRanking(pack, NO_FILTER, 1000);
    expect(five.reduce((a, r) => a + r.split.total, 0)).toBe(
      lines.filter((l) => l.length >= 5).length,
    );

    const kim = matchPlayers(pack, "o'neil");
    expect(kim.map((i) => pack.players[i])).toEqual(["Kim O'Neil & co"]);
    // 나라로도 — KOR 선수 둘(한글 이름도 그대로 읽혔다)
    expect(matchPlayers(pack, "kor").map((i) => pack.players[i])).toEqual([
      "Kim O'Neil & co",
      "김 렌주 🀄",
    ]);
    const asBlack = openingRanking(pack, {
      players: new Set(kim),
      rules: new Set(),
      side: "black",
    });
    expect(asBlack.total).toBe(lines.filter((_, g) => games[g]!.black === 2).length);
    expect(pack.players).toContain("?"); // 이름 없는 선수

    // 한 판 1승(100%)이 20판 11승보다 아래(표본이 얕다)
    const one = { total: 1, black: 1, white: 0, draw: 0 };
    const many = { total: 20, black: 11, white: 9, draw: 0 };
    expect(score(one, "black")).toBe(1);
    expect(rankingScore(one, "black")).toBeLessThan(rankingScore(many, "black"));
    expect(blackScore({ n: 4, b: 1, d: 2, w: 1 })).toBe(0.5);
  });
});

describe("팩 — 수 구간 나눠 세기", () => {
  it("구간을 1 · 2 · 5 개로 나눠도 국면 · 다음 수가 비트 단위로 같다", () => {
    const { games } = synthGames(300, 77);
    const parsed = parseIn(rifXml(games), () => 9000);
    const build = (partitions: number) =>
      buildPack(rifInput(parsed, { name: "s", size: 1 }, 0), {
        maxPlies: 14,
        minGames: 2,
        partitions,
      });
    const one = build(1);
    for (const p of [2, 5]) {
      const many = build(p);
      expect(many.pos).toEqual(one.pos);
      expect(many.edges).toEqual(one.edges);
    }
  });
});
