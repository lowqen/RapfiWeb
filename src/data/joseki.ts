import { indexKeys } from "../core/joseki/io";
import { plainText } from "../core/joseki/markdown";
import { walk, type JosekiTree } from "../core/joseki/tree";
import type { RapfiDb } from "./db";

/**
 * 정석 저장소(W9) — 문서(`joseki`)와 국면 색인(`josekiIndex`)을 **한 트랜잭션으로** 함께 쓴다.
 * 색인만 남거나 문서만 남는 틈이 없게.
 */

export async function listJoseki(d: RapfiDb): Promise<JosekiTree[]> {
  return d.joseki.orderBy("updatedAt").reverse().toArray();
}

export const getJoseki = (d: RapfiDb, id: string) => d.joseki.get(id);

export async function putJoseki(d: RapfiDb, t: JosekiTree): Promise<void> {
  await d.transaction("rw", d.joseki, d.josekiIndex, async () => {
    await d.joseki.put(t);
    await d.josekiIndex.where("josekiId").equals(t.id).delete();
    await d.josekiIndex.bulkAdd(indexKeys(t).map((k) => ({ ...k, josekiId: t.id })));
  });
}

export async function deleteJoseki(d: RapfiDb, id: string): Promise<void> {
  await d.transaction("rw", d.joseki, d.josekiIndex, async () => {
    await d.joseki.delete(id);
    await d.josekiIndex.where("josekiId").equals(id).delete();
  });
}

/** 이 국면(정규 키)이 들어 있는 정석들 — 정석마다 첫 마디 하나. */
export async function findByKey(
  d: RapfiDb,
  key: string,
): Promise<{ tree: JosekiTree; path: number[]; ply: number }[]> {
  const rows = await d.josekiIndex.where("key").equals(key).toArray();
  const out: { tree: JosekiTree; path: number[]; ply: number }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.josekiId)) continue;
    seen.add(r.josekiId);
    const tree = await d.joseki.get(r.josekiId);
    if (tree) out.push({ tree, path: r.path, ply: r.ply });
  }
  return out;
}

/** 제목 · 분류 · 태그 · 모든 메모에서 찾는 글(소문자). */
export function searchText(t: JosekiTree): string {
  const parts = [t.title, t.category, ...t.tags];
  walk(t.root, (n) => {
    if (n.comment) parts.push(plainText(n.comment));
  });
  return parts.join(" ").toLowerCase();
}
