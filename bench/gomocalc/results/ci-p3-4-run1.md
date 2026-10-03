## 환경 — ci
- CPU: AMD EPYC 7763 64-Core Processor · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 4 · 해시 128MB · 스레드 1/2
- 측정 2026-10-03T12:09:39.181Z → 2026-10-03T12:20:40.716Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| rapfiweb-base/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 205 | 149 | 215 | — |
| rapfiweb-patch/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 221 | 149 | 215 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| rapfiweb-base/multi | open-direct | 3000 | 77.7K | 18-27 |
| rapfiweb-patch/multi | open-direct | 3000 | 82.3K | 18-27 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| rapfiweb-base/multi t1 | 83.9K | 66.3K | 170.1K | 171.4K | 141.6K | 118.1K |
| rapfiweb-base/multi t2 | 99.7K | 74.8K | 164.1K | 213.8K | 170.2K | 134.8K |
| rapfiweb-patch/multi t1 | 95.3K | 67.1K | 173.8K | 175.9K | 145.6K | 123.3K |
| rapfiweb-patch/multi t2 | 103.0K | 75.0K | 186.3K | 217.9K | 173.6K | 140.4K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-base/multi t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t2 | 18.5-26 | 17.5-33 | 21.0-41 | 26.0-9 | 27.8-17 |
| rapfiweb-patch/multi t1 | 18.0-32 | 18.0-37 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t2 | 18.5-26 | 16.5-37 | 21.8-49 | 26.0-8 | 27.3-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | rapfiweb-base/multi t1 | rapfiweb-patch/multi t1 |
|---|---|---|---|
| open-direct | 14 | 717 | 600 |
| open-direct | 16 | 1,724 | 1,427 |
| open-direct | 18 | 1,996 | 1,650 |
| open-indirect | 14 | 1,200 | 1,187 |
| open-indirect | 16 | 1,256 | 1,243 |
| open-indirect | 18 | 2,249 | 2,216 |
| midgame | 17 | 3,273 | 3,164 |
| midgame | 19 | 6,918 | 6,750 |
| midgame | 21 | 9,287 | 9,091 |
| vcf | 22 | 847 | 826 |
| vcf | 24 | 1,455 | 1,415 |
| vcf | 26 | 1,992 | 1,941 |
| vct | 24 | 2,443 | 2,363 |
| vct | 26 | 4,594 | 4,449 |
| vct | 28 | 8,325 | 8,090 |

**2 스레드**

| 국면 | 깊이 | rapfiweb-base/multi t2 | rapfiweb-patch/multi t2 |
|---|---|---|---|
| open-direct | 14 | 124 | 1,049 |
| open-direct | 16 | 1,044 | 2,228 |
| open-direct | 18 | 1,628 | 5,238 |
| open-indirect | 11 | 42 | 70 |
| open-indirect | 13 | 587 | 272 |
| open-indirect | 15 | 1,347 | 2,031 |
| midgame | 13 | 527 | 873 |
| midgame | 15 | 1,472 | 1,092 |
| midgame | 17 | 3,236 | 3,678 |
| vcf | 22 | 1,011 | 1,038 |
| vcf | 24 | 1,850 | 1,800 |
| vcf | 26 | 2,576 | 2,349 |
| vct | 23 | 2,279 | 2,408 |
| vct | 25 | 3,978 | 4,419 |
| vct | 27 | 7,068 | 7,784 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-base/multi t1 | g7/j10/j10/j10 · -454±39 | i8/i8/i8/i8 · -254±0 | l9/l9/l9/l9 · 542±0 | i4/i4/i4/i4 · +M9/+M9/+M9/+M9 | l12/l12/l12/l12 · +M19/+M19/+M19/+M19 |
| rapfiweb-base/multi t2 | g7/j8/g7/j10 · -363±44 | i8/i8/i8/i8 · -279±18 | l9/l9/k13/k13 · 494/422/+M43/+M43 | i4/i4/k2/i4 · +M9/+M9/+M11/+M9 | l12/l12/l12/l12 · +M19/+M19/+M19/+M19 |
| rapfiweb-patch/multi t1 | j10/j10/j10/j10 · -483±0 | i8/i8/i8/i8 · -273±33 | l9/l9/l9/l9 · 542±0 | i4/i4/i4/i4 · +M9/+M9/+M9/+M9 | l12/l12/l12/l12 · +M19/+M19/+M19/+M19 |
| rapfiweb-patch/multi t2 | j10/j10/g7/g7 · -401±52 | i8/i8/j7/i8 · -294±35 | k13/l9/l9/l9 · +M41/+M49/519/+M55 | i4/i4/i4/i4 · +M9/+M9/+M9/+M9 | l12/l12/l12/l12 · +M19/+M19/+M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | j10 | 10/16 | g7×5 j10×10 j8×1 |
| open-indirect | i8 | 15/16 | i8×15 j7×1 |
| midgame | l9 | 13/16 | l9×13 k13×3 |
| vcf | i4 | 15/16 | i4×15 k2×1 |
| vct | l12 | 16/16 | l12×16 |

