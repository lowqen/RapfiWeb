## 환경 — ci
- CPU: AMD EPYC 7763 64-Core Processor · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1/2
- 측정 2026-10-02T18:15:58.799Z → 2026-10-02T18:25:39.926Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| rapfiweb-patch/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 241 | 147 | 275 | — |
| rapfiweb-patch/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 244 | 149 | 215 | — |
| rapfiweb-base/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 237 | 147 | 275 | — |
| rapfiweb-base/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 253 | 149 | 215 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| rapfiweb-patch/single | open-direct | 3000 | 78.8K | 18-27 |
| rapfiweb-patch/multi | open-direct | 3000 | 82.9K | 18-27 |
| rapfiweb-base/single | open-direct | 3000 | 83.1K | 18-27 |
| rapfiweb-base/multi | open-direct | 3000 | 82.3K | 18-27 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| rapfiweb-patch/single | 1,120,431 | 222,259 | 89,131 | 7,170,518 | 32,262 | 2b7c7da9 |
| rapfiweb-base/single | 1,524,367 | 247,242 | 99,150 | 7,170,518 | 29,002 | 2b7c7da9 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| rapfiweb-patch/single t1 | 96.9K | 67.6K | 174.8K | 176.5K | 144.6K | 123.9K |
| rapfiweb-patch/multi t1 | 96.7K | 67.2K | 175.2K | 178.4K | 145.3K | 124.2K |
| rapfiweb-patch/multi t2 | 97.9K | 80.9K | 166.4K | 213.8K | 169.3K | 136.7K |
| rapfiweb-base/single t1 | 96.8K | 66.8K | 170.3K | 172.4K | 142.6K | 122.0K |
| rapfiweb-base/multi t1 | 94.5K | 66.1K | 168.3K | 170.5K | 141.1K | 120.4K |
| rapfiweb-base/multi t2 | 113.0K | 77.0K | 174.9K | 212.9K | 170.4K | 140.7K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-patch/single t1 | 18.0-32 | 18.0-37 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t1 | 18.0-32 | 18.0-37 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t2 | 17.0-26 | 17.0-34 | 21.0-30 | 26.0-9 | 28.5-17 |
| rapfiweb-base/single t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t1 | 18.0-32 | 18.0-36 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t2 | 19.0-31 | 18.0-31 | 21.5-58 | 26.0-9 | 27.5-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | rapfiweb-patch/single t1 | rapfiweb-patch/multi t1 | rapfiweb-base/single t1 | rapfiweb-base/multi t1 |
|---|---|---|---|---|---|
| open-direct | 14 | 586 | 594 | 592 | 610 |
| open-direct | 16 | 1,409 | 1,419 | 1,418 | 1,454 |
| open-direct | 18 | 1,632 | 1,639 | 1,640 | 1,680 |
| open-indirect | 14 | 1,169 | 1,190 | 1,183 | 1,195 |
| open-indirect | 16 | 1,223 | 1,247 | 1,238 | 1,255 |
| open-indirect | 18 | 2,189 | 2,225 | 2,213 | 2,254 |
| midgame | 17 | 3,147 | 3,149 | 3,232 | 3,285 |
| midgame | 19 | 6,711 | 6,710 | 6,890 | 6,978 |
| midgame | 21 | 9,035 | 9,016 | 9,274 | 9,384 |
| vcf | 22 | 798 | 807 | 832 | 847 |
| vcf | 24 | 1,389 | 1,395 | 1,441 | 1,465 |
| vcf | 26 | 1,934 | 1,913 | 1,981 | 2,002 |
| vct | 24 | 2,364 | 2,385 | 2,406 | 2,437 |
| vct | 26 | 4,464 | 4,465 | 4,527 | 4,570 |
| vct | 28 | 8,147 | 8,107 | 8,264 | 8,353 |

**2 스레드**

| 국면 | 깊이 | rapfiweb-patch/multi t2 | rapfiweb-base/multi t2 |
|---|---|---|---|
| open-direct | 12 | 60 | 181 |
| open-direct | 14 | 1,069 | 1,387 |
| open-direct | 16 | 2,460 | 2,801 |
| open-indirect | 13 | 364 | 173 |
| open-indirect | 15 | 1,284 | 2,573 |
| open-indirect | 17 | 8,458 | 4,714 |
| midgame | 16 | 4,521 | 2,212 |
| midgame | 18 | 5,612 | 3,948 |
| midgame | 20 | 7,386 | 8,163 |
| vcf | 22 | 1,018 | 1,043 |
| vcf | 24 | 1,812 | 1,922 |
| vcf | 26 | 2,508 | 2,630 |
| vct | 23 | 1,836 | 2,241 |
| vct | 25 | 3,275 | 4,331 |
| vct | 27 | 6,074 | 7,505 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-patch/single t1 | j10/j10 · -483±0 | i8/i8 · -292±39 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t1 | j10/j10 · -483±0 | i8/i8 · -292±39 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t2 | j10/g7 · -373±4 | i8/i8 · -278±17 | l9/l9 · +M45/1265 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/single t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t1 | j10/j10 · -483±0 | i8/i8 · -254±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t2 | j10/g7 · -437±13 | i8/i8 · -324±8 | l9/l9 · 462/+M55 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | j10 | 10/12 | j10×10 g7×2 |
| open-indirect | i8 | 12/12 | i8×12 |
| midgame | l9 | 12/12 | l9×12 |
| vcf | i4 | 12/12 | i4×12 |
| vct | l12 | 12/12 | l12×12 |

