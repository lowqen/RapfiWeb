/**
 * 최적화 여정 — 출처는 `docs/최적화-마스터플랜.md` 의 통합 상태판과 본문 판정 기록이다. 여기서 새로 재거나 고친 숫자는 없다.
 * 상태 어휘도 상태판과 같다(채택·배포 · 완료 · 불채택 · 기각 · 보류).
 */

export type Status = "adopted" | "done" | "rejected" | "dropped" | "parked";

export const STATUS_LABEL: Record<Status, string> = {
  adopted: "채택·배포",
  done: "완료",
  rejected: "불채택",
  dropped: "기각",
  parked: "보류",
};

export interface Step {
  id: string;
  title: string;
  status: Status;
  /** 한 줄 근거 — 판정을 낸 수치 */
  metric: string;
}

export interface Phase {
  key: string;
  name: string;
  period: string;
  goal: string;
  steps: Step[];
}

export const PHASES: Phase[] = [
  {
    key: "p1",
    name: "Phase 1 — 즉각 체감",
    period: "2026-09-30 ~ 10-01",
    goal: "엔진을 고치지 않고 앱 쪽에서 — 기동 순서 · 스레드 UX · 판정 도구",
    steps: [
      {
        id: "2-a",
        title: "Relaxed SIMD 변형 추가",
        status: "adopted",
        metric: "1 스레드 NPS +18~20%(AMD) · +23%(Intel) · BENCH 해시 동일",
      },
      {
        id: "P1-1",
        title: "thread_num · hash_size 를 예열 전에",
        status: "done",
        metric: "첫 탐색의 가중치 재적재 3줄 → 0줄(≈0.74초 절약)",
      },
      {
        id: "P1-2",
        title: "스레드 수 변경 UX",
        status: "done",
        metric: "비용 안내 + 「적용」 확정 — 반복 재적재 방지",
      },
      {
        id: "P1-3",
        title: "필승 국면 묶음 50개",
        status: "done",
        metric: "gomocalc 50/50 · 우리 50/50 — 판정의 바탕",
      },
      {
        id: "P1-4",
        title: "relaxed 효과의 CPU 분포",
        status: "done",
        metric: "AMD EPYC · Intel Xeon 두 러너에서 기록",
      },
    ],
  },
  {
    key: "p2",
    name: "Phase 2 — 결과 불변 패치",
    period: "2026-10-01 ~ 10-03 · S1 재측정 10-08",
    goal: "탐색 트리를 바꾸지 않는 upstream 패치 후보 — BENCH 해시 게이트",
    steps: [
      {
        id: "P2-2",
        title: "스레드 재구성 때 평가기 인계",
        status: "adopted",
        metric: "스레드 변경 시 재적재 12줄 → 0줄",
      },
      {
        id: "P2-6",
        title: "wasm-opt -O4 --converge",
        status: "adopted",
        metric: "single 1 스레드 NPS +1.20% · +1.56%(두 런)",
      },
      {
        id: "P2-1",
        title: "codebook gather 파이프라이닝",
        status: "rejected",
        metric: "NPS −0.54% · +0.27% — 잡음 안",
      },
      {
        id: "P2-4",
        title: "TT 적중 쓰기 조건화",
        status: "rejected",
        metric: "S1 물리 4코어 재측정(종결) — 4 스레드 NPS +0.48% · −0.49%",
      },
      {
        id: "P2-3",
        title: "폴스 셰어링 alignas(64)",
        status: "rejected",
        metric: "S1 물리 4코어(종결) — 2 스레드 NPS +0.56% · −0.88%",
      },
      {
        id: "P2-5",
        title: "출력 줄 단위화",
        status: "rejected",
        metric: "NPS −0.16% · −1.42% — 개선 없음",
      },
      {
        id: "P2-7",
        title: "게으른 평가 여유 margin_scale",
        status: "rejected",
        metric: "싼 확인 관문 미달(네이티브)",
      },
    ],
  },
  {
    key: "p3",
    name: "Phase 3 — 탐색 구조",
    period: "2026-10-02 ~ 10-04",
    goal: "트리를 바꾸는 변경 — SPRT 대국만이 판정한다",
    steps: [
      {
        id: "P3-1",
        title: "위협 수 축소 완화",
        status: "rejected",
        metric: "SPRT 782판 Elo −6.7(−21.8 ~ +8.4)",
      },
      {
        id: "P3-3",
        title: "정책 헤드 얕은 노드 생략",
        status: "rejected",
        metric: "SPRT H0 · 892판 Elo −19.4(−37.3 ~ −1.6)",
      },
      {
        id: "P3-4",
        title: "2 스레드 깊이 분산",
        status: "rejected",
        metric: "깊이 도달 시간비 1.099 · 1.019 — 잡음 바닥 안",
      },
      {
        id: "P3-5",
        title: "WASM PGO",
        status: "rejected",
        metric: "NPS −4.1% · +2.8%(순서 효과) · .wasm −21%",
      },
      {
        id: "1-e",
        title: "MCTS 전환",
        status: "dropped",
        metric: "6초 안 필승 없음 · 방문 5~7K/초",
      },
    ],
  },
  {
    key: "v2",
    name: "v2 — 구조 혁신",
    period: "2026-10-04 ~ 10-06",
    goal: "저수준 SIMD · 측정 체계 · 신경망 구조 — 같은 규칙으로",
    steps: [
      {
        id: "M1",
        title: "cachegrind 결정적 비용 지표",
        status: "done",
        metric: "같은 빌드 Ir 차 2×10⁻⁹ — 결과 불변 변경의 1차 관문",
      },
      {
        id: "A1",
        title: "dwconv mulhi → q15mulr",
        status: "adopted",
        metric: "WASM SPRT H1 · 1,774판 Elo +20.2(+6.6 ~ +33.9)",
      },
      {
        id: "P4-1",
        title: "주기 노드 카운터",
        status: "adopted",
        metric: "결과 불변 · 멀티 NODE 멈춤 해소",
      },
      {
        id: "A3",
        title: "starBlock 가중치 재사용 배치",
        status: "adopted",
        metric: "같은 트리 속도 +8.67%(+7.86 ~ +9.48) · A/A ±0.3%",
      },
      {
        id: "M3",
        title: "500ms 속도-Elo 환산",
        status: "done",
        metric: "속도 2배 = +105.7 Elo → +1% ≈ +1.5 Elo",
      },
      {
        id: "N1 · N1b",
        title: "소형 값 헤드 증류",
        status: "dropped",
        metric: "보류 승률 차 p99 28.5%p · 22.5%p ≫ 관문 5%p",
      },
    ],
  },
];

/** 속도(NPS) 이득 — 같은 러너 · 같은 트리에서 잰 것만. value 는 % */
export interface SpeedItem {
  id: string;
  label: string;
  value: number;
  low: number;
  high: number;
  status: Status;
  note: string;
}

export const SPEED: SpeedItem[] = [
  {
    id: "2-a",
    label: "Relaxed SIMD 변형",
    value: 19.6,
    low: 18,
    high: 23,
    status: "adopted",
    note: "기하 평균 105.3K → 125.9K(AMD EPYC 9V74) · Intel +23%",
  },
  {
    id: "A3",
    label: "starBlock 배치(relaxed)",
    value: 8.67,
    low: 7.86,
    high: 9.48,
    status: "adopted",
    note: "같은 트리 짝 177개 · 95% 구간",
  },
  {
    id: "P2-6",
    label: "wasm-opt -O4 --converge",
    value: 1.38,
    low: 1.2,
    high: 1.56,
    status: "adopted",
    note: "두 런 +1.20% · +1.56%",
  },
  {
    id: "P2-1",
    label: "codebook 파이프라이닝",
    value: -0.14,
    low: -0.54,
    high: 0.27,
    status: "rejected",
    note: "두 런 −0.54% · +0.27%",
  },
  {
    id: "P2-5",
    label: "출력 줄 단위화",
    value: -0.79,
    low: -1.42,
    high: -0.16,
    status: "rejected",
    note: "두 런 −0.16% · −1.42%",
  },
  {
    id: "P3-5",
    label: "WASM PGO",
    value: -0.67,
    low: -4.08,
    high: 2.75,
    status: "rejected",
    note: "두 런 −4.08% · +2.75% — 순서 효과 안",
  },
];

/** 지금까지의 SPRT · 고정 판 수 대국(수당 500ms 가 기본, 아니면 note 에) — Elo 와 95% 구간 */
export interface EloItem {
  id: string;
  label: string;
  elo: number;
  low: number;
  high: number;
  games: number;
  status: Status;
  note: string;
}

export const ELO_HISTORY: EloItem[] = [
  {
    id: "M3",
    label: "속도 2배(같은 엔진 500 ↔ 250ms)",
    elo: 105.7,
    low: 82.1,
    high: 130.4,
    games: 552,
    status: "done",
    note: "환산 기준선",
  },
  {
    id: "A1",
    label: "A1 q15mulr — WASM relaxed",
    elo: 20.2,
    low: 6.6,
    high: 33.9,
    games: 1774,
    status: "adopted",
    note: "H1 채택",
  },
  {
    id: "A1-n",
    label: "A1 — 네이티브(속도 이득 0)",
    elo: -8.8,
    low: -23.6,
    high: 6.0,
    games: 1302,
    status: "rejected",
    note: "정확도 비용만 — 결정 없음",
  },
  {
    id: "P3-1",
    label: "P3-1 위협 수 축소 완화",
    elo: -6.7,
    low: -21.8,
    high: 8.4,
    games: 782,
    status: "rejected",
    note: "수당 100ms · 취소",
  },
  {
    id: "P3-3",
    label: "P3-3 정책 헤드 생략",
    elo: -19.4,
    low: -37.3,
    high: -1.6,
    games: 892,
    status: "rejected",
    note: "H0 채택",
  },
];

/**
 * relaxed ↔ 일반 SIMD128 — 같은 런 · 같은 국면 · 짝(고정 깊이 15, --det), CPU 둘.
 * `bench/sprt/results/ci-{37619779632-variant-speed-intel8488c,37583166782-variant-speed-amd7b13}.md` · 보고서 §4.1 · §4.2.
 */
export interface PairedRow {
  set: "aa" | "all" | "open" | "mate";
  value: number;
  low: number;
  high: number;
  pairs: number;
}
export interface PairedCpu {
  key: "intel" | "amd";
  cpu: string;
  note: string;
  run: string;
  rows: PairedRow[];
}
export const PAIRED_SET_LABEL: Record<PairedRow["set"], string> = {
  aa: "A/A 대조",
  all: "전체",
  open: "균형 개시 60",
  mate: "필승 묶음 50",
};
export const RELAXED_PAIRED: PairedCpu[] = [
  {
    key: "intel",
    cpu: "Intel Xeon 8488C",
    note: "AVX-512 VNNI · AVX-VNNI",
    run: "37619779632",
    rows: [
      { set: "aa", value: 0.88, low: -0.06, high: 1.83, pairs: 198 },
      { set: "all", value: 57.02, low: 53.12, high: 61.01, pairs: 176 },
      { set: "open", value: 77.01, low: 74.49, high: 79.57, pairs: 103 },
      { set: "mate", value: 32.58, low: 29.15, high: 36.1, pairs: 73 },
    ],
  },
  {
    key: "amd",
    cpu: "AMD EPYC 7B13",
    note: "AVX2 · VNNI 없음",
    run: "37583166782",
    rows: [
      { set: "aa", value: 0.25, low: -1.89, high: 2.45, pairs: 196 },
      { set: "all", value: 32.47, low: 28.56, high: 36.51, pairs: 181 },
      { set: "open", value: 42.83, low: 37.88, high: 47.96, pairs: 105 },
      { set: "mate", value: 19.39, low: 14.42, high: 24.57, pairs: 76 },
    ],
  },
];
