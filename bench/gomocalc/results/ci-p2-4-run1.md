## 환경 — ci
- CPU: AMD EPYC 7763 64-Core Processor · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1/2
- 측정 2026-10-03T02:47:41.593Z → 2026-10-03T02:57:22.263Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| rapfiweb-base/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 231 | 147 | 275 | — |
| rapfiweb-base/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 238 | 149 | 215 | — |
| rapfiweb-patch/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 242 | 147 | 275 | — |
| rapfiweb-patch/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 216 | 149 | 215 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| rapfiweb-base/single | open-direct | 3000 | 79.9K | 18-27 |
| rapfiweb-base/multi | open-direct | 3000 | 82.0K | 18-27 |
| rapfiweb-patch/single | open-direct | 3000 | 80.7K | 18-27 |
| rapfiweb-patch/multi | open-direct | 3000 | 82.3K | 18-27 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| rapfiweb-base/single | 1,507,136 | 219,161 | 87,888 | 7,170,518 | 32,718 | 2b7c7da9 |
| rapfiweb-patch/single | 1,498,104 | 242,698 | 97,327 | 7,170,518 | 29,545 | 2b7c7da9 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| rapfiweb-base/single t1 | 96.7K | 66.7K | 173.2K | 176.0K | 141.8K | 122.8K |
| rapfiweb-base/multi t1 | 95.9K | 67.0K | 171.8K | 176.6K | 143.7K | 122.9K |
| rapfiweb-base/multi t2 | 108.2K | 76.6K | 191.4K | 210.0K | 173.2K | 142.0K |
| rapfiweb-patch/single t1 | 95.8K | 66.6K | 170.2K | 173.7K | 143.6K | 122.1K |
| rapfiweb-patch/multi t1 | 96.2K | 67.2K | 172.3K | 175.9K | 143.9K | 123.0K |
| rapfiweb-patch/multi t2 | 107.0K | 76.7K | 187.3K | 215.6K | 174.0K | 142.0K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-base/single t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t2 | 18.5-25 | 17.5-38 | 18.5-49 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/single t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t2 | 18.0-37 | 18.0-34 | 23.0-44 | 26.0-9 | 27.5-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | rapfiweb-base/single t1 | rapfiweb-base/multi t1 | rapfiweb-patch/single t1 | rapfiweb-patch/multi t1 |
|---|---|---|---|---|---|
| open-direct | 14 | 592 | 591 | 594 | 613 |
| open-direct | 16 | 1,416 | 1,418 | 1,435 | 1,438 |
| open-direct | 18 | 1,637 | 1,644 | 1,661 | 1,662 |
| open-indirect | 14 | 1,205 | 1,184 | 1,192 | 1,184 |
| open-indirect | 16 | 1,259 | 1,241 | 1,247 | 1,241 |
| open-indirect | 18 | 2,238 | 2,224 | 2,234 | 2,208 |
| midgame | 17 | 3,170 | 3,222 | 3,274 | 3,204 |
| midgame | 19 | 6,768 | 6,829 | 6,932 | 6,823 |
| midgame | 21 | 9,120 | 9,193 | 9,282 | 9,166 |
| vcf | 22 | 809 | 818 | 814 | 820 |
| vcf | 24 | 1,405 | 1,408 | 1,423 | 1,418 |
| vcf | 26 | 1,939 | 1,932 | 1,965 | 1,941 |
| vct | 24 | 2,437 | 2,393 | 2,386 | 2,390 |
| vct | 26 | 4,597 | 4,507 | 4,497 | 4,489 |
| vct | 28 | 8,308 | 8,200 | 8,204 | 8,188 |

**2 스레드**

| 국면 | 깊이 | rapfiweb-base/multi t2 | rapfiweb-patch/multi t2 |
|---|---|---|---|
| open-direct | 14 | 272 | 815 |
| open-direct | 16 | 4,763 | 1,488 |
| open-direct | 18 | 5,352 | 8,107 |
| open-indirect | 13 | 429 | 451 |
| open-indirect | 15 | 3,556 | 1,016 |
| open-indirect | 17 | 7,097 | 7,440 |
| midgame | 14 | 939 | 931 |
| midgame | 16 | 3,897 | 1,990 |
| midgame | 18 | 6,881 | 3,870 |
| vcf | 22 | 1,071 | 1,069 |
| vcf | 24 | 1,784 | 1,847 |
| vcf | 26 | 2,607 | 2,693 |
| vct | 23 | 2,206 | 2,473 |
| vct | 25 | 3,820 | 4,442 |
| vct | 27 | 6,846 | 7,700 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-base/single t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t2 | g7/g7 · -397±5 | i8/j7 · -308±10 | k13/l9 · 939±366 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/single t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t2 | g7/j10 · -375±85 | i8/i8 · -293±33 | l9/l9 · +M45/1160 | k2/i4 · +M11/+M9 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | j10 | 9/12 | j10×9 g7×3 |
| open-indirect | i8 | 11/12 | i8×11 j7×1 |
| midgame | l9 | 11/12 | l9×11 k13×1 |
| vcf | i4 | 11/12 | i4×11 k2×1 |
| vct | l12 | 12/12 | l12×12 |

