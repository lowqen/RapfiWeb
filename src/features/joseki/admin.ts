import { create } from "zustand";

/**
 * 관리자 도구 스위치(설정 ▸ 고급 ▸ 시스템) — 커리큘럼 스튜디오(`/joseki/studio`)와 정석 편집기의 «공식 커리큘럼
 * 레슨으로» 단추를 연다.
 *
 * **보안 장치가 아니다.** 누구나 켤 수 있고, 켜서 할 수 있는 일은 초안을 고치고 JSON 파일을 내려받는 것까지다. 배포본의
 * 커리큘럼을 바꾸는 권한은 저장소에 쓸 권한(git · CODEOWNERS)이다(docs/공식-정석-설계.md §2).
 */
const KEY = "rapfi.adminTools";

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const useAdminTools = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: typeof localStorage === "undefined" ? false : load(),
  set: (on) => {
    try {
      if (on) localStorage.setItem(KEY, "1");
      else localStorage.removeItem(KEY);
    } catch {
      /* 이번 세션만 */
    }
    set({ on });
  },
}));
