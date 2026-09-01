import { create } from "zustand";
import type { EngineStatus } from "./EngineClient";
import { detectCapabilities, type Capabilities } from "./capabilities";

/**
 * 엔진 상태의 화면쪽 그림자.
 *
 * W1 에서는 **상태만** 산다 — 레일의 연결 점이 이걸 읽는다. 실제 기동은 W3 에서
 * 이 스토어가 `EngineClient` 를 붙잡으면서 시작된다. 지금 엔진을 자동으로 띄우지
 * 않는 것은 의도다: `public/engine/` 은 아직 비어 있고(산출물은 W0 이후 릴리스
 * 자산으로 나른다), 없는 파일을 받으러 가서 콘솔에 404 를 남길 이유가 없다.
 */
interface EngineState {
  status: EngineStatus;
  capabilities: Capabilities;
  lastLines: readonly string[];
  setStatus: (s: EngineStatus) => void;
  pushLines: (lines: readonly string[]) => void;
}

/** 콘솔 링버퍼 상한. 앱과 같은 값(계획서 §3). */
const CONSOLE_MAX = 5000;

export const useEngineStore = create<EngineState>((set) => ({
  status: "idle",
  capabilities: detectCapabilities(),
  lastLines: [],
  setStatus: (status) => set({ status }),
  pushLines: (lines) =>
    set((s) => {
      const next = [...s.lastLines, ...lines];
      return { lastLines: next.length > CONSOLE_MAX ? next.slice(-CONSOLE_MAX) : next };
    }),
}));
