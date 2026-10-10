import { useMemo, useRef, useState } from "react";
import { downloadBlob, stamp } from "../../app/download";
import { Chip, ChipGroup } from "../../components/controls";
import { GradeBadge } from "../../components/GradeBadge";
import { classifyTree } from "../../core/joseki/classify";
import { countNodes } from "../../core/joseki/tree";
import { GAME_FILE_ACCEPT } from "../../core/model/game-file";
import { searchText } from "../../data/joseki";
import { useOpeningTables } from "../../data/opening-tables";
import { useBoardStore } from "../board/boardStore";
import { useJosekiStore } from "./josekiStore";
import { langOf, t } from "../../i18n/i18n";

/**
 * 정석 목록 — 찾기(제목 · 분류 · 태그 · 메모 전문) · 분류/태그 거르기 · **지금 보드 국면으로 찾기**
 * (정규 키라 뒤집거나 돌린 판도 걸린다) · 가져오기/내보내기.
 */
export function JosekiList() {
  const s = useJosekiStore();
  const tables = useOpeningTables((x) => x.tables);
  const stones = useBoardStore((b) => b.render.stones.length);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const rows = useMemo(
    () =>
      s.list.map((tree) => ({
        tree,
        c: classifyTree(tree, tables),
        n: countNodes(tree.root),
        text: searchText(tree),
      })),
    [s.list, tables],
  );
  const cats = [...new Set(rows.map((r) => r.c.category))].sort((a, b) => a.localeCompare(b, "ko"));
  const tags = [...new Set(rows.flatMap((r) => r.tree.tags))].sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!needle || r.text.includes(needle) || r.c.chain.join(" ").includes(needle)) &&
      (!cat || r.c.category === cat) &&
      (!tag || r.tree.tags.includes(tag)),
  );

  return (
    <div className="review joseki">
      <section className="panel" aria-label={t("정석 목록")}>
        <h2 className="panel__title">
          {t("정석")} <span className="panel__status tnum">{t("{n}개", { n: s.list.length })}</span>
        </h2>
        <p className="panel__hint">
          {t(
            "수순을 판이나 글(h8 i9 j10)로 넣고, 갈래마다 메모와 평가 기호를 답니다. 분류는 주 변화의 주형 이름에서 저절로 붙습니다. 이 브라우저에 저장되고, JSON 으로 주고받을 수 있습니다.",
          )}
        </p>
        <div className="panel__actions">
          <button type="button" className="button--primary" onClick={() => void s.create(false)}>
            {t("새 정석")}
          </button>
          <button type="button" disabled={stones === 0} onClick={() => void s.create(true)}>
            {t("보드 국면으로 새 정석")}
          </button>
          <button type="button" disabled={stones === 0} onClick={() => void s.findBoard()}>
            {t("보드 국면으로 찾기")}
          </button>
          <button type="button" onClick={() => file.current?.click()}>
            {t("가져오기")}
          </button>
          <button
            type="button"
            disabled={s.list.length === 0}
            onClick={() =>
              downloadBlob(`joseki-${stamp()}.json`, s.exportAll(), "application/json")
            }
          >
            {t("모두 내보내기")}
          </button>
          <input
            ref={file}
            type="file"
            accept={`.json,application/json,${GAME_FILE_ACCEPT}`}
            multiple
            hidden
            data-k="joseki-import"
            onChange={(e) => {
              const files = [...(e.currentTarget.files ?? [])];
              e.currentTarget.value = "";
              if (files.length) void s.importFiles(files);
            }}
          />
        </div>
        {s.notice && (
          <p className="panel__hint jnotice" role="status" data-k="joseki-notice">
            {s.notice}{" "}
            <button type="button" className="linkish" onClick={s.clearNotice}>
              {t("닫기")}
            </button>
          </p>
        )}
      </section>

      {s.hits && s.hits.length > 0 && (
        <section className="panel" aria-label={t("보드 국면이 든 정석")}>
          <h2 className="panel__title">{t("보드 국면이 든 정석 ({n})", { n: s.hits.length })}</h2>
          <ul className="jlist">
            {s.hits.map((h) => (
              <li key={h.tree.id}>
                <button
                  type="button"
                  className="jlist__open"
                  onClick={() => s.open(h.tree.id, h.path)}
                >
                  <span className="jlist__title">{h.tree.title}</span>
                  <span className="jlist__meta tnum">{t("{n}수째 마디로 열기", { n: h.ply })}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.list.length > 0 && (
        <section className="panel" aria-label={t("찾기")}>
          <input
            className="search__input jsearch"
            type="search"
            placeholder={t("제목 · 분류 · 태그 · 메모에서 찾기")}
            aria-label={t("정석 찾기")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {cats.length > 1 && (
            <ChipGroup label={t("분류")}>
              {cats.map((c) => (
                <Chip key={c} on={cat === c} onClick={() => setCat(cat === c ? null : c)}>
                  <span lang={langOf(t(c))}>{t(c)}</span>
                </Chip>
              ))}
            </ChipGroup>
          )}
          {tags.length > 0 && (
            <ChipGroup label={t("태그")}>
              {tags.map((g) => (
                <Chip key={g} on={tag === g} onClick={() => setTag(tag === g ? null : g)}>
                  #{g}
                </Chip>
              ))}
            </ChipGroup>
          )}
          <ul className="jlist" data-k="joseki-list">
            {shown.map(({ tree, c, n }) => (
              <li key={tree.id}>
                <button type="button" className="jlist__open" onClick={() => s.open(tree.id)}>
                  <span className="jlist__title">{tree.title}</span>
                  <span className="jlist__meta">
                    <span lang={langOf(t(c.category))}>{t(c.category)}</span>
                    {c.group ? ` · ${c.group}` : ""} · {t("{n}수", { n })} ·{" "}
                    {new Date(tree.updatedAt).toLocaleDateString()}
                    {tree.tags.length ? ` · ${tree.tags.map((x) => `#${x}`).join(" ")}` : ""}
                  </span>
                </button>
                {c.grade && <GradeBadge grade={c.grade} />}
                {asking === tree.id ? (
                  <span className="jlist__ask">
                    <button
                      type="button"
                      className="btn--danger"
                      onClick={() => void s.remove(tree.id).then(() => setAsking(null))}
                    >
                      {t("지우기")}
                    </button>
                    <button type="button" autoFocus onClick={() => setAsking(null)}>
                      {t("취소")}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="linkish"
                    aria-label={t("{name} 지우기", { name: tree.title })}
                    onClick={() => setAsking(tree.id)}
                  >
                    {t("지우기")}
                  </button>
                )}
              </li>
            ))}
            {shown.length === 0 && <li className="panel__hint">{t("맞는 정석이 없습니다.")}</li>}
          </ul>
        </section>
      )}
    </div>
  );
}
