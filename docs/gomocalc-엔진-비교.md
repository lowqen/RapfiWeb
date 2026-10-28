# gomocalc 엔진 — 탑재 방식 분석 · 성능 대조 · 최적화 방안

> 대상: [dhbloo/gomoku-calculator](https://github.com/dhbloo/gomoku-calculator) (a742d450, 2025-11-17) 와
> 그 배포본 `www.gomocalc.com/build/*` (Last-Modified 2025-07-27), 그리고 Zenyth Web 의 배포 엔진
> `engine-3c94c2a9-mt`.
> 하네스: `bench/gomocalc/` · 원자료: `bench/gomocalc/results/*.json` (표로 푼 것: 같은 폴더 `*.md`)
> · CI: `.github/workflows/bench-gomocalc.yml` (run 36589486422) · 측정일 2026-09-29

## 요약

1. **같은 국면·같은 가중치에서 NPS 는 사실상 같다.** 예열 뒤 1 스레드 기하 평균
   gomocalc 96.5K ↔ Zenyth Web 98.5K (CI Xeon, +2%) · 43.5K ↔ 45.5K (Celeron N4500, +5%).
   노드 한 개의 값이 NNUE 추론에 묶여 있고, 그 코드는 두 버전 사이에 크게 바뀌지 않았다.
2. **탐색 효율은 우리가 앞선다 — 깊은 쪽에서.** 1 스레드로 국면별 가장 깊은 공통 깊이에 닿는
   시간이 직접 개시 −63% · 간접 개시 −51% · 중반 −13% · VCF −7% · VCT −19% (CI). 얕은 깊이는
   gomocalc(0.43.01)가 더 빨리 찍는다 — 두 버전의 깊이·축소 규칙이 달라 깊이 숫자 자체는 버전
   사이에 1:1 로 맞지 않는다(§5.2).
3. **relaxed SIMD 가 가장 큰, 검증된 여지다.** 같은 소스에서 relaxed 빌드만 바꿔도 NPS **+23%**
   (우리 가중치 4종 빌드, CI) · BENCH 시간 **−23.5%**(81.96s → 62.72s) — 그리고 BENCH 해시·노드
   수가 **비트 단위로 같다**(4100a973, 4,391,204). gomocalc 는 이 변형을 이미 싣고 있고
   (+24.6%), 우리는 싣지 않는다.
4. **wasm 은 아직 네이티브의 43% 다.** 같은 소스·같은 탐색 트리(4,391,204 노드)에서
   네이티브 SSE 128bit 124K nps ↔ wasm SIMD128 53.6K ↔ wasm relaxed 70.0K (CI).
5. 기동·내려받기는 우리가 가볍다(.data 19.9MB ↔ 40.3MB, 로드 235ms ↔ 426ms CI).
   메모리(선형 메모리, 해시 128MB 기준)는 147~275MB 로 비슷하다.
6. 측정 중 upstream 결함 둘: **BENCH 의 Nodes/s 가 wasm32 에서 넘친다**(우리 배포 BENCH 의
   47,702 는 실제 118,952), gomocalc 의 relaxed 변형은 upstream 이 **정확성 문제로 지운 경로**
   (`ca36fdad`)를 탄다 — 이 두 기계(x86)에서는 해시가 같아 결과가 달라지지 않았다.

권고 순서(§6): **① relaxed SIMD 변형 추가 → ② 변형 간 .data 공유 → ③ 가중치 선적재·JIT 예열 →
~~④ relaxed 내적 경로 재구현~~(이미 upstream 에 있음 — §6-④ 정정) → ⑤ 빌드 플래그 실험(PGO·wasm-opt·mimalloc) →
⑥ 가지치기 매개변수는 SPRT 대국으로만.** ①②③ 은 적용됐고, 이어지는 소스 레벨 규명·로드맵은
`docs/최적화-마스터플랜.md` 에 있다.

## 1. 무엇과 무엇을 비교하는가

| | gomocalc (배포본) | Zenyth Web (`engine-3c94c2a9-mt`) |
|---|---|---|
| 엔진 | Rapfi **0.43.01** | Rapfi **0.43.02** (dhbloo/rapfi `3c94c2a9`, 2026-07-23, 패치 없음) |
| 컴파일러 | clang 21.0.0 (ABOUT 문자열) | clang 24.0.0 · Emscripten 6.0.10 |
| 변형 | multi-simd128 · multi-simd128-**relaxed** · single-simd128 (+ NNUE 없는 fallback) | multi-simd128 · single-simd128 |
| wasm 크기 | multi 1,137,577 · relaxed 1,140,764 · single 1,105,309 B | multi 1,215,625 · single 1,238,122 B |
| 가중치(.data) | `rapfi.data` 하나 **40.3MB** — mix9svq 4종(프리스타일·스탠다드·렌주 흑/백) + classical 모델 2 + config 3 | 변형마다 **19.9MB** — 렌주 흑/백 + classical 1 + config 1 |
| JS 예외 트램펄린 | 글루에 `invoke_*` 형태 **35~37개** | **0개** |
| 탐색 설정(config.toml) | 가중치 목록 외 **같다** (`[search]` · `[search.timectl]` 동일) | ← |

추가로 CI 에서 **`rapfiweb-full`** 을 만들어 함께 쟀다 — 우리 소스·우리 플래그 그대로 가중치만
4종으로 굽고(`PRELOAD_SET=full`), relaxed 멀티 변형을 더한 것(`EXTRA_VARIANTS=multi-simd128-relaxed`).
배포 .data 는 렌주 전용이라 BENCH 를 gomocalc 와 같은 가중치로 돌릴 수 없어서다. 벤치 전용이며
배포·릴리스하지 않는다(40.3MB 는 Cloudflare 파일당 25MB 상한 초과).

두 엔진 사이에는 **소스 1년**이 있다. 그 사이 upstream 에 들어간 것 중 성능에 닿는 것:

| 커밋 | 날짜 | 내용 |
|---|---|---|
| `ca36fdad` | 2025-09-13 | **fix dot4_i8i8_accum on wasm** — relaxed SIMD 내적 경로를 **지웠다**(§2.5) |
| `2a773f1b` | 2026-05-29 | eval: mix9svq/mix10 NNUE 추론 가속(행렬곱 강제 인라인, 그룹 합에서 전역 합 유도) |
| `afccc162` | 2026-05-29 | game: 보드 칸 집합을 비트보드로 순회 |
| `0e1f7ed5` | 2026-05-29 | search/bench: 결정적 수 정렬 + **깊이 19 균일 BENCH** — BENCH 국면·깊이 자체가 바뀜 |
| `27029806` · `6e51027b` · `887df291` | 2026-07-23 | 보드 증분 상태 재설계, 패턴 표 압축, 수 생성 간소화 + 자식 TT 프리페치 |

그래서 이 대조는 **"같은 Rapfi 의 두 빌드"가 아니라 "gomocalc 가 서비스 중인 Rapfi" 대 "우리가
서비스 중인 Rapfi"** 다. 차이는 소스·컴파일러·가중치 묶음이 합쳐진 것이고, 표마다 무엇이 섞였는지
적는다. 한 변수만 바꾼 비교(relaxed 유무, 단일/멀티 빌드, 네이티브/wasm)는 **같은 버전 안에서만** 한다.

## 2. gomocalc 의 엔진 탑재 방식

### 2.1 빌드 플래그 — upstream CMake 의 EMSCRIPTEN 블록 (두 쪽 공통)

gomocalc 저장소에는 엔진 빌드가 없다(README: "Rapfi 를 Emscripten 으로 빌드해 `public/build` 에
둔다"). 플래그는 `Rapfi/CMakeLists.txt` 의 `if(EMSCRIPTEN)` 블록이 전부 정하고, 우리
`tools/build_engine_wasm.sh` 도 거기에 아무것도 얹지 않는다. 아래는 CI 실험 빌드의 `build.ninja`
에서 **실제로 뽑은** 줄이다:

```
FLAGS      = -ffp-contract=off … -O3 -DNDEBUG -std=gnu++17 -fexceptions -flto [-pthread] -msimd128 [-mrelaxed-simd]
LINK_FLAGS = -fexceptions -flto --pre-js …/preamble.js --closure=1 -s MODULARIZE=1 -s EXPORT_NAME=Rapfi
             -s EXPORTED_FUNCTIONS="['_main','_gomocupLoopOnce','_emscripten_force_exit']"
             -s EXPORTED_RUNTIME_METHODS="['cwrap']" -s EXIT_RUNTIME=1 -s ALLOW_MEMORY_GROWTH=1
             -s IMPORTED_MEMORY=1 -s STACK_SIZE=2MB --preload-file … [-pthread -s PROXY_TO_PTHREAD=1]
```

| 구분 | 무엇이 켜져 있나 |
|---|---|
| 최적화 | `-O3`(Release) · **LTO 는 이미 켜져 있다** — `-flto` 를 컴파일·링크 모두에 강제(`ENABLE_LTO` 옵션과 무관) |
| 부동소수 | `-ffp-contract=off` — x86·ARM 과 탐색 결과를 맞추기 위함 |
| 예외 | `-fexceptions` (cpptoml 등이 예외를 쓴다) |
| 글루 | `--closure=1` · `MODULARIZE` · `--pre-js preamble.js`(sendCommand 펌프) |
| 메모리 | `ALLOW_MEMORY_GROWTH` · `IMPORTED_MEMORY`(호스트가 만든다) · `STACK_SIZE=2MB` |
| 스레드 | (multi) `-pthread -s PROXY_TO_PTHREAD=1` / (single) `NO_MULTI_THREADING` |
| SIMD | `-msimd128` + `USE_WASM_SIMD` / (relaxed) `-mrelaxed-simd` + `USE_WASM_SIMD_RELAXED` |

**없는 것**: PGO(`-fprofile-instr-use`), `-sMALLOC=mimalloc`, `wasm-opt` 추가 패스.
SIMD 없는 변형은 현재 upstream 에서 빌드되지 않는다(`mix10nnue.cpp` 의
`static_assert(InstType != SCALAR)`) — gomocalc README 의 4종 안내는 그 이전 것이다.

**같은 플래그인데 예외 처리가 다르게 나왔다.** gomocalc 글루에는 `invoke_*` 트램펄린
(`try{…}catch(e){…if(e!==e+0)throw e;setThrew(1,0)}`)이 35~37개 있고 우리 글루에는 없다.
전자는 Emscripten 의 JS 기반 예외(예외가 날 수 있는 호출이 JS 를 한 번 거친다), 후자는 Wasm
네이티브 예외로 내려간 모양이다 — 같은 `-fexceptions` 를 Emscripten 판이 다르게 낮춘 결과다.
탐색 핫패스에 예외 영역이 거의 없어 NPS 차이로는 드러나지 않았다(§4.4 — 1 스레드 NPS 동률).

### 2.2 변형 선택 — `src/ai/engine.js`

```js
supportThreads = await threads()          // wasm-feature-detect
const supportSIMD = await simd()
const supportRelaxedSIMD = supportThreads && (await relaxedSimd())
engineFlags = (threads ? '-multi' : '-single') + (simd && full ? '-simd128' : '') + (relaxed && full ? '-relaxed' : '')
engineDir   = loadFullEngine ? '/' : '/fallback/'
```

- **relaxed 는 멀티에만** 싣는다(단일 relaxed 는 없다).
- `loadFullEngine` 은 **서비스 워커가 있을 때만** 참이다(`App.vue`: SW `ready()` 에서 `loadEngine(true)`).
  SW 가 없으면 NNUE 없는 `fallback/` 엔진을 쓴다 — 40MB 를 매번 다시 받는 서버 비용을 피하려고
  (README, 커밋 4a36e8).
- 모든 변형이 `rapfi.data` 하나를 쓴다: `locateFile` 이 `rapfi*.data` 를 `rapfi.data` 로 돌린다.
  SW(workbox `CacheFirst`, 15일)가 이것을 캐시한다.

### 2.3 스레딩 · 워커 구조

| | gomocalc | Zenyth Web |
|---|---|---|
| 멀티 | **페이지(메인 스레드)** 에서 글루를 동적 `<script>` 로 불러 `Rapfi({...})`. PROXY_TO_PTHREAD 라 `main()` 은 pthread 에서 돈다 | **전용 워커** 안에서 불러 띄운다. pthread 워커가 같은 스크립트를 다시 읽을 때를 위해 `self.name==="em-pthread"` 가드 |
| 단일 | `worker-loader` 워커에서 `importScripts` · 동기 `sendCommand` | 같은 워커에서 동기 `sendCommand` |
| 정지 | 멀티 `YXSTOP` / 단일은 **워커 `terminate()` 후 재기동**(해시·가중치 적재를 버린다) | 멀티 `YXSTOP` / 단일은 **500ms 조각 탐색** 사이에 정지를 듣는다(해시 유지) |
| 폴백 | 없음(기능 감지로 한 번 고른다) | 멀티 기동 핸드셰이크(START→OK 15s) 실패 시 단일로 물러선다 · 첫 줄 5s 감시견 |
| 기본 스레드 | `hardwareConcurrency / 2` | `코어 − 1`, 최대 4 |

`preamble.js` 의 출력 펌프는 **글자 단위**다 — `FS.init(stdin, stdout, stderr)` 의 `stdout(char)` 가
한 글자마다 불리고 줄바꿈에서 `onReceiveStdout(line)` 를 부른다. 멀티 빌드에서 pthread 의
`fd_write` 는 런타임을 가진 스레드로 **동기 프록시**된다. gomocalc 에서는 그것이 **UI 스레드**라
화면이 바쁘면 탐색 스레드가 출력에서 기다린다. Zenyth Web 은 전용 워커라 UI 와 떨어져 있다
(이 벤치는 두 엔진을 **gomocalc 방식**으로 똑같이 띄웠으므로 이 차이는 수치에 들어 있지 않다).
(2026-10-01 추가) 출력량 자체의 비용은 현재 출력률(후보 수 1, ~70줄/초)에서 측정되지 않았다 —
SHOW_DETAIL 2/3 의 NPS 비 1 스레드 1.011 · 2 스레드 0.993(`bench/gomocalc/output-probe.mjs`).

### 2.4 메모리

gomocalc 는 선형 메모리를 **호스트가 만들어 넘긴다**(`IMPORTED_MEMORY=1`):
`initial 64MB, maximum 2048MB → 안 되면 1024 → 512`, `shared` 는 멀티만. 해시 기본값은 128MB
(`INFO HASH_SIZE 131072`, KB 단위) — Zenyth Web 기본값도 128MB 다. `--preload-file` 로 구운
가중치는 선형 메모리가 아니라 **JS 쪽 MEMFS** 에 올라간다.

### 2.5 가중치 / NNUE 적재

- 기동 때는 `config.toml` 만 읽는다. **첫 탐색에서** 규칙에 맞는 가중치를 lz4 로 풀어 올린다
  (`mix9svq nnue: … weight loaded in 412~865ms` — 이 기계 실측). 첫 「분석」이 늦는 이유 하나.
- `RELOADCONFIG` 로 config 를 바꿀 수 있다(gomocalc 는 `config.toml` · `classical220723.toml` ·
  `classical210901.toml` 셋을 싣고 설정에서 고른다).
- **relaxed SIMD 경로의 정체.** gomocalc 의 `-relaxed` 변형은 upstream `ca36fdad`(2025-09-13)
  **이전** 빌드다. 그 커밋이 지운 코드는 NNUE 내적을 `wasm_i32x4_relaxed_dot_i8x16_i7x16_add` 두
  번으로 셈했는데, 둘째 호출에 최상위 비트만 남긴 값(0x80)을 i7 자리에 넘긴다 — i7 범위 밖이라
  **결과가 구현 정의**다. 즉 gomocalc 의 relaxed 변형은 CPU·브라우저에 따라 평가가 달라질 수 있는
  경로를 탄다. **현재 upstream(=우리 소스, `3c94c2a9`)은 이 경로를 정확한 형태로 다시 넣었다**
  (2026-10-01 소스 교차 검증으로 정정 — 처음 판에는 「일반 SIMD 경로다」로 잘못 적었다):
  `eval/simd/vec.h:1112-1140` `dot2_u7i8`·`dot4_u7i8_accum` 가 relaxed 빌드에서
  `wasm_i16x8_relaxed_dot_i8x16_i7x16(b, a)`·`wasm_i32x4_relaxed_dot_i8x16_i7x16_add(b, a, acc)` 를
  쓰는데, **[0,127] 로 잘린 활성값 `a` 를 i7 자리**에 넣어 구현 정의 구간을 밟지 않는다. relaxed 빌드가
  23% 빠른 몫이 바로 이것이다(평가 한 번 ≈291K int8 MAC 의 내적이 8명령 → 1명령,
  `docs/최적화-마스터플랜.md` 1부 §2.2). relaxed 에서 결과가 갈리는 곳은 정수 내적이 아니라
  `VecOp<float,WASM_SIMD>::fmadd` 의 `wasm_f32x4_relaxed_madd`(vec.h:1701-1704, 정책 출력)다.

### 2.6 프로토콜 사용

기동: `INFO RULE` · `INFO THREAD_NUM` · `INFO CAUTION_FACTOR`(후보 범위, 기본 3) · `INFO STRENGTH` ·
`INFO TIMEOUT_TURN/MATCH` · `INFO MAX_DEPTH/MAX_NODE` · `INFO SHOW_DETAIL 3|2` · `INFO PONDERING` ·
`INFO SWAPABLE` → `START`. 탐색: `YXBOARD …DONE` (한 덩어리) → `YXNBEST n` (기본 1) 또는
`YXBALANCEONE/TWO`. 출력은 `INFO PV/NUMPV/DEPTH/SELDEPTH/NODES/TOTALNODES/TOTALTIME/SPEED/EVAL/
WINRATE/BESTLINE`, `MESSAGE REALTIME BEST/LOST`, `FORBID` — Zenyth Web 파서가 읽는 것과 같은 집합이다.

## 3. 측정 방법

### 3.1 하네스 (`bench/gomocalc/`)

| 파일 | 역할 |
|---|---|
| `fetch-engines.mjs` | gomocalc 배포본을 받고, 우리 릴리스를 `gh release download` 로 받는다(비공개 저장소) — `engines/` 는 커밋하지 않는다 |
| `page/host.js` · `page/single-worker.js` | **두 엔진을 같은 방식으로** 띄운다 — gomocalc 방식(멀티=메인 스레드, 단일=전용 워커, 선형 메모리 64MB/최대 2048MB 를 호스트가 생성) |
| `lib.mjs` | COOP/COEP 정적 서버 · Playwright 조작 · **하네스 자체 파서**(앱의 `engine-protocol.ts` 는 쓰지도 건드리지도 않는다) · VCF/VCT 판정 |
| `make-positions.mjs` → `positions.json` | 국면 생성(한 번 만들어 고정) |
| `run.mjs` | 측정 · `report.mjs` 가 표로 푼다(여러 결과 파일 병합) |
| `probe.mjs` | 탐색 한 번의 원시 출력 확인용 |

같은 명령을 두 엔진에 보낸다: `INFO SHOW_DETAIL 3` → `INFO RULE 4`(렌주) → `START 15` →
`INFO HASH_SIZE 131072` · `INFO TIMEOUT_MATCH 0` → 국면마다 `YXHASHCLEAR` · `INFO TIMEOUT_TURN 10000`
· `YXBOARD…DONE`(**한 덩어리** — 단일 빌드는 받자마자 돌려서 줄로 나누면 빈 판이 선다) ·
`YXNBEST 1`. 엔진 × 변형마다 브라우저를 새로 띄운다.

### 3.2 국면 (`positions.json`)

| id | 내용 |
|---|---|
| `open-direct` | 3수 직접 개시 h8 h9 i9 (백 차례) |
| `open-indirect` | 3수 간접 개시 h8 i9 j8 (백 차례) |
| `midgame` | 16수 중반 — 우리 엔진 자가 대국(수당 400ms), 생성 시 평가 +216 |
| `vcf` | 69수 — 둘 차례 +M13, 공격 수가 **전부 사(四)** 인 수순(`classifyWin` 판정) |
| `vct` | 24수 — 둘 차례 +M23, 수순에 삼(三)이 섞임 |

### 3.3 지표

- **로드 시간**: 글루 로드 → `Rapfi()` 해결(가중치 .data 내려받기 포함, 로컬 서버라 네트워크는 빠짐)
- **냉(冷) 탐색**: 기동 직후 첫 탐색 3초의 NPS — V8 이 wasm 을 Liftoff 로 먼저 돌리고 뜨거운 함수를
  TurboFan 으로 승격하는 구간이 섞인다. 사용자가 처음 누르는 「분석」이 이것이다.
- **BENCH**: Rapfi 내장 결정적 벤치(1 스레드, 자체 국면 10개). 결정적이라 **해시로 평가기 동일성**을
  가를 수 있다. 단 버전 사이 비교는 안 된다(§5.1).
- **예열 뒤 NPS · 도달 깊이 · 깊이 도달 시간**(엔진 TOTALTIME 기준, 처음 보고된 시각) — 국면 5 ×
  반복 2, 스레드 1/2(/4).
- **평가 일관성**: 반복·스레드·엔진 사이의 최선수·평가값.
- **메모리**: 선형 메모리 `buffer.byteLength` (기동 후 / 탐색 후). 페이지 전체
  (`measureUserAgentSpecificMemory`)는 헤드리스에서 값을 돌려주지 않아 비었다.

### 3.4 두 기계

| | CI (주 자료) | 로컬 (보조) |
|---|---|---|
| CPU | Intel Xeon Platinum 8370C @ 2.80GHz, **논리 2**(비공개 저장소 러너) | Intel Celeron N4500 @ 1.10GHz, 물리 2코어, AVX2 없음 |
| RAM · OS | 7.8GB · Linux 6.17 (Azure) | 3.8GB · Windows 11 |
| 브라우저 | Chromium 151.0.7922.34 (Playwright 헤드리스) | 같음 |
| 잡음 | 적음 | **사용 중인 데스크톱이다.** 첫 런에서 우리 멀티 변형이 3.6K nps 까지 떨어져 그 변형만 다시 쟀다(`local-rerun-rapfiweb-multi.json`). 그래도 편차가 크다 — 결론은 CI 로 낸다 |

⚠ CI 러너가 **논리 2개**(대개 물리 1코어 + 하이퍼스레드)라 4 스레드는 초과 구독이고, 2 스레드
확장도 물리 2코어인 로컬보다 작게 나온다.

## 4. 결과

### 4.1 기동 · 메모리

| 엔진/변형 | 로드 ms CI | 로드 ms 로컬 | 기동 후 wasm MB | 탐색 후 wasm MB (CI) |
|---|---|---|---|---|
| gomocalc/single | 426 | 869 | 153 | 220 |
| gomocalc/multi | 418 | 1,595 | 155 | 223 |
| gomocalc/multi-relaxed | 410 | 738 | 155 | 223 |
| rapfiweb/single | **235** | **389** | 147 | 275 |
| rapfiweb/multi | **233** | 388~673 | 149 | 215 |
| rapfiweb-full/single | 335 | — | 147 | 212 |

- 로드 차이는 대부분 **.data 크기**(19.9MB ↔ 40.3MB)다. 로컬 서버라 네트워크가 빠진 값이므로,
  실제 첫 방문에서는 20MB 를 덜 받는 차이가 훨씬 크게 난다.
- 선형 메모리는 기동 후 147~155MB(해시 128MB 포함), 탐색 뒤 212~275MB 로 두 엔진이 같은 급이다.
  우리 single 의 275MB 는 한 번 자란 뒤 줄지 않는 wasm 메모리의 성질상 가장 큰 탐색의 자취다.

### 4.2 냉 탐색 (첫 탐색 3초, 1 스레드, open-direct)

| | CI 냉 → 예열 | 로컬 냉 → 예열 |
|---|---|---|
| gomocalc/single | 71.2K → 79.4K (−10%) | 31.0K → 38.8K (−20%) |
| rapfiweb/single | 65.9K → 79.3K (−17%) | 34.7K → 39.5K (−12%) |
| gomocalc/multi-relaxed | 95.8K → 105.5K (−9%) | 32.7K → 44.3K (−26%) |
| rapfiweb-full/multi-relaxed | 85.4K → 98.8K (−14%) | — |

첫 탐색은 **10~26% 느리다**(JIT 승격 전). 여기에 첫 탐색 앞의 가중치 적재 0.4~0.9초가 더해진다.

### 4.3 BENCH (결정적, 1 스레드)

| 엔진/변형 | 가중치 | 노드 | 시간 ms (CI) | nps = 노드÷시간 | 엔진이 찍은 Nodes/s | Hash |
|---|---|---|---|---|---|---|
| gomocalc/single | 4종 | 3,628,934 | 75,535 | 48,043 | 48,043 | 662ab34c |
| gomocalc/multi-relaxed | 4종 | 3,628,934 | 50,011 | 72,563 | 72,562 | 662ab34c |
| rapfiweb/single | **렌주만** | 7,170,518 | 33,733 | 212,567 | **85,244 ✗** | 2b7c7da9 |
| rapfiweb-full/single | 4종 | 4,391,204 | 81,955 | 53,581 | **1,174 ✗** | 4100a973 |
| rapfiweb-full/multi-relaxed | 4종 | 4,391,204 | 62,715 | 70,018 | **1,534 ✗** | 4100a973 |
| *(참고) 네이티브 x86 AVX2·AVX512* | 4종 | 4,391,204 | 21,595 | 203,343 | — | e240ab16 |
| *(참고) 네이티브 x86 SSE 128bit* | 4종 | 4,391,204 | 35,340 | 124,255 | — | e240ab16 |

로컬(Celeron) 보충: gomocalc single 139.7s · multi 163.7s · multi-relaxed 114.0s(해시 모두 662ab34c),
rapfiweb single 60.3s · multi 65.8s.

읽는 법:
- **relaxed 는 결과를 바꾸지 않았다.** gomocalc 도 우리도 relaxed 빌드의 해시·노드 수가 일반
  빌드와 같다(662ab34c · 4100a973). 이 두 x86 기계에서는 구현 정의 경로가 같은 값을 냈다는 뜻이다.
- **relaxed 의 순수 효과**(같은 버전·같은 멀티 빌드 쌍): 우리 81.96s → 62.72s(**1.31배**, single 과
  비교), gomocalc 로컬 163.7s → 114.0s(**1.44배**, AVX2 없는 Celeron).
- 렌주 전용 배포 빌드의 212K nps 는 **부풀려진 값**이다 — BENCH 국면 10개 중 7개가 프리스타일·
  스탠다드라 가중치가 없어 싼 classical 폴백으로 돈다(spike/web-baseline.json 의 기록 그대로).
- **wasm 과 네이티브는 같은 트리를 돈다**(노드 4,391,204 동일). 그 위에서 wasm SIMD128 은 네이티브
  SSE 의 43%, relaxed 는 56%, AVX2 네이티브의 26~34% 다.
- 버전 사이 BENCH 는 비교하지 않는다: `0e1f7ed5` 가 BENCH 의 국면·깊이를 바꿨다(노드 3.63M ↔ 4.39M).

### 4.4 예열 뒤 NPS (1 스레드, 국면별 평균)

| CI | open-direct | open-indirect | midgame | vcf | vct | 기하 평균 |
|---|---|---|---|---|---|---|
| gomocalc/single | 79.4K | 53.5K | 121.5K | 140.5K | 115.4K | 96.5K |
| rapfiweb/single | 79.3K | 54.4K | 114.4K | 151.1K | 124.2K | **98.5K (+2.1%)** |
| gomocalc/multi | 78.6K | 52.9K | 121.3K | 139.7K | 113.5K | 95.6K |
| gomocalc/multi-relaxed | 105.5K | 76.0K | 153.7K | 154.1K | 126.4K | **119.1K (+24.6%)** |
| rapfiweb-full/multi | 79.2K | 54.6K | 114.9K | 148.1K | 124.6K | 98.3K |
| rapfiweb-full/multi-relaxed | 98.8K | 71.4K | 170.7K | 162.3K | 132.8K | **121.0K (+23.1%)** |

로컬: gomocalc/single 43.5K ↔ rapfiweb/single 45.5K(+4.6%) · gomocalc/multi-relaxed 51.2K
(multi 45.0K 대비 +13.8%).

- 두 버전의 NPS 는 **±2~5% 안에서 같다.** 국면별로는 중반에서 gomocalc 가 6% 빠르고 VCF·VCT 에서
  우리가 7~8% 빠르다(수 생성·패턴 개선이 위협 탐색에서 드러남).
- 단일 빌드 ↔ 멀티 빌드 1 스레드 차이는 1% 안이다(원자 연산 비용이 무시할 만하다). BENCH 로는
  로컬에서 멀티 빌드가 9~17% 느리게 나왔는데 잡음이 큰 기계라 확정하지 않는다.
- relaxed 의 이득은 개시·중반(NNUE 비중 큰 국면)에서 크고(+25~49%), VCF·VCT(위협 탐색이 많은
  국면)에서 작다(+7~11%).

### 4.5 깊이 도달 시간 (1 스레드, 엔진 TOTALTIME ms, CI)

국면마다 모든 구성이 도달한 가장 깊은 공통 깊이(D)와 그 아래:

| 국면 | 깊이 | gomocalc/single | rapfiweb/single | 차이 | gomocalc relaxed | rapfiweb-full relaxed |
|---|---|---|---|---|---|---|
| open-direct | 15 | 309 | 1,583 | +412% | 233 | 1,243 |
| open-direct | 17 | 4,883 | **1,825** | **−63%** | 3,637 | 1,437 |
| open-indirect | 16 | 1,829 | 1,524 | −17% | 1,307 | 1,172 |
| open-indirect | 18 | 5,563 | **2,738** | **−51%** | 3,948 | 2,099 |
| midgame | 16 | 1,621 | 3,920 | +142% | 1,161 | 3,110 |
| midgame | 18 | 8,090 | **7,075** | **−13%** | 6,272 | 5,603 |
| vcf | 26 | 2,424 | **2,258** | **−7%** | 2,211 | 2,104 |
| vct | 27 | 8,737 | **7,055** | **−19%** | 7,983 | 6,608 |

같은 버전 안의 relaxed 효과(가장 깊은 공통 깊이): gomocalc −22~−29%(개시·중반) · −9%(VCF·VCT),
우리 −21~−23% · −6~−7%(VCF·VCT).

### 4.6 스레드 확장 (기하 평균 NPS, t1 대비)

| | CI 2 스레드 | CI 4 스레드(초과 구독) | 로컬 2 스레드(물리 2코어) |
|---|---|---|---|
| gomocalc/multi | ×1.06 | ×1.21 | ×1.64 |
| gomocalc/multi-relaxed | ×1.13 | ×1.14 | ×1.76 |
| rapfiweb/multi | ×1.14 | ×1.18 | ×1.94 (단일 t1 45.5K 대비) |
| rapfiweb-full/multi-relaxed | ×1.06 | ×1.06 | — |

CI 는 하이퍼스레드 한 쌍이라 확장이 거의 없고, 물리 2코어(로컬)에서는 1.6~1.9배다. 로컬 우리
t2 가 gomocalc t2 보다 20% 높았다(88.3K ↔ 73.7K) — 잡음이 큰 기계라 추세로만 본다.

### 4.7 평가 일관성

- **1 스레드는 결정적이다** — 같은 빌드의 반복 두 번이 최선수·평가값 모두 같다(편차 ±0, 두 엔진 모두).
  탐색 시간이 끝을 정하므로, 같은 소스라도 빠른 빌드(relaxed)는 더 깊이 가서 **값이 달라진다**
  (예: 우리 open-indirect −275 → relaxed −331). BENCH 해시가 같으므로 평가기는 같다.
- **멀티 스레드는 비결정적이다**(Lazy SMP) — 중반 평가 편차가 ±44(t2) ~ ±552(t4)까지.
- **최선수 일치율**(CI, 전 구성·전 반복 36회): VCF i4 **36/36** · VCT l12 **36/36** · 중반 l9 33/36 ·
  간접 개시 i8 32/36 · 직접 개시 j10 23/36(g7 13) — 직접 개시는 두 수가 비슷해 두 엔진 모두 스레드
  수에 따라 오간다. **엔진 사이에 체계적으로 갈리는 최선수는 없다.**
- **필승 발견은 한 국면에서 엇갈렸다.** CI 중반 국면에서 gomocalc 1 스레드는 10초 안에 **+M43** 을
  찾았고(두 반복 모두), 우리 1 스레드는 776 에 머물렀다. 우리는 2 스레드 반복 하나에서 +M57, 4 스레드
  에서 +M61 을 찾았다. 로컬(느린 CPU)에서는 gomocalc 1 스레드도 못 찾았다(289). 국면 하나의 일화라
  일반화하지 않는다. (2026-10-01 정정) 처음 판의 「0.43.02 의 축소·가지치기 변화」는 틀렸다 —
  `search/ab/parameter.h` 는 두 판 사이 diff 가 **0줄**이고 가중치도 바이트까지 같다. 갈림은 ply 2 의
  방어(m10 ↔ l8)를 증명하는 순서이고, 방어를 고정하면 우리가 1.4~2.3배 빨리 필승을 찾는다 —
  원인 규명과 대책은 `docs/최적화-마스터플랜.md` 1부 §1.

## 5. 해석

### 5.1 BENCH 로 버전을 비교하면 안 되는 이유 둘

1. `0e1f7ed5`(0.43.02) 가 BENCH 의 수 정렬과 깊이를 바꿔 **노드 수 자체**가 다르다(3.63M ↔ 4.39M).
2. 렌주 전용 배포 .data 로는 BENCH 국면 7/10 이 폴백 평가로 돈다. 그래서 같은 가중치 비교는
   `rapfiweb-full` 로만 했다 — 그래도 1번 때문에 버전 사이 비교가 아니라 **같은 버전 안의
   relaxed·단일/멀티·네이티브 비교**에만 쓴다.

**upstream 결함(보고 대상)**: BENCH 가 찍는 `Nodes/s` 는 `nodes × 1000` 을 `size_t` 로 셈하는데
wasm32 에서 32비트라 노드가 약 429만을 넘으면 접힌다 — 4,391,204 노드가 1,174 로, 우리 배포 BENCH 의
7,170,518 노드가 47,702 로(실제 118,952) 찍힌다. 2026-09-01 에 해시 계산에서 찾은 폭 문제와 같은 부류다
(spike/web-baseline.json). 하네스는 노드 ÷ 시간으로 직접 셈한다.

### 5.2 "NPS 는 같은데 깊은 쪽에서 더 빨리 닿는다"

노드 한 개의 비용은 NNUE 추론이 대부분이고, 그 코드는 두 버전 사이에 인라인·합 유도 정도만 바뀌었다
→ NPS 동률. 대신 0.43.02 의 결정적 수 정렬·보드 상태 재설계·자식 TT 프리페치가 **같은 노드 수로 더
깊이** 가게 한다 — 가장 깊은 공통 깊이에서 7~63% 빨랐다. 얕은 깊이(15~16)에서 gomocalc 가 훨씬
빨리 찍는 것은, 두 버전이 반복 심화의 깊이를 다르게 세고(분수 깊이·축소 규칙 변화) 0.43.01 이
얕은 반복을 더 가볍게 지나기 때문으로 보인다 — 깊이 숫자 자체를 버전 사이에 1:1 로 맞출 수 없다는
뜻이다. 결론은 "같은 10초에 무엇을 찾았나"(§4.7)와 가장 깊은 공통 깊이로 내린다.

### 5.3 wasm 이 네이티브에 뒤지는 몫

같은 트리에서 네이티브 SSE 대비 wasm 43%. 큰 몫은 **SSE 명령이 SIMD128 에 없어서** 생긴다 — Rapfi 는
x86 intrinsics 를 SIMDe 로 옮기는데, `pmaddubsw` 류 i8 내적·`pshufb` 셔플·블렌드 같은 명령이 여러
SIMD128 명령으로 풀린다. relaxed SIMD 는 그중 일부를 한 명령으로 되돌린다(+31%, 56% 로). 남는 격차는
relaxed 로도 못 닿는 명령과 wasm 실행 자체의 비용이다.

## 6. 최적화 방안 — Rapfi(gomocalc)를 앞서기 위해

우선순위는 **측정된 이득 ÷ 위험**으로 매겼다. 모두 `bench-gomocalc.yml` 로 전후를 다시 잴 수 있다.

> **①②③ 적용됨 (2026-09-30, 릴리스 `engine-3c94c2a9-rx`)** — 변형 4종(relaxed 멀티·단일 추가),
> 감지·순서·폴백(`engine-client.ts` `planVariants`), relaxed 멀티 전용 워커 번들
> (`engine-worker-relaxed.ts` — 엔진 스레드가 relaxed 글루를 읽게), 공유 가중치 `rapfi.data` +
> Cache Storage 캐시 계층·SHA-256 검증(`weights-cache.ts`, `engine-manifest.json`), 기동 때
> 예열 탐색(`engine-worker.ts` `warmup`). 배포 게이트: 받은 `rapfi.data` 가 커밋된 매니페스트와
> 같은가(`scripts/verify-engine.ts`).
>
> **릴리스 때 새로 알게 된 것 — relaxed 는 classical 평가 경로에서 기계마다 값이 갈린다.**
> 렌주 전용 .data 로 BENCH 를 돌리면 국면 7/10 이 classical 폴백으로 도는데, relaxed 단일의
> 해시가 두 릴리스 런에서 dd5e1c73(7,387,373 노드) · b63e6b5f(7,301,332)로 **서로도** 달랐다
> (일반 SIMD 는 두 번 다 2b7c7da9). §4.3 의 「relaxed 해시 = 일반 해시」는 가중치 4종 빌드 —
> 10개 모두 NNUE — 에서, 그것도 **그 Intel Xeon 에서만** 참이었다. 렌주·NNUE 국면 5개를
> 1 스레드 고정 깊이로 두 빌드에 읽힌 결과(`spike/relaxed-equivalence.mjs`), AMD EPYC 9V74
> 러너에서는 4개가 비트까지 같고 **직접 개시 하나가 갈렸다** — 최선수는 같은 g7, 평가 −352 ↔
> −404, 노드 114,126 ↔ 58,895. relaxed 의 부동소수 연산(곱합 등)이 CPU 에 따라 반올림을 달리하는
> 것으로, 명세가 허용하는 차이다.
>
> **결정: relaxed 는 싣는다, 「결과 불변」은 약속하지 않는다.** 웹은 이미 「폰과 비트 단위
> 동일」을 게이트에서 내렸다(spike/web-baseline.json). 그래서 릴리스 게이트는 비트 동일이 아니라
> **건전성**이다 — 필승 국면은 같은 쪽 필승을 찾고, 점수 국면은 평가 차 150 안. 비트 차이는
> 경고로 남는다. 기기 사이 재현이 필요하면 `?relaxed=0` 으로 일반 SIMD 를 쓴다. §6-① 의 「결과
> 불변」은 이 단서와 함께 읽어야 한다. ARM 기기에서의 확인은 아직이다.

### ① relaxed SIMD 변형을 싣는다 — **측정된 +23~31%, 결과 불변**

- 근거: §4.3·4.4. 같은 소스에서 NPS +23.1%, BENCH 1.31배, 해시·노드 동일.
- 방법: `EXTRA_VARIANTS=multi-simd128-relaxed` (이번에 스크립트에 넣은 스위치) 로 릴리스에 더하고,
  `engine-client.ts` 의 능력 감지에 relaxed 판정(`WebAssembly.validate` 로 relaxed 명령 하나를
  담은 작은 모듈을 검사)을 붙여 **멀티 → multi-relaxed 우선, 실패 시 multi → single** 로 물러선다.
  단일 relaxed(`single-simd128-relaxed`)도 같은 스위치로 만들 수 있다 — 격리 없는 환경용.
- 위험: relaxed 는 **명세상 구현 정의**다. 이번 검증은 x86 두 기계뿐이다. ARM(안드로이드 Chrome,
  Apple Silicon)에서 BENCH 해시가 같은지 반드시 확인하고, 다르면 ARM 에서는 relaxed 를 끈다.
  지원 브라우저는 Chromium 계열(114+)뿐이라 Firefox·Safari 는 지금과 같은 경로다.
- 비용: 변형 하나(.js/.wasm ~1.2MB). .data 는 ②로 공유하면 늘지 않는다.

### ② 변형 간 .data 를 하나로 — 폴백 때 20MB 재다운로드 제거

지금 `rapfi-multi-simd128.data` 와 `rapfi-single-simd128.data` 는 **같은 내용(19,865,582B)** 을 다른
이름으로 둔다. 멀티 기동이 실패해 단일로 물러서면 같은 20MB 를 다시 받는다. gomocalc 처럼
`locateFile` 에서 `rapfi-*.data` 를 한 이름으로 돌리면 캐시가 그대로 맞는다(글루의 패키지 목록이
같아야 하므로 **같은 빌드**의 변형끼리만 — 지금 릴리스가 그렇다). relaxed 변형을 더할 때 필수다.

### ③ 가중치 선적재 + JIT 예열 — 첫 분석 10~26% + 0.4~0.9초

첫 탐색은 JIT 승격 전이라 10~26% 느리고(§4.2), 그 앞에 가중치 적재가 붙는다. 엔진 핸드셰이크 직후
**빈 판 짧은 탐색 한 번**(예: 300ms)을 보이지 않게 돌려 두면 둘 다 사용자가 누르기 전에 끝난다.
V8 은 스트리밍 컴파일된 큰 모듈의 최적화 코드를 HTTP 캐시에 보관하므로, 두 번째 방문부터는 더
줄어든다(`.wasm` 이 `application/wasm` 으로 나가야 한다 — Cloudflare 기본값).

### ④ ~~relaxed 내적 경로를 정확한 형태로 다시 쓴다~~ — **이미 upstream 에 있다**

(2026-10-01 정정) 제안한 형태 그대로 우리 소스에 들어 있다 — `eval/simd/vec.h:1126-1140`
`dot4_u7i8_accum` 이 u7 활성값을 i7 자리에 넣는다(§2.5). 따라서 relaxed 의 남은 여지는 정수 내적이 아니라
`mulhi`(3명령), 프리페치 소실, codebook gather 다 — `docs/최적화-마스터플랜.md` 1부 §2 가 프로파일로 이어 다룬다.
wasm relaxed(70K)와 네이티브 SSE(124K) 사이의 격차는 그대로다.

### ⑤ 빌드 플래그 실험 — 기대 작음, 순서대로 싸게

| 후보 | 지금 | 기대 | 비고 |
|---|---|---|---|
| LTO | **이미 켜짐**(`-flto` 강제) | — | `ENABLE_LTO` 는 wasm 에서 의미 없다 |
| `-O3` | 켜짐 | — | |
| `wasm-opt -O4 --converge` 후처리 | 없음 | 수 % | 비용 거의 0, 해시로 검증 |
| PGO | 없음 | 미지수 | Emscripten 4.0.11 부터 `-fprofile-instr-generate` 계측이 들어왔다(ChangeLog, 커버리지 용도). 계측 빌드를 node 에서 BENCH 로 돌려 `.profraw` → `llvm-profdata` → `-fprofile-instr-use` 로 재빌드하는 경로는 원리상 열려 있으나 **검증 전**이다 |
| `-sMALLOC=mimalloc` | dlmalloc | 작음 | 알파베타 탐색은 탐색 중 할당이 드물다. 멀티 스레드에서만 의미 |
| `-fno-exceptions` | 불가 | — | cpptoml 이 예외를 쓴다. 우리 빌드는 이미 Wasm 네이티브 예외(트램펄린 0) |
| `-ffp-contract=off` 해제 | 켜짐 | 작음 | **하지 말 것** — 네이티브·폰과 결과를 맞추는 근거다 |

### ⑥ 가지치기 매개변수 — NPS 가 아니라 **대국 승률**로만

`Rapfi/search/ab/parameter.h` 의 값은 규칙별 `constexpr` 이다(예: `FutilityScale[RULE_NB] = {63, 61, 80}`,
`NMMBias = {585, 538, 624}`, `IIR_REDUCTION 0.69`, `SE_DEPTH 6.65` …). 이것을 바꾸면 NPS 가 아니라
**트리 모양**이 바뀌므로 이 벤치로는 좋고 나쁨을 가를 수 없다(깊이가 빨리 나와도 약해질 수 있다).
해야 한다면: 네이티브 빌드(wasm 보다 2~4배 빠름)로 **SPRT 자가 대국**(수천 판, 고정 시간)을 돌려
Elo 로 판정하고, 통과한 값만 wasm 으로 옮긴다. `make-positions.mjs` 의 자가 대국 틀이 출발점이 된다.
§4.7 의 중반 +M43 사례가 첫 점검 국면 후보다.

### ⑦ 구조 — 이미 앞서 있는 것 (유지)

- 멀티 엔진을 **전용 워커**에 둔다(gomocalc 는 메인 스레드) — pthread 출력 프록시가 UI 와 떨어져 있다.
- 단일 변형의 정지를 **조각 탐색**으로 듣는다(gomocalc 는 워커를 죽여 해시·가중치 적재를 버린다).
- 멀티 기동 실패 시 단일로 **자동 폴백**한다.
- 렌주 전용 .data 로 **20MB 를 덜 받는다.**

## 7. 한계

- CI 러너가 논리 2개라 4 스레드 수치는 초과 구독이고, 로컬은 사용 중인 데스크톱이라 잡음이 크다.
  스레드 확장의 절대값은 물리 4코어 이상에서 다시 재야 한다.
- 두 엔진을 **gomocalc 방식 호스트**로 똑같이 띄웠다 — 우리 앱의 실제 경로(전용 워커, 단일 변형 500ms
  조각)의 비용은 이 표에 없다. 앱 경로는 `scripts/engine-smoke.ts` 가 기능을 지키고 있다.
- 국면 5개. VCF/VCT 판정은 엔진이 적은 BESTLINE 에 기댄다(끝 3수가 빠진다 — `lib.mjs` 주석).
- relaxed 의 결과 불변은 **x86 두 기계**에서만 확인했다.
- 페이지 전체 메모리(`measureUserAgentSpecificMemory`)는 헤드리스에서 값이 없었다.

## 부록 — 다시 재는 법

```bash
node bench/gomocalc/fetch-engines.mjs                        # gomocalc 배포본 + 우리 릴리스(gh 로그인 필요)
node bench/gomocalc/run.mjs                                  # 기본: 두 엔진 · 전 변형 · 1/2 스레드 · 10초 × 2
LABEL=x THREADS=1 TIME_MS=5000 REPEAT=1 node bench/gomocalc/run.mjs
node bench/gomocalc/report.mjs bench/gomocalc/results/x.json [보충.json …]
gh workflow run bench-gomocalc.yml -f build_full=true        # CI: 가중치 4종 + relaxed 실험 빌드까지
```
