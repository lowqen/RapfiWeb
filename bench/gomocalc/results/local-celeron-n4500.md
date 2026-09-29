## 환경 — local-celeron-n4500
- CPU: Intel(R) Celeron(R) N4500 @ 1.10GHz · 논리 코어 2 · RAM 3.8GB · win32 10.0.26200
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1/2
- 측정 2026-09-29T15:21:42.246Z → 2026-09-29T16:32:34.678Z
- 보충: rapfiweb/multi-simd128 전체 ← local-rerun-rapfiweb-multi
- 보충: gomocalc/multi-simd128 BENCH ← local-bench-multi
- 보충: rapfiweb/multi-simd128 BENCH ← local-bench-multi

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| gomocalc/single | 0.43.01 (clang++ 21.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 869 | 153 | 220 | — |
| gomocalc/multi | 0.43.01 (clang++ 21.0.0 on Wasm WASM_SIMD) | main-thread | 1595 | 155 | 223 | — |
| gomocalc/multi-relaxed | 0.43.01 (clang++ 21.0.0 on Wasm WASM_SIMD_RELAXED) | main-thread | 738 | 155 | 223 | — |
| rapfiweb/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 389 | 147 | 275 | — |
| rapfiweb/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 673 | 149 | 215 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| gomocalc/single | open-direct | 3000 | 31.0K | 15-45 |
| gomocalc/multi | open-direct | 3000 | 26.6K | 15-45 |
| gomocalc/multi-relaxed | open-direct | 3000 | 32.7K | 15-45 |
| rapfiweb/single | open-direct | 3000 | 34.7K | 14-29 |
| rapfiweb/multi | open-direct | 3000 | 15.7K | 13-26 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| gomocalc/single | 583,421 | 25,974 | 25,973 | 3,628,934 | 139,716 | 662ab34c |
| gomocalc/multi | 728,056 | 22,172 | 22,171 | 3,628,934 | 163,672 | 662ab34c |
| gomocalc/multi-relaxed | 736,094 | 31,832 | 31,832 | 3,628,934 | 114,002 | 662ab34c |
| rapfiweb/single | 956,008 | 118,952 | 47,702 | 7,170,518 | 60,281 | 2b7c7da9 |
| rapfiweb/multi | 720,450 | 109,042 | 43,728 | 7,170,518 | 65,759 | 2b7c7da9 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| gomocalc/single t1 | 38.8K | 28.1K | 42.2K | 65.6K | 51.2K | 43.5K |
| gomocalc/multi t1 | 37.2K | 26.6K | 45.4K | 70.3K | 58.3K | 45.0K |
| gomocalc/multi t2 | 63.5K | 41.8K | 75.3K | 112.9K | 96.6K | 73.7K |
| gomocalc/multi-relaxed t1 | 44.3K | 31.9K | 54.5K | 75.0K | 61.1K | 51.2K |
| gomocalc/multi-relaxed t2 | 76.4K | 54.0K | 117.0K | 118.8K | 102.6K | 89.9K |
| rapfiweb/single t1 | 39.5K | 28.2K | 45.7K | 67.3K | 56.9K | 45.5K |
| rapfiweb/multi t1 | 37.1K | 24.6K | 33.9K | 65.5K | 58.8K | 41.2K |
| rapfiweb/multi t2 | 64.0K | 54.9K | 98.9K | 135.9K | 114.1K | 88.3K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| gomocalc/single t1 | 17.0-32 | 16.0-28 | 16.0-35 | 26.0-9 | 24.0-17 |
| gomocalc/multi t1 | 17.0-32 | 16.0-32 | 16.0-38 | 26.0-9 | 25.0-17 |
| gomocalc/multi t2 | 16.5-37 | 16.5-29 | 18.0-44 | 26.0-9 | 25.5-17 |
| gomocalc/multi-relaxed t1 | 17.0-32 | 17.0-32 | 17.0-44 | 26.0-9 | 25.0-17 |
| gomocalc/multi-relaxed t2 | 18.0-30 | 17.5-31 | 21.0-47 | 26.0-9 | 25.0-17 |
| rapfiweb/single t1 | 18.0-31 | 18.0-31 | 16.0-43 | 26.0-9 | 25.0-17 |
| rapfiweb/multi t1 | 18.0-31 | 18.0-22 | 15.0-40 | 26.0-9 | 25.0-17 |
| rapfiweb/multi t2 | 17.0-38 | 17.0-31 | 20.5-53 | 26.0-9 | 26.5-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | gomocalc/single t1 | gomocalc/multi t1 | gomocalc/multi-relaxed t1 | rapfiweb/single t1 | rapfiweb/multi t1 |
|---|---|---|---|---|---|---|
| open-direct | 13 | 393 | 417 | 345 | 1,413 | 1,375 |
| open-direct | 15 | 576 | 595 | 503 | 3,030 | 3,037 |
| open-direct | 17 | 9,074 | 9,489 | 7,953 | 3,467 | 3,551 |
| open-indirect | 12 | 1,664 | 1,776 | 1,433 | 1,206 | 1,194 |
| open-indirect | 14 | 1,780 | 1,894 | 1,532 | 2,703 | 2,740 |
| open-indirect | 16 | 3,358 | 3,500 | 2,918 | 2,826 | 2,861 |
| midgame | 11 | 123 | 135 | 135 | 116 | 237 |
| midgame | 13 | 3,222 | 3,067 | 2,543 | 2,037 | 3,420 |
| midgame | 15 | 3,251 | 3,102 | 2,570 | 3,201 | 4,852 |
| vcf | 22 | 2,319 | 1,999 | 1,936 | 2,320 | 2,606 |
| vcf | 24 | 3,855 | 3,566 | 3,339 | 3,841 | 4,002 |
| vcf | 26 | 5,199 | 4,846 | 4,538 | 5,085 | 5,281 |
| vct | 20 | 2,882 | 2,343 | 2,254 | 1,855 | 1,673 |
| vct | 22 | 4,881 | 4,051 | 3,834 | 3,299 | 3,298 |
| vct | 24 | 8,054 | 7,140 | 6,863 | 5,877 | 5,769 |

**2 스레드**

| 국면 | 깊이 | gomocalc/multi t2 | gomocalc/multi-relaxed t2 | rapfiweb/multi t2 |
|---|---|---|---|---|
| open-direct | 12 | 90 | 152 | 219 |
| open-direct | 14 | 918 | 1,214 | 488 |
| open-direct | 16 | 5,457 | 2,114 | 3,769 |
| open-indirect | 11 | 421 | 113 | 126 |
| open-indirect | 13 | 1,767 | 197 | 945 |
| open-indirect | 15 | 2,640 | 1,587 | 3,823 |
| midgame | 14 | 3,092 | 1,246 | 1,815 |
| midgame | 16 | 3,999 | 3,260 | 3,773 |
| midgame | 18 | 7,406 | 5,600 | 6,589 |
| vcf | 22 | 1,931 | 1,829 | 1,685 |
| vcf | 24 | 3,421 | 3,197 | 2,972 |
| vcf | 26 | 4,944 | 4,466 | 4,038 |
| vct | 21 | 2,370 | 2,834 | 1,864 |
| vct | 23 | 4,244 | 4,808 | 3,266 |
| vct | 25 | 7,931 | 8,361 | 5,708 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| gomocalc/single t1 | j10/j10 · -363±0 | i8/i8 · -268±14 | l9/l9 · 289±10 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi t1 | j10/j10 · -363±0 | i8/i8 · -255±0 | l9/l9 · 352±53 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi t2 | g7/g7 · -392±75 | i8/i8 · -300±29 | l9/l9 · 325±20 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi-relaxed t1 | j10/j10 · -363±0 | i8/i8 · -257±0 | k13/k13 · 582±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi-relaxed t2 | g7/g7 · -432±11 | i8/i8 · -266±11 | l9/l9 · +M47/+M49 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/single t1 | g7/g7 · -441±0 | i8/i8 · -294±0 | l9/l9 · 336±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/multi t1 | g7/g7 · -441±0 | i8/i8 · -278±0 | l9/l9 · 316±28 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/multi t2 | j10/g7 · -381±7 | i8/i8 · -300±13 | l9/l9 · +M43/318 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | g7 | 9/16 | j10×7 g7×9 |
| open-indirect | i8 | 16/16 | i8×16 |
| midgame | l9 | 14/16 | l9×14 k13×2 |
| vcf | i4 | 16/16 | i4×16 |
| vct | l12 | 16/16 | l12×16 |

