/**
 * 보드가 이 테마에서 어떻게 칠해지는가 — `BoardSkin.kt` 의 이식본.
 *
 * 값은 **CSS 변수에서 읽는다.** 색을 두 번 정의하지 않기 위해서다: 토큰은
 * `src/core/design/` 에서 나와 `tokens.css` 로 구워지고, Canvas 는 그것을
 * 그대로 읽는다. 그래서 테마를 바꾸면(=`data-theme` 이 바뀌면) 다시 읽기만 하면 된다.
 *
 * **다크 모드는 나무 자체가 다르다**(Clay → WoodNight): 톤 변화가 아니라 *재료*
 * 변화다. 낮의 채도는 어두운 명도에서 나무가 아니라 주황 플라스틱으로 읽힌다.
 * 그 판단은 토큰 쪽(`scheme.ts`)에 이미 들어가 있고 여기서는 이름만 쓴다.
 */

export interface BoardSkin {
  /** 판 자체와 살짝 어두운 가장자리(대각선 그라디언트로 이어진다). */
  wood: string;
  woodEdge: string;
  /** 격자선과 화점. */
  line: string;
  /** 좌표 라벨 — 일부러 격자와 **다른** 색이다. 격자의 일부가 아니기 때문이다. */
  label: string;
  /** 흑돌: 빛 받는 면 → 그늘진 면 → 테두리. */
  blackHigh: string;
  blackLow: string;
  blackRim: string;
  /** 백돌, 같은 셋. */
  whiteHigh: string;
  whiteLow: string;
  whiteRim: string;
  /** 돌이 나무에 드리우는 그림자. */
  stoneShadow: string;
  /** 방금 둔 돌의 링. */
  lastMove: string;
  /** 최선수 링과, 나무 위에서도 칩 위에서도 살아남게 하는 어두운 후광. */
  best: string;
  bestHalo: string;
  /** 실시간 후보(`POS`). */
  candidate: string;
  /** 금수(렌주)와 실시간 `LOSE` 표시. */
  forbid: string;
  /** 엔진이 무시하라고 지시받은 점. */
  blocked: string;
  /**
   * 값 칩 둘레의 링. 라이트 보드에서는 `null`.
   *
   * **다크 보드의 대가이고 선택 사항이 아니다.** 값 사다리는 휘도 0.03~0.165 를
   * 달리며 0.54 의 금색 나무에서 떨어져 보이도록 설계됐는데, 어두운 나무는 그
   * 범위 *안*에 들어온다 — 사다리 한가운데(후보 수 대부분이 앉는 곳)의 칩이
   * 자기가 놓인 판과 같은 명도가 된다. 사다리는 재설계 대상이 아니므로
   * (그 양극은 Yixin 사용자가 외운 것이다) 분리를 채움이 아니라 링에서 가져온다.
   */
  chipRim: string | null;
}

const V = (styles: CSSStyleDeclaration, name: string): string => {
  const v = styles.getPropertyValue(name).trim();
  if (!v) {
    // 조용히 검정으로 떨어지면 «보드가 왜 이래»로 끝난다. 어느 토큰인지 말해 준다.
    throw new Error(`보드 토큰이 비어 있습니다: ${name} (tokens.css 가 로드됐습니까?)`);
  }
  return v;
};

/**
 * 지금 테마의 스킨을 읽는다. `data-theme` 이 바뀔 때마다 다시 부른다.
 *
 * @param root 보통 `document.documentElement`. 시험에서 다른 노드를 줄 수 있다.
 */
export function readBoardSkin(root: Element): BoardSkin {
  const s = getComputedStyle(root);
  const rim = s.getPropertyValue("--c-board-chip-rim").trim();
  return {
    wood: V(s, "--c-board-wood"),
    woodEdge: V(s, "--c-board-wood-edge"),
    line: V(s, "--c-board-line"),
    label: V(s, "--c-board-label"),
    blackHigh: V(s, "--c-board-black-high"),
    blackLow: V(s, "--c-board-black-low"),
    blackRim: V(s, "--c-board-black-rim"),
    whiteHigh: V(s, "--c-board-white-high"),
    whiteLow: V(s, "--c-board-white-low"),
    whiteRim: V(s, "--c-board-white-rim"),
    stoneShadow: V(s, "--c-board-stone-shadow"),
    lastMove: V(s, "--c-board-last-move"),
    best: V(s, "--c-board-best"),
    bestHalo: V(s, "--c-board-best-halo"),
    candidate: V(s, "--c-board-candidate"),
    forbid: V(s, "--c-board-forbid"),
    blocked: V(s, "--c-board-blocked"),
    // 라이트 스킴에는 이 토큰 자체가 없다 — 없는 것이 «링 없음»이다.
    chipRim: rim === "" ? null : rim,
  };
}

/** 시험과 SSR 용. 브라우저 밖에서도 렌더러를 부를 수 있어야 한다. */
export const FALLBACK_SKIN: BoardSkin = {
  wood: "#DAB673",
  woodEdge: "#C9A15C",
  line: "#7E5D14",
  label: "#5F460A",
  blackHigh: "#3D362C",
  blackLow: "#100A03",
  blackRim: "#070300",
  whiteHigh: "#FBFAF8",
  whiteLow: "#DAD4CA",
  whiteRim: "#94897A",
  stoneShadow: "rgb(0 0 0 / 0.251)",
  lastMove: "#4C7A57",
  best: "#F3D9A8",
  bestHalo: "rgb(0 0 0 / 0.4)",
  candidate: "#3F6B4A",
  forbid: "#B4453A",
  blocked: "#524A40",
  chipRim: null,
};
