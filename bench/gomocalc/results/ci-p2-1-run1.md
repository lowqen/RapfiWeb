## 환경 — ci
- CPU: Intel(R) Xeon(R) 6973P-C · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1/2
- 측정 2026-10-02T16:57:10.934Z → 2026-10-02T17:06:20.533Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| rapfiweb-base/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 163 | 147 | 275 | — |
| rapfiweb-base/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 187 | 149 | 215 | — |
| rapfiweb-patch/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 247 | 147 | 275 | — |
| rapfiweb-patch/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 192 | 149 | 215 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| rapfiweb-base/single | open-direct | 3000 | 79.2K | 18-27 |
| rapfiweb-base/multi | open-direct | 3000 | 98.1K | 18-24 |
| rapfiweb-patch/single | open-direct | 3000 | 96.4K | 18-24 |
| rapfiweb-patch/multi | open-direct | 3000 | 98.4K | 18-24 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| rapfiweb-base/single | 1,555,186 | 303,836 | 121,845 | 7,170,518 | 23,600 | 2b7c7da9 |
| rapfiweb-patch/single | 2,699,014 | 319,399 | 128,086 | 7,170,518 | 22,450 | 2b7c7da9 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| rapfiweb-base/single t1 | 104.0K | 88.5K | 221.9K | 225.5K | 180.4K | 152.7K |
| rapfiweb-base/multi t1 | 101.3K | 87.0K | 222.1K | 221.4K | 185.0K | 151.6K |
| rapfiweb-base/multi t2 | 140.7K | 96.4K | 222.7K | 272.9K | 228.2K | 179.8K |
| rapfiweb-patch/single t1 | 104.0K | 86.6K | 220.9K | 225.9K | 179.8K | 151.9K |
| rapfiweb-patch/multi t1 | 98.9K | 87.6K | 213.5K | 220.6K | 182.8K | 149.5K |
| rapfiweb-patch/multi t2 | 131.5K | 99.2K | 239.4K | 278.6K | 223.5K | 181.0K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-base/single t1 | 18.0-24 | 18.0-38 | 22.0-35 | 26.0-9 | 29.0-17 |
| rapfiweb-base/multi t1 | 18.0-24 | 18.0-38 | 22.0-35 | 26.0-9 | 29.0-17 |
| rapfiweb-base/multi t2 | 19.5-28 | 17.5-37 | 21.0-36 | 26.0-8 | 28.5-17 |
| rapfiweb-patch/single t1 | 18.0-24 | 18.0-38 | 22.0-35 | 26.0-9 | 29.0-17 |
| rapfiweb-patch/multi t1 | 18.0-24 | 18.0-38 | 21.5-38 | 26.0-9 | 29.0-17 |
| rapfiweb-patch/multi t2 | 19.5-20 | 17.0-35 | 23.0-41 | 26.0-8 | 28.5-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | rapfiweb-base/single t1 | rapfiweb-base/multi t1 | rapfiweb-patch/single t1 | rapfiweb-patch/multi t1 |
|---|---|---|---|---|---|
| open-direct | 14 | 463 | 470 | 476 | 495 |
| open-direct | 16 | 1,119 | 1,153 | 1,124 | 1,179 |
| open-direct | 18 | 1,297 | 1,332 | 1,297 | 1,365 |
| open-indirect | 14 | 946 | 937 | 955 | 947 |
| open-indirect | 16 | 988 | 982 | 997 | 991 |
| open-indirect | 18 | 1,758 | 1,758 | 1,762 | 1,766 |
| midgame | 17 | 2,613 | 2,566 | 2,577 | 2,650 |
| midgame | 19 | 5,516 | 5,479 | 5,474 | 5,588 |
| midgame | 21 | 7,330 | 7,298 | 7,332 | 7,458 |
| vcf | 22 | 636 | 658 | 634 | 669 |
| vcf | 24 | 1,105 | 1,127 | 1,095 | 1,136 |
| vcf | 26 | 1,514 | 1,542 | 1,511 | 1,548 |
| vct | 25 | 2,622 | 2,610 | 2,643 | 2,609 |
| vct | 27 | 4,846 | 4,785 | 4,875 | 4,848 |
| vct | 29 | 8,761 | 8,545 | 8,801 | 8,646 |

**2 스레드**

| 국면 | 깊이 | rapfiweb-base/multi t2 | rapfiweb-patch/multi t2 |
|---|---|---|---|
| open-direct | 14 | 675 | 235 |
| open-direct | 16 | 2,526 | 2,158 |
| open-direct | 18 | 2,886 | 2,494 |
| open-indirect | 13 | 137 | 74 |
| open-indirect | 15 | 527 | 1,846 |
| open-indirect | 17 | 3,577 | 6,885 |
| midgame | 14 | 1,080 | 752 |
| midgame | 16 | 4,180 | 3,067 |
| midgame | 18 | 5,897 | 5,827 |
| vcf | 22 | 849 | 808 |
| vcf | 24 | 1,486 | 1,343 |
| vcf | 26 | 1,940 | 1,816 |
| vct | 24 | 2,418 | 2,254 |
| vct | 26 | 4,365 | 4,524 |
| vct | 28 | 7,913 | 7,570 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-base/single t1 | g7/g7 · -352±0 | i8/i8 · -319±0 | k13/k13 · 1024±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t1 | g7/g7 · -352±0 | i8/i8 · -300±19 | k13/k13 · 1024±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t2 | g7/g7 · -399±29 | i8/i8 · -300±12 | k13/l9 · +M53/+M39 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/single t1 | g7/g7 · -352±0 | i8/i8 · -282±0 | k13/k13 · 1024±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t1 | g7/g7 · -352±0 | i8/i8 · -282±0 | k13/l9 · 783±241 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t2 | g7/g7 · -372±30 | j7/i8 · -303±27 | k13/l9 · +M41/+M43 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | g7 | 12/12 | g7×12 |
| open-indirect | i8 | 11/12 | i8×11 j7×1 |
| midgame | k13 | 9/12 | k13×9 l9×3 |
| vcf | i4 | 12/12 | i4×12 |
| vct | l12 | 12/12 | l12×12 |

