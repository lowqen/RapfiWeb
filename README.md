# RapfiWeb

RapfiDroid(안드로이드 오목·렌주 분석반)의 **웹 이식**. Rapfi 엔진을 WebAssembly 로
브라우저 안에서 돌린다. 서버에 붙지 않는다 — 대국·채팅·랭킹 서버 연동은 범위 밖이다.

- 설계: [`../test-yixin/docs/웹_이식_계획.md`](../test-yixin/docs/웹_이식_계획.md)
- W0 스파이크 결과: [`docs/W0-결과.md`](docs/W0-결과.md) — 부록에 upstream 이슈 초안(미제출)
- 엔진 최적화: [`docs/최적화-마스터플랜.md`](docs/최적화-마스터플랜.md) — 맨 앞 **통합 상태판**이 항목별 상태의 정본
- gomocalc 대국: [`docs/gomocalc-대국-분석.md`](docs/gomocalc-대국-분석.md) — 1 스레드 · 500ms 에서 **Elo +100.2**. 쇼케이스 `pnpm showcase:dev`(`showcase/`)

## 지금 어디까지 와 있나

| 단계 | 내용 | 상태 |
|---|---|---|
| **W0** | stdin·빌드·BENCH 스파이크 | 완료 — W0-3 원인 확정·해소 |
| **W1** | 스캐폴딩 — Vite·React·라우팅·AppShell·디자인 토큰·CI | 완료 |
| **W2** | 보드 렌더링(Canvas 2D 2레이어) · 값 사다리 · Kotlin 톤 대조 | 완료 |
| **W3** | 엔진 워커 + 프로토콜 이식 + 집계 + 분석 pane | 완료 |
| **W4** | 보드 화면 — [대국] · [분석] 탭, 개시(자유 렌주 · RIF · 첫 수 이후 교환) | 완료 — 렌주 전용, 대국 시계 없음 |
| **W5a** | 기반 — Dexie v1 + 판 자동 저장 · 기보 열기/저장(.psq · .sav · .pos) · `PosKey` | 완료 — `?p=` 국면 딥링크만 남음 |

남은 단계는 아래 순서로 간다(근거는 설계 문서 부록 A — 2026-10-09 재배열).

| 순서 | 단계 | 내용 |
|---|---|---|
| 1 | W6a | 오프닝 탭 중 팩 없이 되는 부분(주형 이름 249 · 흑5수 유불리 1,889 · 26주형) |
| 2 | W6b | 리뷰 — 대국 전체 되짚기 · 수 등급 · 리포트 · 작업 큐 |
| 3 | W6c | 수순 — 같은 국면에 이르는 다른 수순 |
| 4 | W9 | 정석 — 에디터 · 트리 · 정규 키 역조회 |
| 5 | W6d | 증명 — W6b 의 큐 위에 |
| 6 | W5b | settings.txt 67항목 왕복 · 다크 모드 오라클 |
| 7 | W7 | `.rif` 변환 · 팩 리더 · 오프닝 빈도 · 랭킹 |
| 8 | W8 | DB 화면 + IDBFS (엔진 재빌드 필요) |
| 9 | W10 | 디자인 마감 · 반응형 · 접근성 |

보드 · 엔진 · 설정 화면은 실물이다. 나머지 여섯 화면(연구 네 탭 · DB · 정석)은 라우팅과 셸이 다
연결돼 있고 내용은 「무엇이 될 자리인지」를 적은 자리표시자다.

**판은 저절로 남는다.** 두고 무른 수까지 IndexedDB(`rapfiweb` ▸ `games`)에 자동 저장되어
새로고침해도 이어진다. 기보는 국면 카드의 「기보 열기」나 판에 파일을 끌어다 놓아 열고,
「.psq 저장」 · 「.sav 저장」으로 지금 판을 내보낸다(Chromium 은 저장 창, 그 밖은 내려받기).

엔진은 **앱이 뜨면 뒤에서 자동으로 기동한다.** 상단 바의 엔진 표시가 단계(가중치 받기 →
엔진 → 예열 → 준비)를 말하고, 그동안에도 판은 바로 둘 수 있다. 20MB 가중치는 처음 한 번만
받고 그 뒤로는 캐시에서 읽는다. 끄려면 설정 ▸ 「앱을 열면 엔진 시작」, 한 번만 건너뛰려면
주소에 `?autoboot=0`. 산출물이 없는 개발 환경에서는 기동이 「엔진 오류」로 조용히 끝난다.

**엔진 선택.** 상단 바(와 설정 ▸ 엔진)의 드롭다운으로 자동 · Multi-thread · WASM Relaxed-SIMD ·
WASM Standard SIMD 중에서 고른다. 바꾸면 떠 있는 워커를 깨끗이 내리고 그 바이너리로 다시
띄운다 — 켜 둔 분석은 새 엔진이 이어 읽는다. 이 환경에서 못 쓰는 항목은 까닭과 함께 잠긴다.

**보드는 [대국] | [분석] 두 탭이다.** 판(기보)은 함께 쓰고 엔진의 쓰임만 갈린다.

| 탭 | 옆 칸 | 엔진 |
|---|---|---|
| 대국 | 흑/백 · 시간 제어 · 레벨(노드 수) · 스레드 · 개시 · 기권/무승부 | 제 차례에만 둔다. 판에 분석 오버레이를 얹지 않는다 |
| 분석 | DEPTH · NPS · PV · 형세 그래프 · 분석 시간 · 후보 수 | 국면을 따라 읽는다. 「정지」는 그 순간의 최선수를 둔다(빈 판이면 H8) |

탭을 바꾸면 대국 → 분석은 엔진이 생각하던 수를 **버리고**, 분석 → 대국은 분석을 **멈추기만**
한다(최선수를 두지 않는다). 무르기·처음으로 직후에는 앞날 국면의 값 칩 · PV · 평가가 판에
남지 않는다 — 엔진의 답에는 국면 키가 붙어 있고 화면은 지금 판의 키와 맞을 때만 그린다.

**이 웹 버전은 렌주 전용이다.** 가중치가 규칙마다 10MB 씩이고 Cloudflare 는 파일당
25MB 가 상한이라, 렌주 흑/백 두 개만 싣는다(`src/core/model/rules.ts`).

## 로컬 개발 환경

필요한 것은 **Node**(CI 는 26, 최소 20.11)와 **pnpm** 둘뿐이다.

```bash
# 1. Node 26 — CI(.github/workflows/*)와 같은 주 버전
#    Windows:  winget install OpenJS.NodeJS
#    macOS:    brew install node
#    Linux:    https://github.com/nodesource/distributions

# 2. pnpm — 노드 25+ 에는 corepack 이 딸려 오지 않는다. pnpm 10+ 는 package.json 의
#    packageManager(pnpm@9.12.3)를 읽어 그 판으로 스스로 바꿔 돈다.
npm install -g pnpm

# 3. 의존성
pnpm install

# 4. 개발 서버 — http://localhost:5173
pnpm dev
```

`pnpm dev` 는 먼저 `scripts/gen-tokens.ts` 로 `src/styles/tokens.css` 를 굽고 Vite 를 띄운다.
그 CSS 는 **생성물이라 커밋하지 않는다** — 원본은 `src/core/design/` 의 TS 다.

### 자주 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `pnpm dev` | 토큰 생성 + 개발 서버 |
| `pnpm build` | 토큰 생성 + 타입 검사 + 프로덕션 빌드 (`dist/`) |
| `pnpm preview` | 빌드 결과를 그대로 띄워 본다 |
| `pnpm test` | 단위 시험 (팔레트 골든 앵커, 프로토콜 직렬화) |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm check` | 위 전부를 CI 와 같은 순서로 |
| `pnpm gen:tokens` | 토큰만 다시 굽기 |

### 엔진(WASM)을 직접 빌드하려면

리눅스 x86_64 가 필요하다(GitHub Actions `ubuntu-latest` 에서 그대로 돈다).

```bash
pnpm engine:build          # tools/build_engine_wasm.sh
```

`out/engine/` 에 나온 것을 `public/engine/` 으로 옮기면 앱이 그걸 쓴다.
`.env` 의 `VITE_ENGINE_BASE_URL` 로 다른 경로를 가리킬 수도 있다.

**빌드하지 않고 받아 쓰는 쪽이 빠르다.** `.js`/`.wasm` 은 이미 저장소에 있고,
20MB 짜리 `.data` 만 릴리스에서 받으면 된다:

```bash
# 태그는 src/engine/engine-manifest.json 의 tag 와 같아야 한다(지금 engine-3c94c2a9-a3)
gh release download engine-3c94c2a9-a3 --dir public/engine --pattern 'rapfi.data'
```

릴리스가 없으면 Actions ▸ **엔진 릴리스 (WASM 산출물)** 을 한 번 돌린다.

## 배포

**Cloudflare Pages** 로 나간다. 처음 한 번의 설정과 그 뒤의 흐름은
[`docs/배포-cloudflare.md`](docs/배포-cloudflare.md) 에 처음부터 끝까지 적어 두었다.

> Cloudflare 는 파일 하나가 25MB 를 넘으면 거부한다. 렌주 전용으로 줄여 `.data` 가
> 약 19.9MB 이므로 통과한다 — 자세히는 `docs/배포-cloudflare.md` 의 「알아 둘 것」.

## 이 저장소에서 절대 하지 말 것

**RenjuNet 파생 자료(`.rif`, `*.pack`, `freq_data.json`, `renju*.sqlite`)를 커밋하지 않는다.**
라이선스가 «비상업·오프라인 전용, 재배포 금지»를 명시하고, 웹에서는 커밋이 곧
«온라인 시스템에 게시»라 앱보다 더 위험하다. `.gitignore` 와 CI 게이트가 둘 다 막고 있지만,
막는 장치가 있다는 것이 해도 된다는 뜻은 아니다.

가중치(`*.bin.lz4`)는 CC0 라 재배포는 자유롭지만 20MB 라 릴리스 자산으로 나른다.

## 브라우저 요구사항

**WebAssembly SIMD 가 하한선이다.** 비SIMD 변형은 이 엔진 커밋에서 빌드되지 않는다
(`eval/mix10nnue.cpp` 의 `static_assert`). 하향할 변형이 없으므로 미달 브라우저는
안내 화면으로 끝난다.

| | 최소 |
|---|---|
| Chrome / Edge | 91 |
| Firefox | 89 |
| Safari | **16.4** (iOS 16.4 미만은 지원하지 않는다) |

COOP/COEP 헤더는 **멀티스레드 엔진에만** 필요하다(`public/_headers`). 헤더를 붙일 수 없는
호스팅(GitHub Pages 등)에서는 앱이 단일 스레드 엔진으로 물러선다 — 그래서 정적 파일을 얹을 수
있는 곳이면 어디든 올라간다.

## 라이선스

배포물에 Rapfi(GPL-3.0-or-later)가 포함되므로 **전체가 GPL-3.0-or-later** 로 배포된다.
이 저장소가 직접 쓴 코드는 BSD-2-Clause 로도 쓸 수 있다.
