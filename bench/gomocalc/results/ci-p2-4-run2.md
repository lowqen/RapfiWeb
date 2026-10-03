## 환경 — ci
- CPU: AMD EPYC 9V74 80-Core Processor · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1/2
- 측정 2026-10-03T02:45:07.484Z → 2026-10-03T02:54:29.086Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| rapfiweb-patch/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 198 | 147 | 275 | — |
| rapfiweb-patch/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 215 | 149 | 215 | — |
| rapfiweb-base/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 198 | 147 | 275 | — |
| rapfiweb-base/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 199 | 149 | 215 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| rapfiweb-patch/single | open-direct | 3000 | 78.5K | 18-27 |
| rapfiweb-patch/multi | open-direct | 3000 | 98.0K | 18-31 |
| rapfiweb-base/single | open-direct | 3000 | 99.0K | 18-31 |
| rapfiweb-base/multi | open-direct | 3000 | 92.8K | 18-24 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| rapfiweb-patch/single | 1,136,346 | 270,351 | 108,417 | 7,170,518 | 26,523 | 2b7c7da9 |
| rapfiweb-base/single | 1,869,130 | 288,784 | 115,809 | 7,170,518 | 24,830 | 2b7c7da9 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| rapfiweb-patch/single t1 | 96.1K | 80.6K | 193.4K | 201.7K | 162.2K | 137.4K |
| rapfiweb-patch/multi t1 | 95.2K | 80.9K | 201.0K | 203.6K | 170.5K | 140.0K |
| rapfiweb-patch/multi t2 | 128.6K | 88.4K | 213.1K | 252.4K | 206.0K | 166.0K |
| rapfiweb-base/single t1 | 96.4K | 79.5K | 199.5K | 202.8K | 170.0K | 139.4K |
| rapfiweb-base/multi t1 | 97.6K | 81.7K | 202.3K | 207.2K | 171.1K | 141.7K |
| rapfiweb-base/multi t2 | 114.3K | 82.7K | 195.1K | 249.1K | 205.2K | 156.6K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-patch/single t1 | 18.0-24 | 18.0-38 | 21.0-41 | 26.0-9 | 29.0-17 |
| rapfiweb-patch/multi t1 | 18.0-24 | 18.0-38 | 21.0-41 | 26.0-9 | 29.0-17 |
| rapfiweb-patch/multi t2 | 17.0-35 | 17.0-38 | 24.5-45 | 26.0-9 | 28.5-17 |
| rapfiweb-base/single t1 | 18.0-24 | 18.0-38 | 21.0-41 | 26.0-9 | 29.0-17 |
| rapfiweb-base/multi t1 | 18.0-24 | 18.0-38 | 21.0-41 | 26.0-9 | 29.0-17 |
| rapfiweb-base/multi t2 | 18.5-22 | 17.0-35 | 20.0-51 | 26.0-9 | 28.0-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | rapfiweb-patch/single t1 | rapfiweb-patch/multi t1 | rapfiweb-base/single t1 | rapfiweb-base/multi t1 |
|---|---|---|---|---|---|
| open-direct | 14 | 507 | 508 | 508 | 498 |
| open-direct | 16 | 1,210 | 1,222 | 1,210 | 1,195 |
| open-direct | 18 | 1,403 | 1,417 | 1,399 | 1,382 |
| open-indirect | 14 | 1,006 | 1,010 | 1,032 | 1,001 |
| open-indirect | 16 | 1,052 | 1,060 | 1,078 | 1,048 |
| open-indirect | 18 | 1,906 | 1,897 | 1,924 | 1,873 |
| midgame | 17 | 2,844 | 2,749 | 2,753 | 2,743 |
| midgame | 19 | 6,079 | 5,853 | 5,894 | 5,840 |
| midgame | 21 | 8,166 | 7,859 | 7,920 | 7,807 |
| vcf | 22 | 716 | 703 | 713 | 693 |
| vcf | 24 | 1,234 | 1,224 | 1,227 | 1,200 |
| vcf | 26 | 1,693 | 1,677 | 1,683 | 1,648 |
| vct | 25 | 2,955 | 2,814 | 2,821 | 2,806 |
| vct | 27 | 5,469 | 5,202 | 5,220 | 5,181 |
| vct | 29 | 9,745 | 9,270 | 9,299 | 9,239 |

**2 스레드**

| 국면 | 깊이 | rapfiweb-patch/multi t2 | rapfiweb-base/multi t2 |
|---|---|---|---|
| open-direct | 12 | 133 | 420 |
| open-direct | 14 | 1,125 | 1,089 |
| open-direct | 16 | 4,508 | 1,440 |
| open-indirect | 12 | 340 | 137 |
| open-indirect | 14 | 402 | 713 |
| open-indirect | 16 | 2,834 | 1,533 |
| midgame | 16 | 3,252 | 2,507 |
| midgame | 18 | 4,893 | 5,559 |
| midgame | 20 | 5,607 | 8,766 |
| vcf | 22 | 919 | 858 |
| vcf | 24 | 1,678 | 1,492 |
| vcf | 26 | 2,303 | 2,105 |
| vct | 24 | 2,294 | 2,645 |
| vct | 26 | 4,129 | 4,938 |
| vct | 28 | 7,264 | 8,488 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-patch/single t1 | g7/g7 · -352±0 | i8/i8 · -282±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t1 | g7/g7 · -352±0 | i8/i8 · -282±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t2 | g7/g7 · -358±13 | i8/j7 · -299±5 | l9/k13 · +M49/+M45 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/single t1 | g7/g7 · -352±0 | i8/i8 · -306±25 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t1 | g7/g7 · -352±0 | i8/i8 · -282±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t2 | j10/j8 · -371±19 | i8/i8 · -302±18 | l9/l9 · +M51/787 | i4/k2 · +M9/+M11 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | g7 | 10/12 | g7×10 j10×1 j8×1 |
| open-indirect | i8 | 11/12 | i8×11 j7×1 |
| midgame | l9 | 11/12 | l9×11 k13×1 |
| vcf | i4 | 11/12 | i4×11 k2×1 |
| vct | l12 | 12/12 | l12×12 |

