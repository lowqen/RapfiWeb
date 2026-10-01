## 환경 — ci
- CPU: AMD EPYC 9V74 80-Core Processor · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1/2
- 측정 2026-10-01T14:37:26.838Z → 2026-10-01T14:55:30.817Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| gomocalc/single | 0.43.01 (clang++ 21.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 387 | 153 | 220 | — |
| gomocalc/multi | 0.43.01 (clang++ 21.0.0 on Wasm WASM_SIMD) | main-thread | 424 | 155 | 223 | — |
| gomocalc/multi-relaxed | 0.43.01 (clang++ 21.0.0 on Wasm WASM_SIMD_RELAXED) | main-thread | 469 | 155 | 223 | — |
| rapfiweb/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 283 | 147 | 275 | — |
| rapfiweb/single-relaxed | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD_RELAXED SINGLE_THREAD) | worker | 275 | 147 | 212 | — |
| rapfiweb/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 195 | 149 | 215 | — |
| rapfiweb/multi-relaxed | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD_RELAXED) | main-thread | 215 | 149 | 277 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| gomocalc/single | open-direct | 3000 | 79.5K | 16-49 |
| gomocalc/multi | open-direct | 3000 | 82.2K | 16-49 |
| gomocalc/multi-relaxed | open-direct | 3000 | 99.5K | 16-32 |
| rapfiweb/single | open-direct | 3000 | 74.6K | 18-27 |
| rapfiweb/single-relaxed | open-direct | 3000 | 94.5K | 18-31 |
| rapfiweb/multi | open-direct | 3000 | 74.3K | 18-27 |
| rapfiweb/multi-relaxed | open-direct | 3000 | 93.9K | 18-31 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| gomocalc/single | 1,086,940 | 54,659 | 54,659 | 3,628,934 | 66,392 | 662ab34c |
| gomocalc/multi-relaxed | 1,075,252 | 78,547 | 78,546 | 3,628,934 | 46,201 | 662ab34c |
| rapfiweb/single | 1,430,593 | 221,545 | 88,844 | 7,170,518 | 32,366 | 2b7c7da9 |
| rapfiweb/multi-relaxed | 1,305,463 | 252,474 | 101,248 | 7,170,518 | 28,401 | 2b7c7da9 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| gomocalc/single t1 | 90.7K | 60.1K | 136.0K | 153.4K | 124.8K | 107.3K |
| gomocalc/multi t1 | 90.8K | 61.6K | 138.5K | 152.6K | 124.7K | 108.1K |
| gomocalc/multi t2 | 93.2K | 69.6K | 156.8K | 198.3K | 163.2K | 126.9K |
| gomocalc/multi-relaxed t1 | 112.0K | 82.7K | 161.3K | 159.8K | 130.8K | 125.6K |
| gomocalc/multi-relaxed t2 | 133.0K | 96.1K | 201.7K | 208.6K | 170.4K | 155.7K |
| rapfiweb/single t1 | 86.4K | 60.1K | 123.6K | 153.8K | 131.2K | 105.3K |
| rapfiweb/single-relaxed t1 | 93.1K | 78.5K | 182.9K | 169.9K | 139.0K | 125.9K |
| rapfiweb/multi t1 | 86.8K | 60.4K | 126.6K | 154.2K | 129.5K | 105.8K |
| rapfiweb/multi t2 | 99.2K | 75.9K | 146.0K | 200.8K | 161.0K | 128.8K |
| rapfiweb/multi-relaxed t1 | 91.5K | 78.6K | 181.2K | 168.0K | 139.5K | 125.0K |
| rapfiweb/multi-relaxed t2 | 130.5K | 90.3K | 214.9K | 219.7K | 178.6K | 158.3K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| gomocalc/single t1 | 18.0-35 | 21.0-25 | 21.0-41 | 26.0-9 | 27.0-17 |
| gomocalc/multi t1 | 18.0-35 | 21.0-25 | 21.0-41 | 26.0-9 | 27.0-17 |
| gomocalc/multi t2 | 18.5-26 | 17.5-36 | 21.0-45 | 26.0-9 | 26.5-17 |
| gomocalc/multi-relaxed t1 | 18.0-35 | 21.0-41 | 22.0-40 | 26.0-9 | 27.0-17 |
| gomocalc/multi-relaxed t2 | 18.5-27 | 18.5-33 | 23.0-45 | 26.0-8 | 27.5-17 |
| rapfiweb/single t1 | 18.0-32 | 18.0-36 | 19.0-34 | 26.0-9 | 28.0-17 |
| rapfiweb/single-relaxed t1 | 18.0-24 | 18.0-38 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb/multi t1 | 18.0-32 | 18.0-36 | 19.0-34 | 26.0-9 | 28.0-17 |
| rapfiweb/multi t2 | 18.0-28 | 18.5-24 | 20.0-43 | 26.0-9 | 27.0-17 |
| rapfiweb/multi-relaxed t1 | 18.0-24 | 18.0-38 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb/multi-relaxed t2 | 18.0-33 | 18.5-42 | 21.5-47 | 26.0-10 | 27.5-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | gomocalc/single t1 | gomocalc/multi t1 | gomocalc/multi-relaxed t1 | rapfiweb/single t1 | rapfiweb/single-relaxed t1 | rapfiweb/multi t1 | rapfiweb/multi-relaxed t1 |
|---|---|---|---|---|---|---|---|---|
| open-direct | 14 | 195 | 203 | 158 | 650 | 511 | 655 | 525 |
| open-direct | 16 | 2,500 | 2,493 | 2,005 | 1,570 | 1,248 | 1,580 | 1,272 |
| open-direct | 18 | 9,248 | 9,242 | 7,494 | 1,820 | 1,448 | 1,828 | 1,474 |
| open-indirect | 14 | 859 | 855 | 660 | 1,306 | 1,025 | 1,298 | 1,039 |
| open-indirect | 16 | 1,630 | 1,610 | 1,241 | 1,367 | 1,079 | 1,360 | 1,089 |
| open-indirect | 18 | 4,952 | 4,815 | 3,674 | 2,454 | 1,928 | 2,447 | 1,953 |
| midgame | 15 | 1,385 | 1,387 | 1,067 | 1,561 | 1,247 | 1,543 | 1,261 |
| midgame | 17 | 5,243 | 5,153 | 4,114 | 3,627 | 2,917 | 3,565 | 2,938 |
| midgame | 19 | 7,284 | 7,149 | 5,990 | 7,755 | 6,260 | 7,570 | 6,329 |
| vcf | 22 | 913 | 920 | 899 | 946 | 847 | 937 | 872 |
| vcf | 24 | 1,624 | 1,628 | 1,566 | 1,621 | 1,463 | 1,618 | 1,493 |
| vcf | 26 | 2,221 | 2,232 | 2,132 | 2,219 | 2,009 | 2,214 | 2,032 |
| vct | 23 | 2,560 | 2,558 | 2,405 | 1,941 | 1,823 | 1,993 | 1,820 |
| vct | 25 | 4,562 | 4,578 | 4,340 | 3,646 | 3,402 | 3,694 | 3,408 |
| vct | 27 | 8,082 | 8,086 | 7,717 | 6,710 | 6,287 | 6,782 | 6,292 |

**2 스레드**

| 국면 | 깊이 | gomocalc/multi t2 | gomocalc/multi-relaxed t2 | rapfiweb/multi t2 | rapfiweb/multi-relaxed t2 |
|---|---|---|---|---|---|
| open-direct | 13 | 146 | 432 | 562 | 224 |
| open-direct | 15 | 1,915 | 843 | 1,807 | 978 |
| open-direct | 17 | 3,217 | 4,827 | 1,974 | 1,172 |
| open-indirect | 13 | 694 | 128 | 723 | 465 |
| open-indirect | 15 | 778 | 1,344 | 1,679 | 774 |
| open-indirect | 17 | 4,975 | 3,359 | 6,347 | 1,650 |
| midgame | 15 | 2,766 | 1,407 | 1,313 | 2,043 |
| midgame | 17 | 4,934 | 1,977 | 2,507 | 3,500 |
| midgame | 19 | 6,410 | 6,096 | 7,314 | 7,587 |
| vcf | 22 | 1,192 | 1,084 | 1,100 | 1,000 |
| vcf | 24 | 2,058 | 1,866 | 1,941 | 1,741 |
| vcf | 26 | 2,741 | 2,474 | 2,563 | 2,805 |
| vct | 22 | 2,180 | 1,554 | 1,736 | 1,744 |
| vct | 24 | 3,890 | 2,777 | 3,141 | 3,235 |
| vct | 26 | 6,989 | 4,979 | 5,666 | 5,931 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| gomocalc/single t1 | j10/j10 · -429±0 | i8/i8 · -257±0 | l9/l9 · +M41/+M41 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi t1 | j10/j10 · -429±0 | i8/i8 · -265±8 | l9/l9 · +M41/+M41 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi t2 | g7/g7 · -380±53 | i8/i8 · -306±20 | k13/l9 · +M45/+M53 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi-relaxed t1 | j10/j10 · -429±0 | i8/i8 · -289±0 | l9/l9 · +M41/+M41 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi-relaxed t2 | g7/g7 · -406±53 | i8/i8 · -281±35 | k13/l9 · +M57/+M49 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/single t1 | j10/j10 · -462±0 | i8/i8 · -254±0 | l9/l9 · 776±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/single-relaxed t1 | g7/g7 · -352±0 | i8/i8 · -331±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/multi t1 | j10/j10 · -462±0 | i8/i8 · -254±0 | l9/l9 · 776±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/multi t2 | g7/g7 · -411±10 | i8/i8 · -293±11 | l9/l9 · 413/+M45 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/multi-relaxed t1 | g7/g7 · -352±0 | i8/i8 · -331±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/multi-relaxed t2 | g7/g7 · -419±3 | i8/i7 · -285±14 | k13/l9 · 553/+M43 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | g7 | 12/22 | j10×10 g7×12 |
| open-indirect | i8 | 21/22 | i8×21 i7×1 |
| midgame | l9 | 19/22 | l9×19 k13×3 |
| vcf | i4 | 22/22 | i4×22 |
| vct | l12 | 22/22 | l12×22 |

