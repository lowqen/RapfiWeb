# RapfiWeb

RapfiDroid(안드로이드 오목·렌주 분석반)의 **웹 이식**. Rapfi 엔진을 WebAssembly 로
브라우저 안에서 돌린다. 서버에 붙지 않는다 — 대국·채팅·랭킹 서버 연동은 범위 밖이다.

- 설계: [`../test-yixin/docs/웹_이식_계획.md`](../test-yixin/docs/웹_이식_계획.md)
- W0 스파이크 결과: [`docs/W0-결과.md`](docs/W0-결과.md)
- upstream 이슈 초안: [`docs/upstream-이슈-초안.md`](docs/upstream-이슈-초안.md)

## 지금 어디까지 와 있나

| 단계 | 내용 | 상태 |
|---|---|---|
| **W0** | stdin·빌드·BENCH 스파이크 | 완료 (원인 규명까지) |
| **W1** | 스캐폴딩 — Vite·React·라우팅·AppShell·디자인 토큰·엔진 골격·CI | **여기** |
| W2 | 보드 렌더링 (Canvas 2D 2레이어) | |
| W3 | 엔진 워커 + 프로토콜 + 집계 + 가중치 로더 | |
| W4~ | 보드 화면 · 설정 · 연구 · 정석 | |

화면 아홉 개는 라우팅과 셸이 다 연결돼 있고, 내용은 각 화면이 «무엇이 될 자리인지»를
적은 자리표시자다. 엔진은 아직 자동으로 뜨지 않는다(`public/engine/` 이 비어 있다).

## 로컬 개발 환경

필요한 것은 **Node 20.11 이상**과 **pnpm 9** 둘뿐이다.

```bash
# 1. Node 20 LTS
#    Windows:  winget install OpenJS.NodeJS.LTS
#    macOS:    brew install node@20
#    Linux:    https://github.com/nodesource/distributions

# 2. pnpm (Node 에 딸려 오는 corepack 이 가장 간단하다)
corepack enable
corepack prepare pnpm@9 --activate

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

## 이 저장소에서 절대 하지 말 것

**RenjuNet 파생 자료(`.rif`, `*.pack`, `freq_data.json`, `renju*.sqlite`)를 커밋하지 않는다.**
라이선스가 «비상업·오프라인 전용, 재배포 금지»를 명시하고, 웹에서는 커밋이 곧
«온라인 시스템에 게시»라 앱보다 더 위험하다. `.gitignore` 와 CI 게이트가 둘 다 막고 있지만,
막는 장치가 있다는 것이 해도 된다는 뜻은 아니다.

가중치(`*.bin.lz4`)는 CC0 라 재배포는 자유롭지만 40MB 라 릴리스 자산으로 나른다.

## 브라우저 요구사항

**WebAssembly SIMD 가 하한선이다.** 비SIMD 변형은 이 엔진 커밋에서 빌드되지 않는다
(`eval/mix10nnue.cpp` 의 `static_assert`). 하향할 변형이 없으므로 미달 브라우저는
안내 화면으로 끝난다.

| | 최소 |
|---|---|
| Chrome / Edge | 91 |
| Firefox | 89 |
| Safari | **16.4** (iOS 16.4 미만은 지원하지 않는다) |

COOP/COEP 헤더는 **필요 없다** — 배포 경로가 단일 스레드라서다. 그래서 GitHub Pages 를
포함해 정적 파일을 얹을 수 있는 곳이면 어디든 올라간다.

## 라이선스

배포물에 Rapfi(GPL-3.0-or-later)가 포함되므로 **전체가 GPL-3.0-or-later** 로 배포된다.
이 저장소가 직접 쓴 코드는 BSD-2-Clause 로도 쓸 수 있다.
