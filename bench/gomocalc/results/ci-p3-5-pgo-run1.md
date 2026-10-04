## 환경 — pgo-run1
- CPU: AMD EPYC 9V45 96-Core Processor · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1
- 측정 2026-10-04T03:51:34.248Z → 2026-10-04T03:54:59.548Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| rapfiweb-base/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 158 | 147 | 275 | — |
| rapfiweb-pgo/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 191 | 147 | 275 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| rapfiweb-base/single | open-direct | 3000 | 90.0K | 18-27 |
| rapfiweb-pgo/single | open-direct | 3000 | 120.5K | 18-24 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| rapfiweb-base/single | 1,777,751 | 344,339 | 138,088 | 7,170,518 | 20,824 | 2b7c7da9 |
| rapfiweb-pgo/single | 2,493,728 | 357,258 | 143,268 | 7,170,518 | 20,071 | 2b7c7da9 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| rapfiweb-base/single t1 | 130.0K | 108.7K | 270.8K | 270.1K | 216.7K | 186.2K |
| rapfiweb-pgo/single t1 | 120.9K | 105.6K | 261.9K | 254.9K | 213.0K | 178.6K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-base/single t1 | 18.0-24 | 19.0-38 | 24.5-49 | 26.0-9 | 29.0-17 |
| rapfiweb-pgo/single t1 | 18.0-24 | 19.0-38 | 24.0-51 | 26.0-9 | 29.0-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | rapfiweb-base/single t1 | rapfiweb-pgo/single t1 |
|---|---|---|---|
| open-direct | 14 | 366 | 383 |
| open-direct | 16 | 893 | 953 |
| open-direct | 18 | 1,038 | 1,117 |
| open-indirect | 15 | 759 | 787 |
| open-indirect | 17 | 1,019 | 1,052 |
| open-indirect | 19 | 8,308 | 8,551 |
| midgame | 20 | 4,695 | 4,835 |
| midgame | 22 | 6,780 | 7,041 |
| midgame | 24 | 7,476 | 7,780 |
| vcf | 22 | 532 | 566 |
| vcf | 24 | 917 | 980 |
| vcf | 26 | 1,264 | 1,339 |
| vct | 25 | 2,174 | 2,206 |
| vct | 27 | 4,043 | 4,130 |
| vct | 29 | 7,293 | 7,420 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-base/single t1 | g7/g7 · -352±0 | i8/i8 · -319±0 | k13/k13 · +M59/+M45 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-pgo/single t1 | g7/g7 · -352±0 | i8/i8 · -319±0 | k13/k13 · +M59/+M59 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | g7 | 4/4 | g7×4 |
| open-indirect | i8 | 4/4 | i8×4 |
| midgame | k13 | 4/4 | k13×4 |
| vcf | i4 | 4/4 | i4×4 |
| vct | l12 | 4/4 | l12×4 |

