## 환경 — ci
- CPU: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz · 논리 코어 2 · RAM 7.8GB · linux 6.17.0-1022-azure
- 브라우저: Chromium 151.0.7922.34 (Playwright, 헤드리스)
- 탐색 10000ms × 반복 2 · 해시 128MB · 스레드 1/2/4
- 측정 2026-09-29T15:30:33.209Z → 2026-09-29T16:01:23.359Z

### 엔진 · 기동 · 메모리
| 엔진/변형 | ABOUT version | 호스트 | 로드 ms | 기동 후 wasm MB | 탐색 후 wasm MB | 페이지 전체 MB |
|---|---|---|---|---|---|---|
| gomocalc/single | 0.43.01 (clang++ 21.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 426 | 153 | 220 | — |
| gomocalc/multi | 0.43.01 (clang++ 21.0.0 on Wasm WASM_SIMD) | main-thread | 418 | 155 | 223 | — |
| gomocalc/multi-relaxed | 0.43.01 (clang++ 21.0.0 on Wasm WASM_SIMD_RELAXED) | main-thread | 410 | 155 | 223 | — |
| rapfiweb/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 235 | 147 | 275 | — |
| rapfiweb/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 233 | 149 | 215 | — |
| rapfiweb-full/single | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD SINGLE_THREAD) | worker | 335 | 147 | 212 | — |
| rapfiweb-full/multi | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD) | main-thread | 300 | 149 | 215 | — |
| rapfiweb-full/multi-relaxed | 0.43.02 (clang++ 24.0.0 on Wasm WASM_SIMD_RELAXED) | main-thread | 294 | 149 | 215 | — |

### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드
| 엔진/변형 | 국면 | 시간 ms | nps | 깊이 |
|---|---|---|---|---|
| gomocalc/single | open-direct | 3000 | 71.2K | 16-49 |
| gomocalc/multi | open-direct | 3000 | 70.4K | 15-45 |
| gomocalc/multi-relaxed | open-direct | 3000 | 95.8K | 16-32 |
| rapfiweb/single | open-direct | 3000 | 65.9K | 18-24 |
| rapfiweb/multi | open-direct | 3000 | 66.0K | 18-24 |
| rapfiweb-full/single | open-direct | 3000 | 66.2K | 18-24 |
| rapfiweb-full/multi | open-direct | 3000 | 66.5K | 18-24 |
| rapfiweb-full/multi-relaxed | open-direct | 3000 | 85.4K | 18-27 |

### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)
| 엔진/변형 | Move Bench moves/s | Search nps (노드÷시간) | 엔진이 찍은 Nodes/s | 노드 | 시간 ms | Hash |
|---|---|---|---|---|---|---|
| gomocalc/single | 1,242,989 | 48,043 | 48,043 | 3,628,934 | 75,535 | 662ab34c |
| gomocalc/multi-relaxed | 1,202,627 | 72,563 | 72,562 | 3,628,934 | 50,011 | 662ab34c |
| rapfiweb/single | 1,543,186 | 212,567 | 85,244 | 7,170,518 | 33,733 | 2b7c7da9 |
| rapfiweb-full/single | 1,552,771 | 53,581 | 1,174 | 4,391,204 | 81,955 | 4100a973 |
| rapfiweb-full/multi-relaxed | 1,470,566 | 70,018 | 1,534 | 4,391,204 | 62,715 | 4100a973 |

### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| gomocalc/single t1 | 79.4K | 53.5K | 121.5K | 140.5K | 115.4K | 96.5K |
| gomocalc/multi t1 | 78.6K | 52.9K | 121.3K | 139.7K | 113.5K | 95.6K |
| gomocalc/multi t2 | 82.1K | 59.1K | 100.3K | 166.0K | 134.0K | 101.6K |
| gomocalc/multi t4 | 90.3K | 65.8K | 134.8K | 181.6K | 144.4K | 116.0K |
| gomocalc/multi-relaxed t1 | 105.5K | 76.0K | 153.7K | 154.1K | 126.4K | 119.1K |
| gomocalc/multi-relaxed t2 | 104.9K | 86.3K | 176.8K | 186.3K | 150.1K | 135.0K |
| gomocalc/multi-relaxed t4 | 112.9K | 89.2K | 152.5K | 195.1K | 152.3K | 135.5K |
| rapfiweb/single t1 | 79.3K | 54.4K | 114.4K | 151.1K | 124.2K | 98.5K |
| rapfiweb/multi t1 | 79.2K | 54.4K | 113.4K | 147.5K | 122.8K | 97.6K |
| rapfiweb/multi t2 | 81.0K | 60.8K | 145.3K | 170.4K | 136.7K | 110.8K |
| rapfiweb/multi t4 | 90.4K | 60.1K | 139.0K | 185.7K | 142.5K | 114.9K |
| rapfiweb-full/single t1 | 79.4K | 54.5K | 114.4K | 151.2K | 123.4K | 98.4K |
| rapfiweb-full/multi t1 | 79.2K | 54.6K | 114.9K | 148.1K | 124.6K | 98.3K |
| rapfiweb-full/multi t2 | 92.5K | 61.2K | 108.1K | 175.1K | 142.0K | 108.7K |
| rapfiweb-full/multi t4 | 84.6K | 64.8K | 128.8K | 184.4K | 143.7K | 113.3K |
| rapfiweb-full/multi-relaxed t1 | 98.8K | 71.4K | 170.7K | 162.3K | 132.8K | 121.0K |
| rapfiweb-full/multi-relaxed t2 | 93.6K | 78.2K | 169.8K | 184.9K | 149.7K | 128.0K |
| rapfiweb-full/multi-relaxed t4 | 100.6K | 78.8K | 140.0K | 200.5K | 156.9K | 128.4K |

### 도달 깊이 (평균 깊이-선택 깊이)
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| gomocalc/single t1 | 17.0-35 | 21.0-25 | 18.0-41 | 26.0-9 | 27.0-17 |
| gomocalc/multi t1 | 17.0-35 | 20.5-27 | 18.0-41 | 26.0-9 | 27.0-17 |
| gomocalc/multi t2 | 17.5-38 | 18.5-36 | 18.0-32 | 26.0-9 | 27.0-17 |
| gomocalc/multi t4 | 17.5-35 | 16.5-29 | 18.0-45 | 26.0-9 | 26.0-17 |
| gomocalc/multi-relaxed t1 | 18.0-35 | 21.0-41 | 22.0-40 | 26.0-9 | 27.0-17 |
| gomocalc/multi-relaxed t2 | 19.0-28 | 18.0-36 | 23.5-44 | 26.0-9 | 27.0-17 |
| gomocalc/multi-relaxed t4 | 18.0-30 | 17.5-31 | 18.0-43 | 26.0-9 | 26.0-17 |
| rapfiweb/single t1 | 18.0-31 | 18.0-36 | 19.0-34 | 26.0-9 | 28.0-17 |
| rapfiweb/multi t1 | 18.0-31 | 18.0-36 | 19.0-34 | 26.0-9 | 28.0-17 |
| rapfiweb/multi t2 | 18.0-34 | 17.5-38 | 20.0-35 | 26.0-9 | 26.5-17 |
| rapfiweb/multi t4 | 16.5-34 | 16.5-18 | 17.5-47 | 26.0-8 | 25.5-17 |
| rapfiweb-full/single t1 | 18.0-31 | 18.0-36 | 19.0-34 | 26.0-9 | 28.0-17 |
| rapfiweb-full/multi t1 | 18.0-31 | 18.0-36 | 19.0-34 | 26.0-9 | 28.0-17 |
| rapfiweb-full/multi t2 | 18.0-31 | 18.0-41 | 19.0-51 | 26.0-9 | 27.0-17 |
| rapfiweb-full/multi t4 | 17.5-23 | 16.5-26 | 18.5-29 | 26.0-8 | 26.0-17 |
| rapfiweb-full/multi-relaxed t1 | 18.0-32 | 18.0-38 | 21.0-41 | 26.0-9 | 28.0-17 |
| rapfiweb-full/multi-relaxed t2 | 18.5-20 | 17.5-37 | 18.5-50 | 26.0-8 | 27.0-17 |
| rapfiweb-full/multi-relaxed t4 | 18.5-28 | 16.0-27 | 19.0-43 | 26.0-9 | 25.5-17 |

### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교
**1 스레드**

| 국면 | 깊이 | gomocalc/single t1 | gomocalc/multi t1 | gomocalc/multi-relaxed t1 | rapfiweb/single t1 | rapfiweb/multi t1 | rapfiweb-full/single t1 | rapfiweb-full/multi t1 | rapfiweb-full/multi-relaxed t1 |
|---|---|---|---|---|---|---|---|---|---|
| open-direct | 13 | 212 | 233 | 160 | 717 | 722 | 714 | 719 | 561 |
| open-direct | 15 | 309 | 332 | 233 | 1,583 | 1,601 | 1,579 | 1,591 | 1,243 |
| open-direct | 17 | 4,883 | 4,947 | 3,637 | 1,825 | 1,846 | 1,822 | 1,836 | 1,437 |
| open-indirect | 14 | 969 | 1,011 | 695 | 1,457 | 1,462 | 1,461 | 1,454 | 1,118 |
| open-indirect | 16 | 1,829 | 1,880 | 1,307 | 1,524 | 1,532 | 1,529 | 1,526 | 1,172 |
| open-indirect | 18 | 5,563 | 5,633 | 3,948 | 2,738 | 2,743 | 2,743 | 2,725 | 2,099 |
| midgame | 14 | 1,582 | 1,580 | 1,128 | 1,360 | 1,370 | 1,367 | 1,363 | 1,072 |
| midgame | 16 | 1,621 | 1,622 | 1,161 | 3,920 | 3,949 | 3,932 | 3,908 | 3,110 |
| midgame | 18 | 8,090 | 8,101 | 6,272 | 7,075 | 7,119 | 7,056 | 7,038 | 5,603 |
| vcf | 22 | 1,012 | 1,024 | 939 | 955 | 997 | 951 | 992 | 913 |
| vcf | 24 | 1,781 | 1,792 | 1,629 | 1,654 | 1,699 | 1,639 | 1,695 | 1,548 |
| vcf | 26 | 2,424 | 2,439 | 2,211 | 2,258 | 2,315 | 2,258 | 2,306 | 2,104 |
| vct | 23 | 2,766 | 2,821 | 2,496 | 2,047 | 2,094 | 2,058 | 2,054 | 1,907 |
| vct | 25 | 4,938 | 5,023 | 4,487 | 3,813 | 3,890 | 3,852 | 3,811 | 3,561 |
| vct | 27 | 8,737 | 8,887 | 7,983 | 7,055 | 7,165 | 7,083 | 7,047 | 6,608 |

**2 스레드**

| 국면 | 깊이 | gomocalc/multi t2 | gomocalc/multi-relaxed t2 | rapfiweb/multi t2 | rapfiweb-full/multi t2 | rapfiweb-full/multi-relaxed t2 |
|---|---|---|---|---|---|---|
| open-direct | 12 | 335 | 99 | 94 | 364 | 164 |
| open-direct | 14 | 375 | 129 | 456 | 499 | 196 |
| open-direct | 16 | 570 | 1,425 | 1,578 | 3,278 | 1,874 |
| open-indirect | 12 | 292 | 45 | 61 | 108 | 234 |
| open-indirect | 14 | 1,364 | 763 | 694 | 1,455 | 796 |
| open-indirect | 16 | 1,545 | 2,293 | 5,839 | 2,161 | 1,757 |
| midgame | 13 | 602 | 884 | 811 | 613 | 910 |
| midgame | 15 | 2,316 | 1,192 | 1,752 | 1,351 | 1,174 |
| midgame | 17 | 3,612 | 3,119 | 3,502 | 2,407 | 4,030 |
| vcf | 22 | 1,420 | 1,250 | 1,374 | 1,276 | 1,255 |
| vcf | 24 | 2,414 | 2,117 | 2,297 | 2,349 | 2,210 |
| vcf | 26 | 3,190 | 2,891 | 3,190 | 3,121 | 2,851 |
| vct | 22 | 2,170 | 1,835 | 2,219 | 2,034 | 1,940 |
| vct | 24 | 3,703 | 3,231 | 4,015 | 3,534 | 3,500 |
| vct | 26 | 6,636 | 5,902 | 7,253 | 6,437 | 6,483 |

**4 스레드**

| 국면 | 깊이 | gomocalc/multi t4 | gomocalc/multi-relaxed t4 | rapfiweb/multi t4 | rapfiweb-full/multi t4 | rapfiweb-full/multi-relaxed t4 |
|---|---|---|---|---|---|---|
| open-direct | 11 | 101 | 108 | 108 | 109 | 330 |
| open-direct | 13 | 406 | 419 | 438 | 211 | 794 |
| open-direct | 15 | 482 | 512 | 1,549 | 5,136 | 862 |
| open-indirect | 11 | 77 | 64 | 205 | 91 | 250 |
| open-indirect | 13 | 1,166 | 410 | 536 | 1,088 | 771 |
| open-indirect | 15 | 3,413 | 3,004 | 1,651 | 3,813 | 7,169 |
| midgame | 12 | 786 | 500 | 1,348 | 534 | 647 |
| midgame | 14 | 1,830 | 722 | 3,090 | 1,480 | 1,178 |
| midgame | 16 | 3,683 | 3,307 | 6,065 | 3,650 | 3,609 |
| vcf | 22 | 1,788 | 1,880 | 1,727 | 1,739 | 1,639 |
| vcf | 24 | 3,118 | 3,207 | 3,382 | 3,080 | 2,848 |
| vcf | 26 | 4,433 | 4,780 | 4,483 | 3,812 | 4,031 |
| vct | 21 | 2,267 | 1,732 | 2,015 | 1,908 | 2,314 |
| vct | 23 | 3,958 | 3,326 | 3,620 | 3,393 | 4,089 |
| vct | 25 | 6,919 | 6,449 | 6,571 | 6,540 | 7,206 |

### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차
| 엔진/변형 스레드 | open-direct | open-indirect | midgame | vcf | vct |
|---|---|---|---|---|---|
| gomocalc/single t1 | j10/j10 · -473±0 | i8/i8 · -257±0 | l9/l9 · +M43/+M43 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi t1 | j10/j10 · -473±0 | i8/i8 · -257±0 | l9/l9 · +M43/+M43 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi t2 | g7/j10 · -376±28 | i7/i8 · -301±8 | l9/l9 · 464±44 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi t4 | j10/g7 · -454±13 | i8/i8 · -285±26 | l9/l9 · 1132±220 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi-relaxed t1 | j10/j10 · -429±0 | i8/i8 · -289±0 | l9/l9 · +M41/+M41 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi-relaxed t2 | j10/g7 · -378±30 | i8/i8 · -310±4 | l9/l9 · +M49/1219 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| gomocalc/multi-relaxed t4 | g7/g7 · -396±22 | i8/i8 · -270±1 | l9/l9 · 718±319 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/single t1 | j10/j10 · -462±0 | i8/i8 · -275±0 | l9/l9 · 776±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/multi t1 | j10/j10 · -462±0 | i8/i8 · -275±0 | l9/l9 · 776±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/multi t2 | g7/g7 · -407±67 | i8/i8 · -308±18 | l9/l9 · +M57/1106 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb/multi t4 | j10/g7 · -356±42 | i8/i8 · -259±11 | l9/l9 · 439/+M61 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-full/single t1 | j10/j10 · -462±0 | i8/i8 · -275±0 | l9/l9 · 776±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-full/multi t1 | j10/j10 · -462±0 | i8/i8 · -275±0 | l9/l9 · 776±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-full/multi t2 | j10/g7 · -417±7 | i8/i8 · -308±11 | l9/k13 · 386±19 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-full/multi t4 | g7/j10 · -426±6 | i8/j7 · -273±21 | l9/k13 · 903±552 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-full/multi-relaxed t1 | j10/j10 · -483±0 | i8/i8 · -331±0 | l9/l9 · 542±0 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-full/multi-relaxed t2 | g7/g7 · -368±4 | i8/i8 · -264±9 | l9/k13 · 596/+M53 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |
| rapfiweb-full/multi-relaxed t4 | g7/j10 · -390±50 | g8/j7 · -301±17 | l9/l9 · 448±139 | i4/i4 · +M9/+M9 | l12/l12 · +M19/+M19 |

### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)
| 국면 | 최빈 최선수 | 일치 | 분포 |
|---|---|---|---|
| open-direct | j10 | 23/36 | j10×23 g7×13 |
| open-indirect | i8 | 32/36 | i8×32 i7×1 j7×2 g8×1 |
| midgame | l9 | 33/36 | l9×33 k13×3 |
| vcf | i4 | 36/36 | i4×36 |
| vct | l12 | 36/36 | l12×36 |

