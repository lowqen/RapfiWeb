## 환경 — ci
- CPU: AMD EPYC 7763 64-Core Processor · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1/2
- 측정 2026-10-02T18:15:50.900Z → 2026-10-02T18:25:32.781Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| rapfiweb-base/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 257 | 147 | 275 | — |
| rapfiweb-base/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 262 | 149 | 215 | — |
| rapfiweb-patch/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 226 | 147 | 275 | — |
| rapfiweb-patch/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 216 | 149 | 215 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| rapfiweb-base/single | open-direct | 3000 | 80.0K | 18-27 |
| rapfiweb-base/multi | open-direct | 3000 | 79.7K | 18-27 |
| rapfiweb-patch/single | open-direct | 3000 | 79.7K | 18-27 |
| rapfiweb-patch/multi | open-direct | 3000 | 82.6K | 18-27 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| rapfiweb-base/single | 1,516,277 | 221,121 | 88,674 | 7,170,518 | 32,428 | 2b7c7da9 |
| rapfiweb-patch/single | 1,507,136 | 243,597 | 97,688 | 7,170,518 | 29,436 | 2b7c7da9 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| rapfiweb-base/single t1 | 96.7K | 66.9K | 170.3K | 174.0K | 141.3K | 122.0K |
| rapfiweb-base/multi t1 | 94.4K | 65.6K | 167.0K | 167.6K | 138.1K | 119.1K |
| rapfiweb-base/multi t2 | 106.6K | 76.3K | 180.4K | 199.3K | 166.2K | 137.2K |
| rapfiweb-patch/single t1 | 96.5K | 67.2K | 173.3K | 177.2K | 144.3K | 123.5K |
| rapfiweb-patch/multi t1 | 96.6K | 67.3K | 173.0K | 174.7K | 143.8K | 123.1K |
| rapfiweb-patch/multi t2 | 99.4K | 77.4K | 163.9K | 215.0K | 178.8K | 137.1K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-base/single t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t2 | 20.0-35 | 17.0-34 | 22.0-42 | 26.0-9 | 27.0-17 |
| rapfiweb-patch/single t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t2 | 19.0-29 | 17.5-34 | 19.0-53 | 26.0-8 | 27.5-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | rapfiweb-base/single t1 | rapfiweb-base/multi t1 | rapfiweb-patch/single t1 | rapfiweb-patch/multi t1 |
|---|---|---|---|---|---|
| open-direct | 14 | 585 | 607 | 599 | 595 |
| open-direct | 16 | 1,405 | 1,452 | 1,425 | 1,424 |
| open-direct | 18 | 1,629 | 1,680 | 1,646 | 1,646 |
| open-indirect | 14 | 1,182 | 1,205 | 1,180 | 1,188 |
| open-indirect | 16 | 1,236 | 1,263 | 1,234 | 1,246 |
| open-indirect | 18 | 2,218 | 2,259 | 2,206 | 2,221 |
| midgame | 17 | 3,240 | 3,278 | 3,188 | 3,207 |
| midgame | 19 | 6,900 | 6,990 | 6,788 | 6,794 |
| midgame | 21 | 9,277 | 9,458 | 9,116 | 9,132 |
| vcf | 22 | 819 | 863 | 811 | 827 |
| vcf | 24 | 1,424 | 1,484 | 1,403 | 1,422 |
| vcf | 26 | 1,962 | 2,037 | 1,926 | 1,955 |
| vct | 24 | 2,470 | 2,493 | 2,377 | 2,400 |
| vct | 26 | 4,611 | 4,690 | 4,482 | 4,505 |
| vct | 28 | 8,337 | 8,530 | 8,163 | 8,195 |

**2 스레드**

| 국면 | 깊이 | rapfiweb-base/multi t2 | rapfiweb-patch/multi t2 |
|---|---|---|---|
| open-direct | 12 | 158 | 92 |
| open-direct | 14 | 646 | 165 |
| open-direct | 16 | 1,742 | 1,089 |
| open-indirect | 13 | 571 | 466 |
| open-indirect | 15 | 2,878 | 2,782 |
| open-indirect | 17 | 5,972 | 3,715 |
| midgame | 14 | 2,120 | 694 |
| midgame | 16 | 3,662 | 1,961 |
| midgame | 18 | 5,138 | 6,690 |
| vcf | 22 | 1,083 | 1,051 |
| vcf | 24 | 1,889 | 1,789 |
| vcf | 26 | 2,563 | 2,258 |
| vct | 23 | 2,930 | 2,175 |
| vct | 25 | 4,933 | 3,810 |
| vct | 27 | 8,454 | 6,930 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-base/single t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t2 | g7/g7 · -434±12 | i8/i8 · -283±3 | l9/l9 · +M41/+M43 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/single t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t2 | g7/j10 · -365±40 | j7/i8 · -318±2 | l9/l9 · 801±239 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | j10 | 9/12 | j10×9 g7×3 |
| open-indirect | i8 | 11/12 | i8×11 j7×1 |
| midgame | l9 | 12/12 | l9×12 |
| vcf | i4 | 12/12 | i4×12 |
| vct | l12 | 12/12 | l12×12 |

