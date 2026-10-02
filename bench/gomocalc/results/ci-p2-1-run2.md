## 환경 — ci
- CPU: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1/2
- 측정 2026-10-02T17:00:07.872Z → 2026-10-02T17:10:04.504Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| rapfiweb-patch/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 217 | 147 | 275 | — |
| rapfiweb-patch/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 275 | 149 | 215 | — |
| rapfiweb-base/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 260 | 147 | 275 | — |
| rapfiweb-base/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 233 | 149 | 215 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| rapfiweb-patch/single | open-direct | 3000 | 66.6K | 18-24 |
| rapfiweb-patch/multi | open-direct | 3000 | 67.3K | 18-24 |
| rapfiweb-base/single | open-direct | 3000 | 68.9K | 18-24 |
| rapfiweb-base/multi | open-direct | 3000 | 67.2K | 18-24 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| rapfiweb-patch/single | 1,547,964 | 195,777 | 78,511 | 7,170,518 | 36,626 | 2b7c7da9 |
| rapfiweb-base/single | 1,434,698 | 216,547 | 86,840 | 7,170,518 | 33,113 | 2b7c7da9 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| rapfiweb-patch/single t1 | 80.4K | 55.5K | 117.2K | 154.5K | 127.5K | 100.6K |
| rapfiweb-patch/multi t1 | 79.8K | 55.2K | 116.4K | 153.2K | 126.2K | 99.8K |
| rapfiweb-patch/multi t2 | 76.8K | 58.3K | 121.7K | 174.4K | 141.4K | 106.1K |
| rapfiweb-base/single t1 | 80.4K | 55.4K | 117.2K | 153.0K | 127.2K | 100.3K |
| rapfiweb-base/multi t1 | 80.0K | 55.4K | 116.8K | 154.2K | 128.1K | 100.4K |
| rapfiweb-base/multi t2 | 89.7K | 59.5K | 122.2K | 178.5K | 145.3K | 111.1K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-patch/single t1 | 18.0-31 | 18.0-36 | 19.0-34 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t1 | 18.0-31 | 18.0-36 | 19.0-34 | 26.0-9 | 28.0-17 |
| rapfiweb-patch/multi t2 | 17.5-30 | 18.0-37 | 18.0-32 | 26.0-9 | 27.0-17 |
| rapfiweb-base/single t1 | 18.0-31 | 18.0-36 | 19.0-34 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t1 | 18.0-31 | 18.0-36 | 19.0-34 | 26.0-9 | 28.0-17 |
| rapfiweb-base/multi t2 | 19.0-34 | 17.5-32 | 18.0-41 | 26.0-8 | 27.0-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | rapfiweb-patch/single t1 | rapfiweb-patch/multi t1 | rapfiweb-base/single t1 | rapfiweb-base/multi t1 |
|---|---|---|---|---|---|
| open-direct | 14 | 712 | 719 | 714 | 721 |
| open-direct | 16 | 1,704 | 1,751 | 1,710 | 1,722 |
| open-direct | 18 | 1,971 | 2,022 | 1,976 | 1,994 |
| open-indirect | 14 | 1,431 | 1,443 | 1,440 | 1,440 |
| open-indirect | 16 | 1,498 | 1,510 | 1,506 | 1,508 |
| open-indirect | 18 | 2,682 | 2,706 | 2,692 | 2,700 |
| midgame | 15 | 1,671 | 1,692 | 1,671 | 1,677 |
| midgame | 17 | 3,854 | 3,883 | 3,852 | 3,892 |
| midgame | 19 | 8,180 | 8,233 | 8,181 | 8,203 |
| vcf | 22 | 927 | 947 | 950 | 946 |
| vcf | 24 | 1,601 | 1,628 | 1,633 | 1,620 |
| vcf | 26 | 2,209 | 2,228 | 2,231 | 2,213 |
| vct | 24 | 2,679 | 2,737 | 2,698 | 2,703 |
| vct | 26 | 5,064 | 5,140 | 5,091 | 5,074 |
| vct | 28 | 9,242 | 9,338 | 9,264 | 9,199 |

**2 스레드**

| 국면 | 깊이 | rapfiweb-patch/multi t2 | rapfiweb-base/multi t2 |
|---|---|---|---|
| open-direct | 13 | 318 | 77 |
| open-direct | 15 | 989 | 2,799 |
| open-direct | 17 | 2,947 | 3,056 |
| open-indirect | 13 | 781 | 741 |
| open-indirect | 15 | 2,153 | 3,021 |
| open-indirect | 17 | 2,362 | 4,978 |
| midgame | 13 | 1,942 | 179 |
| midgame | 15 | 2,622 | 2,091 |
| midgame | 17 | 5,862 | 7,398 |
| vcf | 22 | 1,292 | 1,270 |
| vcf | 24 | 2,320 | 2,203 |
| vcf | 26 | 3,225 | 2,871 |
| vct | 23 | 2,986 | 2,809 |
| vct | 25 | 5,138 | 4,969 |
| vct | 27 | 8,553 | 8,848 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| rapfiweb-patch/single t1 | j10/j10 · -462±0 | i8/i8 · -275±0 | l9/l9 · 776±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t1 | j10/j10 · -462±0 | i8/i8 · -275±0 | l9/l9 · 776±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-patch/multi t2 | g7/j10 · -380±43 | i8/i8 · -275±25 | l9/l9 · 613±285 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/single t1 | j10/j10 · -462±0 | i8/i8 · -275±0 | l9/l9 · 776±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t1 | j10/j10 · -462±0 | i8/i8 · -275±0 | l9/l9 · 776±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-base/multi t2 | g7/g7 · -462±2 | i8/i8 · -264±28 | k13/k13 · 812±355 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | j10 | 9/12 | j10×9 g7×3 |
| open-indirect | i8 | 12/12 | i8×12 |
| midgame | l9 | 10/12 | l9×10 k13×2 |
| vcf | i4 | 12/12 | i4×12 |
| vct | l12 | 12/12 | l12×12 |

