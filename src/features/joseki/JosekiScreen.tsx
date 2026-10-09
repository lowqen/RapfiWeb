import { useEffect } from "react";
import { loadOpeningTables } from "../../data/opening-tables";
import { JosekiEditor } from "./JosekiEditor";
import { JosekiList } from "./JosekiList";
import { useJosekiStore } from "./josekiStore";

/**
 * 정석(W9, 계획서 §7) — 목록과 편집 두 얼굴. 정석 하나가 열려 있으면 편집, 아니면 목록.
 */
export function JosekiScreen() {
  const open = useJosekiStore((s) => s.current !== null);
  const loaded = useJosekiStore((s) => s.loaded);
  useEffect(() => {
    if (!loaded) void useJosekiStore.getState().load();
    void loadOpeningTables();
  }, [loaded]);
  return open ? <JosekiEditor /> : <JosekiList />;
}
