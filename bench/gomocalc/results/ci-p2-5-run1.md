## 환경 — ci
- CPU: AMD EPYC 7763 64-Core Processor · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1/2
- 측정 2026-10-02T17:35:36.462Z → 2026-10-02T17:45:09.471Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| rapfiweb-base/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 279 | 147 | 275 | — |
| rapfiweb-base/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 274 | 149 | 215 | — |
| rapfiweb-patch/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 261 | 147 | 275 | — |
| rapfiweb-patch/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 238 | 149 | 215 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| rapfiweb-base/single | open-direct | 3000 | 81.8K | 18-27 |
| rapfiweb-base/multi | open-direct | 3000 | 82.9K | 18-27 |
| rapfiweb-patch/single | open-direct | 3000 | 83.1K | 18-27 |
| rapfiweb-patch/multi | open-direct | 3000 | 83.3K | 18-27 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| rapfiweb-base/single | 1,517,427 | 220,774 | 88,535 | 7,170,518 | 32,479 | 2b7c7da9 |
| rapfiweb-patch/single | 1,504,868 | 247,438 | 99,228 | 7,170,518 | 28,979 | 2b7c7da9 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| rapfiweb-base/single t1 | 97.4K | 67.8K | 174.6K | 177.1K | 144.9K | 124.2K |
| rapfiweb-base/multi t1 | 96.8K | 67.4K | 174.1K | 177.2K | 144.5K | 123.8K |
| rapfiweb-base/multi t2 | 114.5K | 76.1K | 190.5K | 215.1K | 174.3K | 144.1K |
| rapfiweb-patch/single t1 | 97.0K | 67.9K | 175.2K | 174.6K | 145.7K | 124.0K |
| rapfiweb-patch/multi t1 | 97.2K | 67.2K | 173.7K | 174.9K | 143.7K | 123.3K |
| rapfiweb-patch/multi t2 | 99.7K | 79.0K | 197.1K | 217.5K | 174.2K | 142.5K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-base/single t1 | 18.0-32 | 18.0-38 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t1 | 18.0-32 | 18.0-37 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t2 | 19.5-27 | 18.0-32 | 22.0-45 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/single t1 | 18.0-32 | 18.0-38 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t1 | 18.0-32 | 18.0-37 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t2 | 17.5-23 | 17.0-35 | 23.5-54 | 26.0-9 | 27.5-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | rapfiweb-base/single t1 | rapfiweb-base/multi t1 | rapfiweb-patch/single t1 | rapfiweb-patch/multi t1 |
|---|---|---|---|---|---|
| open-direct | 14 | 588 | 593 | 583 | 588 |
| open-direct | 16 | 1,407 | 1,415 | 1,404 | 1,406 |
| open-direct | 18 | 1,628 | 1,635 | 1,624 | 1,627 |
| open-indirect | 14 | 1,173 | 1,177 | 1,172 | 1,179 |
| open-indirect | 16 | 1,226 | 1,234 | 1,226 | 1,237 |
| open-indirect | 18 | 2,194 | 2,199 | 2,192 | 2,205 |
| midgame | 17 | 3,149 | 3,181 | 3,150 | 3,170 |
| midgame | 19 | 6,736 | 6,745 | 6,709 | 6,760 |
| midgame | 21 | 9,049 | 9,072 | 9,016 | 9,092 |
| vcf | 22 | 811 | 812 | 839 | 830 |
| vcf | 24 | 1,400 | 1,404 | 1,428 | 1,426 |
| vcf | 26 | 1,928 | 1,926 | 1,955 | 1,953 |
| vct | 24 | 2,379 | 2,382 | 2,359 | 2,399 |
| vct | 26 | 4,484 | 4,498 | 4,445 | 4,515 |
| vct | 28 | 8,133 | 8,152 | 8,084 | 8,197 |

**2 스레드**

| 국면 | 깊이 | rapfiweb-base/multi t2 | rapfiweb-patch/multi t2 |
|---|---|---|---|
| open-direct | 12 | 92 | 86 |
| open-direct | 14 | 403 | 1,693 |
| open-direct | 16 | 1,438 | 2,521 |
| open-indirect | 13 | 631 | 164 |
| open-indirect | 15 | 1,657 | 1,783 |
| open-indirect | 17 | 4,562 | 7,653 |
| midgame | 15 | 1,216 | 1,322 |
| midgame | 17 | 4,564 | 4,082 |
| midgame | 19 | 5,643 | 5,440 |
| vcf | 22 | 1,058 | 1,053 |
| vcf | 24 | 1,928 | 1,727 |
| vcf | 26 | 2,576 | 2,244 |
| vct | 23 | 2,236 | 2,376 |
| vct | 25 | 3,825 | 4,243 |
| vct | 27 | 6,652 | 7,587 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-base/single t1 | j10/j10 · -483±0 | i8/i8 · -331±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t1 | j10/j10 · -483±0 | i8/i8 · -292±39 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t2 | j10/g7 · -396±8 | i8/i8 · -255±5 | k13/l9 · +M35/+M47 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/single t1 | j10/j10 · -483±0 | i8/i8 · -331±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t1 | j10/j10 · -483±0 | i8/i8 · -292±39 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t2 | j10/g7 · -358±10 | i8/i8 · -285±44 | l9/k13 · +M51/+M53 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | j10 | 10/12 | j10×10 g7×2 |
| open-indirect | i8 | 12/12 | i8×12 |
| midgame | l9 | 10/12 | l9×10 k13×2 |
| vcf | i4 | 12/12 | i4×12 |
| vct | l12 | 12/12 | l12×12 |

