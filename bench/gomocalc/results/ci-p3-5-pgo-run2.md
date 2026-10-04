## 환경 — pgo-run2
- CPU: AMD EPYC 9V45 96-Core Processor · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1
- 측정 2026-10-04T03:54:59.830Z → 2026-10-04T03:58:17.838Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| rapfiweb-pgo/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 155 | 147 | 275 | — |
| rapfiweb-base/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 165 | 147 | 275 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| rapfiweb-pgo/single | open-direct | 3000 | 113.5K | 18-24 |
| rapfiweb-base/single | open-direct | 3000 | 111.7K | 18-24 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| rapfiweb-pgo/single | 2,447,943 | 361,672 | 145,039 | 7,170,518 | 19,826 | 2b7c7da9 |
| rapfiweb-base/single | 2,659,534 | 357,382 | 143,318 | 7,170,518 | 20,064 | 2b7c7da9 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| rapfiweb-pgo/single t1 | 122.6K | 109.5K | 270.3K | 262.6K | 216.8K | 183.2K |
| rapfiweb-base/single t1 | 120.4K | 106.6K | 267.8K | 249.7K | 209.8K | 178.3K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-pgo/single t1 | 18.0-24 | 19.0-38 | 24.0-51 | 26.0-9 | 29.0-17 |
| rapfiweb-base/single t1 | 18.0-24 | 19.0-38 | 24.0-51 | 26.0-9 | 29.0-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | rapfiweb-pgo/single t1 | rapfiweb-base/single t1 |
|---|---|---|---|
| open-direct | 14 | 385 | 402 |
| open-direct | 16 | 961 | 952 |
| open-direct | 18 | 1,100 | 1,125 |
| open-indirect | 15 | 752 | 774 |
| open-indirect | 17 | 1,006 | 1,040 |
| open-indirect | 19 | 8,249 | 8,471 |
| midgame | 20 | 4,680 | 4,721 |
| midgame | 22 | 6,821 | 6,900 |
| midgame | 24 | 7,539 | 7,609 |
| vcf | 22 | 553 | 568 |
| vcf | 24 | 950 | 1,005 |
| vcf | 26 | 1,300 | 1,367 |
| vct | 25 | 2,180 | 2,367 |
| vct | 27 | 4,024 | 4,289 |
| vct | 29 | 7,291 | 7,536 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-pgo/single t1 | g7/g7 · -352±0 | i8/i8 · -319±0 | k13/k13 · +M59/+M59 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/single t1 | g7/g7 · -352±0 | i8/i8 · -319±0 | k13/k13 · +M59/+M59 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | g7 | 4/4 | g7×4 |
| open-indirect | i8 | 4/4 | i8×4 |
| midgame | k13 | 4/4 | k13×4 |
| vcf | i4 | 4/4 | i4×4 |
| vct | l12 | 4/4 | l12×4 |

