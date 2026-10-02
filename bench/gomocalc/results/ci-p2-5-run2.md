## 환경 — ci
- CPU: AMD EPYC 7763 64-Core Processor · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1/2
- 측정 2026-10-02T17:36:04.294Z → 2026-10-02T17:45:49.289Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| rapfiweb-patch/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 252 | 147 | 275 | — |
| rapfiweb-patch/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 273 | 149 | 215 | — |
| rapfiweb-base/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 237 | 147 | 275 | — |
| rapfiweb-base/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 275 | 149 | 215 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| rapfiweb-patch/single | open-direct | 3000 | 76.8K | 18-27 |
| rapfiweb-patch/multi | open-direct | 3000 | 78.4K | 18-27 |
| rapfiweb-base/single | open-direct | 3000 | 79.7K | 18-27 |
| rapfiweb-base/multi | open-direct | 3000 | 81.8K | 18-27 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| rapfiweb-patch/single | 1,511,693 | 214,186 | 85,893 | 7,170,518 | 33,478 | 2b7c7da9 |
| rapfiweb-base/single | 1,516,277 | 238,247 | 95,542 | 7,170,518 | 30,097 | 2b7c7da9 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| rapfiweb-patch/single t1 | 94.6K | 63.8K | 165.1K | 165.7K | 139.2K | 118.1K |
| rapfiweb-patch/multi t1 | 94.0K | 65.1K | 162.9K | 158.0K | 134.8K | 116.2K |
| rapfiweb-patch/multi t2 | 109.2K | 70.8K | 141.0K | 198.8K | 164.4K | 128.9K |
| rapfiweb-base/single t1 | 94.2K | 65.4K | 165.9K | 172.0K | 140.2K | 119.8K |
| rapfiweb-base/multi t1 | 95.9K | 66.7K | 171.5K | 173.8K | 141.0K | 121.9K |
| rapfiweb-base/multi t2 | 105.0K | 76.2K | 174.1K | 208.2K | 167.6K | 137.2K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-patch/single t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t2 | 19.5-37 | 17.0-39 | 18.0-43 | 26.0-9 | 27.5-17 |
| rapfiweb-base/single t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t2 | 18.5-20 | 17.5-35 | 21.0-49 | 26.0-8 | 28.5-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | rapfiweb-patch/single t1 | rapfiweb-patch/multi t1 | rapfiweb-base/single t1 | rapfiweb-base/multi t1 |
|---|---|---|---|---|---|
| open-direct | 14 | 606 | 610 | 609 | 596 |
| open-direct | 16 | 1,458 | 1,484 | 1,449 | 1,424 |
| open-direct | 18 | 1,694 | 1,711 | 1,675 | 1,647 |
| open-indirect | 14 | 1,249 | 1,259 | 1,209 | 1,188 |
| open-indirect | 16 | 1,306 | 1,319 | 1,266 | 1,248 |
| open-indirect | 18 | 2,341 | 2,323 | 2,269 | 2,236 |
| midgame | 17 | 3,336 | 3,361 | 3,333 | 3,211 |
| midgame | 19 | 7,096 | 7,146 | 7,114 | 6,841 |
| midgame | 21 | 9,569 | 9,696 | 9,524 | 9,210 |
| vcf | 22 | 856 | 923 | 829 | 831 |
| vcf | 24 | 1,502 | 1,582 | 1,441 | 1,433 |
| vcf | 26 | 2,060 | 2,162 | 1,985 | 1,965 |
| vct | 24 | 2,438 | 2,513 | 2,454 | 2,448 |
| vct | 26 | 4,632 | 4,764 | 4,604 | 4,601 |
| vct | 28 | 8,465 | 8,744 | 8,407 | 8,356 |

**2 스레드**

| 국면 | 깊이 | rapfiweb-patch/multi t2 | rapfiweb-base/multi t2 |
|---|---|---|---|
| open-direct | 12 | 128 | 436 |
| open-direct | 14 | 175 | 461 |
| open-direct | 16 | 3,933 | 898 |
| open-indirect | 13 | 910 | 272 |
| open-indirect | 15 | 973 | 2,929 |
| open-indirect | 17 | 8,210 | 4,994 |
| midgame | 14 | 1,168 | 1,542 |
| midgame | 16 | 3,468 | 3,332 |
| midgame | 18 | 8,162 | 4,484 |
| vcf | 22 | 1,175 | 1,062 |
| vcf | 24 | 1,969 | 1,925 |
| vcf | 26 | 2,672 | 2,547 |
| vct | 23 | 2,219 | 2,026 |
| vct | 25 | 3,924 | 3,586 |
| vct | 27 | 6,889 | 6,253 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-patch/single t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t2 | g7/g7 · -400±18 | i8/i8 · -286±24 | l9/l9 · 870±142 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/single t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t2 | g7/j10 · -375±53 | i8/i8 · -275±21 | k13/k13 · +M43/+M49 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | j10 | 9/12 | j10×9 g7×3 |
| open-indirect | i8 | 12/12 | i8×12 |
| midgame | l9 | 10/12 | l9×10 k13×2 |
| vcf | i4 | 12/12 | i4×12 |
| vct | l12 | 12/12 | l12×12 |

