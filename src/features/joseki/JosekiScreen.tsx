import { useEffect, useState } from "react";
import { loadOpeningTables } from "../../data/opening-tables";
import { t } from "../../i18n/i18n";
import { CurriculumHome } from "./curriculum/CurriculumHome";
import { JosekiEditor } from "./JosekiEditor";
import { JosekiList } from "./JosekiList";
import { useJosekiStore } from "./josekiStore";

/**
 * 정석 — 두 탭.
 *
 *   - **공식 커리큘럼**: 관리자가 저장소에 실은 정석을 읽기 전용으로 배운다(살펴보기 · 학습,
 *     docs/공식-정석-설계.md).
 *   - **내 정석**(W9, 계획서 §7): 목록과 편집 두 얼굴. 정석 하나가 열려 있으면 편집, 아니면 목록.
 *
 * 고른 탭은 이 브라우저에 남는다. 편집 중인 내 정석이 있으면 그 탭으로 연다.
 */

type Tab = "official" | "mine";
const TAB_KEY = "rapfi.joseki.tab";

function loadTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === "mine" ? "mine" : "official";
  } catch {
    return "official";
  }
}

export function JosekiScreen() {
  const open = useJosekiStore((s) => s.current !== null);
  const loaded = useJosekiStore((s) => s.loaded);
  const [tab, setTabState] = useState<Tab>(() => (open ? "mine" : loadTab()));
  useEffect(() => {
    if (!loaded) void useJosekiStore.getState().load();
    void loadOpeningTables();
  }, [loaded]);

  const setTab = (next: Tab) => {
    setTabState(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* 이번 세션만 */
    }
  };

  return (
    <div className="josekiscreen">
      <div className="modetabs josekiscreen__tabs" role="tablist" aria-label={t("정석 보기")}>
        {(["official", "mine"] as const).map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            className="modetabs__tab"
            data-tab={x}
            aria-selected={tab === x}
            onClick={() => setTab(x)}
          >
            {x === "official" ? t("공식 커리큘럼") : t("내 정석")}
          </button>
        ))}
      </div>
      {tab === "official" ? <CurriculumHome /> : open ? <JosekiEditor /> : <JosekiList />}
    </div>
  );
}
