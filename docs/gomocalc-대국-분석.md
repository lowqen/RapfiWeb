# gomocalc 순정 엔진 대 RapfiWeb 배포 엔진 — 대국 분석

> 측정일 2026-10-06 · CI `match-gomocalc.yml` 런 **37477685626**(본 매치) · **37477710777**(대조)
> · 러너 self-hosted **Intel Xeon Platinum 8488C**(논리 4 · 물리 2 · 16GB, 두 런 같은 기계)
> · 원자료 `bench/sprt/results/ci-37477685626-gomocalc-relaxed-500ms.*` · `ci-37477710777-gomocalc-simd-500ms.*`
> · 분석 묶음 `showcase/src/data/match-{relaxed,simd}.json`(`bench/sprt/match-report.mjs`) · 쇼케이스 `showcase/`

## 요약

1. **RapfiWeb 이 이긴다 — Elo +100.2(95% +76.3 ~ +124.9).** 606판 W-D-L 336-104-166(점수 64.0%), SPRT [0, 10]
   은 **361판에서 H1**. 1 스레드 WASM · 수당 500ms · 균형 개시 60.
2. **차이는 거의 전부 relaxed SIMD 변형에서 나온다.** 같은 ISA(일반 SIMD128)끼리의 대조는 **Elo +3.7(95% −27.4 ~ +34.9)**
   · 372판 · 결정 없음. 1년치 upstream 개선 + P2-2 · A1 · P4-1 은 대국 강도로 보이는 차를 만들지 않았다(구간 ±31 안).
3. **대국 중 NPS: 66.0K ↔ 40.4K(×1.635).** M3 환산(500ms · 속도 2배 = +105.7 Elo)으로 속도 몫은 **+75.0 Elo(+58.2 ~ +92.5)**.
   실측 +100.2 와의 차 +25 는 두 구간이 겹쳐 0 과 구분되지 않는다 — 실측 Elo 의 대부분은 속도로 설명된다.
4. **이 CPU 에서 relaxed 의 몫이 예전 측정보다 훨씬 크다.** 같은 엔진의 relaxed ↔ 일반 NPS 가 66.0K ↔ 41.8K(**+58%**) —
   B2(AMD EPYC 9V74, +19.6%)와 A3(이 기계 재현 +11.2%)를 곱한 +33% 의 두 배 가까이다. relaxed SIMD 의 이득은 CPU 에 크게 달려 있다(§4).
5. **고장 0.** 978판에서 시간 초과 · 크래시 · 불법 수 **0판**, 끝난 뒤 남은 엔진 프로세스 · 자식 핸들 **0**.

## 1. 무엇을 붙였나

| | A — RapfiWeb(시험) | B — gomocalc(기준) |
|---|---|---|
| 바이너리 | 엔진 릴리스 `engine-3c94c2a9-a3`(배포 중) | `www.gomocalc.com/build`(2025-07-27, 서비스 중) |
| Rapfi | 0.43.02 · upstream `3c94c2a9` + P2-2 · A1 · P4-1 · A3 · clang 24 · `wasm-opt -O4 --converge` | 0.43.01 · clang 21 |
| 변형 | 본 매치 **single-simd128-relaxed** · 대조 single-simd128 | **single-simd128** — gomocalc 의 유일한 1 스레드 변형(single-relaxed 가 없다) |
| 가중치 | mix9svq 렌주 흑/백 — **두 쪽 바이트 동일**(마스터플랜 1부 §1.2 H1) | ← |

엔진은 빌드하지 않고 `bench/gomocalc/fetch-engines.mjs` 로 받아 `bench/sprt/wasm-pbrain.mjs` 로 Gomocup 엔진처럼 띄웠다.
금수 심판은 rapfiweb single-simd128(가중치를 풀지 않는다).

**대국 조건**: 렌주(RULE 4) · 1 스레드 · 해시 64MB · 수당 500ms(`INFO TIMEOUT_TURN`, 판당 시간 없음) · 유예 1초 ·
균형 개시 60개(`bench/sprt/openings-balanced.json`)를 색을 바꿔 두 판씩(쌍 대국) · 수 제한 225 · 동시 2(물리 코어 2) ·
**고정 판 수**(`--fixed` — SPRT 결정 뒤에도 계속 둬서 Elo 구간을 좁힌다) · 시간 예산 본 180분 · 대조 100분.
두 런 모두 판 수(800 · 400) 전에 시간 예산에서 멈췄다(606 · 372판, 쌍은 반쪽으로 남기지 않음).

## 2. 결과

### 본 매치 — RapfiWeb single-simd128-relaxed vs gomocalc single-simd128

| 항목 | 값 |
|---|---|
| 대국 | **606판** (303쌍 · 개시 60개 순환 · 동시 2) · 수당 500ms |
| W-D-L (RapfiWeb 기준) | **336-104-166** · 점수 64.0% · 비김 17.2% |
| **Elo (오각)** | **+100.2** (95% +76.3 ~ +124.9) · LOS 100.0% |
| Elo (삼항, 참고) | +100.2 (95% +74.6 ~ +126.8) |
| 오각 [0, ½, 1, 1½, 2] | [17, 23, 122, 55, 86] |
| SPRT [0, 10] · α=β=0.05 | **361판에서 LLR 2.950 → H1** · 끝까지 둔 뒤 LLR 5.742 / [−2.944, 2.944] |
| 색별 (RapfiWeb) | 흑 144-57-102 · 백 192-47-64 |
| 끝난 까닭 | 오목 497 · 판 가득 104 · 금수 5 |
| 고장(시간 초과 · 크래시 · 불법 수) | **0판 (0.0%)** · 남은 프로세스 0 |
| 수 수 | 중앙값 65 · p10 40 · p90 225 · 판당 35.8초 |
| 탐색 RapfiWeb | NPS **66,037** · 깊이 17.20(선택 22.69) · 수당 434ms · 19,816수 |
| 탐색 gomocalc | NPS **40,394** · 깊이 16.55(선택 20.30) · 수당 435ms · 23,367수 |
| 속도 몫(M3 환산) | NPS 비 1.635 → **+75.0 Elo** (+58.2 ~ +92.5) |
| 벽시계 | 181분 |

### 대조 — RapfiWeb single-simd128 vs gomocalc single-simd128 (같은 ISA)

| 항목 | 값 |
|---|---|
| 대국 | **372판** (186쌍 · 개시 60개 순환 · 동시 2) · 수당 500ms |
| W-D-L (RapfiWeb 기준) | **161-54-157** · 점수 50.5% · 비김 14.5% |
| **Elo (오각)** | **+3.7** (95% −27.4 ~ +34.9) · LOS 59.3% |
| Elo (삼항, 참고) | +3.7 (95% −29.0 ~ +36.5) |
| 오각 [0, ½, 1, 1½, 2] | [29, 24, 78, 24, 31] |
| SPRT [0, 10] | LLR −0.050 → 결정 없음(시간 예산) |
| 색별 (RapfiWeb) | 흑 68-27-91 · 백 93-27-66 |
| 끝난 까닭 | 오목 318 · 판 가득 54 |
| 고장 | **0판 (0.0%)** · 남은 프로세스 0 |
| 수 수 | 중앙값 61 · p10 39 · p90 225 · 판당 32.6초 |
| 탐색 RapfiWeb | NPS 41,760 · 깊이 16.57(선택 20.18) · 수당 434ms · 12,641수 |
| 탐색 gomocalc | NPS 39,895 · 깊이 16.48(선택 19.83) · 수당 433ms · 13,073수 |
| 속도 몫(M3 환산) | NPS 비 1.047 → +7.0 Elo (+5.4 ~ +8.6) |
| 벽시계 | 101분 |

## 3. Elo 분해 — 어디서 왔나

| 몫 | Elo | 근거 |
|---|---|---|
| 본 매치 실측 | **+100.2**(+76.3 ~ +124.9) | 위 표 |
| └ 속도 몫(대국 중 NPS ×1.635, M3 환산) | +75.0(+58.2 ~ +92.5) | M3: 500ms · WASM relaxed · 균형 60 에서 속도 2배 = +105.7 |
| └ 나머지(실측 − 속도 몫) | ≈ +25 | 구간이 겹친다 — 0 과 구분 불가 |
| 같은 ISA 대조 실측 | +3.7(−27.4 ~ +34.9) | 소스 1년 + P2-2 · A1 · P4-1 의 합 |
| └ 그 속도 몫(NPS ×1.047) | +7.0 | 대조 실측과 맞는다 |

읽는 법:

- **같은 ISA 에서는 두 엔진이 사실상 같다.** NPS +4.7%, 평균 깊이 16.57 ↔ 16.48, Elo +3.7 — 1부 B1 의 「같은 국면 · 같은 가중치에서
  NPS 는 사실상 같다」(+2%)와 같은 결론이 대국 강도에서도 나왔다. A1 은 WASM relaxed SPRT 에서 +20.2 였지만 일반 SIMD128 에서의 몫은
  따로 잰 적이 없고, 여기 대조의 구간(±31)은 그것을 가려낼 만큼 좁지 않다.
- **본 매치의 +100 은 relaxed 변형(과 그 위에서만 켜지는 A3 배치)이 낸 속도다.** gomocalc 는 1 스레드 relaxed 변형을 싣지 않는다 —
  그래서 COOP/COEP 격리가 안 되는 환경(1 스레드로 물러서는 곳)에서 이 차이가 그대로 사용자에게 간다.
- 깊이 0.65 · 선택 깊이 2.4 가 더 깊다(본 매치). 같은 시간에 노드를 63% 더 도는 것이 깊이로 나타난 것이다.

## 4. 이 CPU 에서 relaxed SIMD 가 +58% 인 것

같은 RapfiWeb 의 두 변형 NPS — relaxed 66,037(본 매치) ↔ 일반 41,760(대조) = **×1.581**. 예전 측정은:

| 측정 | CPU | relaxed ↔ 일반 |
|---|---|---|
| B2 (`bench/gomocalc/results/ci-rx.*`) | AMD EPYC 9V74 · Chromium 151 | +19.6%(기하 평균 105.3K → 125.9K) |
| B1 | Intel Xeon 8370C | +23% |
| A3 (relaxed 에만 더해짐) | Intel Xeon 8573C · 재현 **8488C** | ×1.087 · 재현 ×1.112 |
| **이번 대국** | **Intel Xeon Platinum 8488C · Node 26** | **+58%** |

B2 의 2-a 와 이 기계의 A3 재현을 곱하면 +33% 남짓(1.196 × 1.112)이어야 하는데 그 두 배 가까이다. 두 수치는 **다른 런**(같은 기계, 연달아)에서 왔고 대국 국면 분포가 고정 국면 벤치와
다르다는 점은 감안해야 하지만, 차이가 너무 커서 측정 잡음으로 보기는 어렵다. 가설: Sapphire Rapids(8488C)의 AVX-VNNI 가 relaxed
i8 내적(`i32x4.relaxed_dot_i8x16_i7x16_add_s`)을 명령 하나로 낮추고, B2 의 AMD 러너에서는 그만큼 이득이 나지 않았다 — V8 의 낮춤이
CPU 기능에 따라 갈린다는 것은 1부 H5 에서도 본 일이다. **확인은 하지 않았다** — 같은 런 안에서 두 변형을 짝지어 재는 것이 다음 일이다
(`wasm-speed.yml` 의 고정 깊이 · A/A 대조를 relaxed ↔ 일반에 쓰면 된다). 이 가설이 맞으면 「relaxed 몫」은 사용자 CPU 마다 크게 다르고,
본 매치의 +100 은 **이 CPU 의** 값이다.

## 5. 고장 · 데드락 — 러너가 지킨 것

978판(+ 예열 · 심판 질의)에서 시간 초과 · 크래시 · 불법 수 · 시간 패 **0**, 끝난 뒤 남은 엔진 프로세스 **0** · 자식 핸들 **0**
(`pgrep -fc wasm-pbrain.mjs` 도 0). 러너(`bench/sprt/engine.mjs`)의 장치:

- 모든 대기(START → OK · RESTART → OK · 수 · YXSHOWFORBID)에 시간 제한 — 수는 수당 시간 + 유예. 넘으면 그 판은 진 것으로 하고 그 엔진을 갈아 끼운다.
- stdout · stderr 를 늘 끝까지 읽는다 — 우리가 기다리는 줄이 없을 때도. 파이프 버퍼가 차서 엔진이 write 에서 멈추는 데드락을 막는다(시험: 수마다 ~1MB 출력).
- stdin 은 역압(`drain`)을 따르고 그 기다림에도 시간 제한, EPIPE 는 프로세스 사망으로 처리.
- 끝낼 때 END → 유예 3초 → SIGKILL, 끝에서 남은 프로세스 · 파이프 핸들을 세어 0 이 아니면 종료 코드 1.
- 시간 예산을 넘으면 새 쌍을 시작하지 않고 시작한 쌍만 마저 둔다(잡 제한 전에 끝냄 — 이번 두 런이 이 경로로 끝났다).

`node --test bench/sprt/` 29/29(크래시 · 멈춤 · 불법 수 · 출력 폭주 · 시간 예산 · SPRT 결정 · 고정 판 수 · 탐색 통계).

## 6. 한계

- **1 스레드만.** `wasm-pbrain.mjs` 는 `sendCommand` 동기 펌프라 멀티 변형을 못 띄운다. 격리된 브라우저에서 gomocalc 는
  multi-simd128-relaxed 를 쓰므로, 「브라우저에서 둘 다 최선」의 비교는 멀티 relaxed 끼리 따로 재야 한다 — 본 매치는 「1 스레드에서 각자 최선」이다.
- **CPU 하나.** relaxed 의 몫이 CPU 마다 크게 다르다는 단서가 있다(§4). AMD 러너에서 본 매치를 다시 두면 Elo 차가 줄어들 것으로 본다.
- **대조의 해상도.** ±31 Elo 구간이라 「소스 · 패치 몫이 0」이 아니라 「±31 안」이다. 좁히려면 판을 3~4배.
- 판 가득(104 · 54판)은 지금 러너가 비김으로 친다 — 렌주라면 패스로 비김일 자리라 결과는 같다(1부 §4 P3-3 의 열린 일).

## 7. 재현

```bash
# CI(self-hosted) — 엔진 받기 · 러너 시험 · 대국 · 아티팩트(match-<변형>)
gh workflow run match-gomocalc.yml -f test_variant=single-simd128-relaxed -f games=800 -f max_minutes=180
gh workflow run match-gomocalc.yml -f test_variant=single-simd128 -f games=400 -f max_minutes=100

# 분석 묶음 → 보고서 표 · 쇼케이스 데이터
node bench/sprt/match-report.mjs --games games.jsonl --summary summary.json \
  --label "본 매치" --run <런> --runner "<CPU>" --json showcase/src/data/match-relaxed.json --md out.md

# 쇼케이스
pnpm showcase:dev      # http://localhost:5180
pnpm showcase:build    # dist-showcase/
```

로컬(윈도)에서 짧게 돌려 보려면 `node bench/gomocalc/fetch-engines.mjs` 뒤 `bench/sprt/runner.mjs` 에
`--a "node bench/sprt/wasm-pbrain.mjs --dir bench/gomocalc/engines/rapfiweb --variant single-simd128-relaxed"` ·
`--b "node bench/sprt/wasm-pbrain.mjs --dir bench/gomocalc/engines/gomocalc --variant single-simd128 --data bench/gomocalc/engines/gomocalc/rapfi.data"`
(경로는 윈도 형식 — Git Bash 의 `/c/...` 는 node 가 `C:\c\...` 로 읽는다). 로컬 수치는 결론에 쓰지 않는다.
