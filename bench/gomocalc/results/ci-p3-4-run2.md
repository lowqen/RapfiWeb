## 환경 — ci
- CPU: AMD EPYC 9V74 80-Core Processor · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 4 · 해시 128MB · 스레드 1/2
- 측정 2026-10-03T12:06:40.447Z → 2026-10-03T12:17:30.273Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| rapfiweb-patch/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 113 | 149 | 215 | — |
| rapfiweb-base/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 170 | 149 | 215 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| rapfiweb-patch/multi | open-direct | 3000 | 97.9K | 18-31 |
| rapfiweb-base/multi | open-direct | 3000 | 99.0K | 18-31 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| rapfiweb-patch/multi t1 | 91.0K | 81.2K | 200.9K | 205.2K | 169.0K | 138.8K |
| rapfiweb-patch/multi t2 | 120.2K | 88.8K | 210.8K | 256.4K | 209.9K | 164.7K |
| rapfiweb-base/multi t1 | 97.9K | 84.0K | 208.9K | 213.7K | 175.2K | 145.1K |
| rapfiweb-base/multi t2 | 121.5K | 88.8K | 217.2K | 252.9K | 208.1K | 165.3K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-patch/multi t1 | 18.0-26 | 18.0-38 | 21.0-41 | 26.0-9 | 29.0-17 |
| rapfiweb-patch/multi t2 | 18.8-22 | 17.5-37 | 23.0-40 | 26.0-9 | 28.3-17 |
| rapfiweb-base/multi t1 | 18.0-24 | 18.0-38 | 21.0-41 | 26.0-9 | 29.0-17 |
| rapfiweb-base/multi t2 | 19.0-33 | 17.8-36 | 23.3-49 | 26.0-9 | 28.0-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | rapfiweb-patch/multi t1 | rapfiweb-base/multi t1 |
|---|---|---|---|
| open-direct | 14 | 537 | 495 |
| open-direct | 16 | 1,384 | 1,191 |
| open-direct | 18 | 1,612 | 1,378 |
| open-indirect | 14 | 1,004 | 983 |
| open-indirect | 16 | 1,051 | 1,029 |
| open-indirect | 18 | 1,877 | 1,839 |
| midgame | 17 | 2,733 | 2,654 |
| midgame | 19 | 5,867 | 5,636 |
| midgame | 21 | 7,863 | 7,562 |
| vcf | 22 | 710 | 676 |
| vcf | 24 | 1,217 | 1,165 |
| vcf | 26 | 1,664 | 1,597 |
| vct | 25 | 2,825 | 2,733 |
| vct | 27 | 5,204 | 5,048 |
| vct | 29 | 9,355 | 9,023 |

**2 스레드**

| 국면 | 깊이 | rapfiweb-patch/multi t2 | rapfiweb-base/multi t2 |
|---|---|---|---|
| open-direct | 13 | 418 | 432 |
| open-direct | 15 | 1,774 | 796 |
| open-direct | 17 | 3,340 | 1,603 |
| open-indirect | 12 | 205 | 143 |
| open-indirect | 14 | 1,478 | 1,439 |
| open-indirect | 16 | 3,564 | 3,833 |
| midgame | 15 | 1,214 | 1,323 |
| midgame | 17 | 2,694 | 3,483 |
| midgame | 19 | 5,907 | 6,077 |
| vcf | 22 | 873 | 890 |
| vcf | 24 | 1,572 | 1,555 |
| vcf | 26 | 2,079 | 2,107 |
| vct | 24 | 2,491 | 2,718 |
| vct | 26 | 4,507 | 4,792 |
| vct | 28 | 7,955 | 8,538 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-patch/multi t1 | j10/g7/g7/g7 · -379±48 | i8/i8/i8/i8 · -282±0 | l9/l9/l9/l9 · 542±0 | i4/i4/i4/i4 · +M9/+M9/+M9/+M9 | l12/l12/l12/l12 · +M19/+M19/+M19/+M19 |
| rapfiweb-patch/multi t2 | g7/g7/j10/j10 · -404±35 | i8/i8/i8/i8 · -307±23 | l9/l9/k13/l9 · +M39/+M39/886/+M41 | i4/i4/i4/i4 · +M9/+M9/+M9/+M9 | l12/l12/l12/l12 · +M19/+M19/+M19/+M19 |
| rapfiweb-base/multi t1 | g7/g7/g7/g7 · -352±0 | i8/i8/i8/i8 · -282±0 | l9/l9/l9/l9 · 542±0 | i4/i4/i4/i4 · +M9/+M9/+M9/+M9 | l12/l12/l12/l12 · +M19/+M19/+M19/+M19 |
| rapfiweb-base/multi t2 | j10/g7/g7/g7 · -381±29 | i8/i8/i8/i8 · -297±22 | l9/l9/k13/l9 · +M45/+M43/+M41/473 | i4/i4/i4/i4 · +M9/+M9/+M9/+M9 | l12/l12/l12/l12 · +M19/+M19/+M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | g7 | 12/16 | j10×4 g7×12 |
| open-indirect | i8 | 16/16 | i8×16 |
| midgame | l9 | 14/16 | l9×14 k13×2 |
| vcf | i4 | 16/16 | i4×16 |
| vct | l12 | 16/16 | l12×16 |

