# Cloudflare Pages 로 이 사이트 띄우기

> 처음 한 번만 하면 됩니다. 그 다음부터는 `main` 에 푸시할 때마다 자동으로 나갑니다.
> 무료 플랜으로 충분합니다 (월 500회 빌드, 대역폭 무제한, 파일당 25MB).

## 왜 Cloudflare 인가

W0 에서 **COOP/COEP 헤더가 필요 없어졌습니다** — 배포 경로가 단일 스레드 변형이라
`SharedArrayBuffer` 를 쓰지 않기 때문입니다. 그래서 호스팅을 자유롭게 고를 수 있고,
그중 Cloudflare Pages 를 고른 이유는:

- **비공개 저장소여도 무료입니다.** GitHub Pages 는 private 저장소에 유료 플랜이 필요합니다.
- **도메인 루트에서 서빙합니다.** `base` 가 `/` 라 경로 설정이 없습니다.
- **`_headers` 와 `_redirects` 를 그대로 읽습니다.** `public/` 에 이미 넣어 두었으므로
  SPA 딥링크(`/research/review` 새로고침)와 엔진 파일 캐시 정책이 별도 설정 없이 붙습니다.
- 20MB 짜리 `.data` 를 CDN 이 받아 줍니다. 파일당 25MB 상한이 있는데, 렌주 전용으로
  줄여서 통과합니다(아래 「알아 둘 것」).

---

## 1. Cloudflare 쪽 준비 (5분)

### 1-1. 계정

<https://dash.cloudflare.com> 에 가입/로그인합니다. 카드 등록은 필요 없습니다.

**Pages 프로젝트는 손으로 만들지 않아도 됩니다** — 배포 워크플로가 없으면 만듭니다
(`wrangler pages project create`, 아래 토큰 권한으로 됩니다). 이름은
`.github/workflows/deploy.yml` 의 `PROJECT`(기본 `rapfiweb`)를 씁니다.

> 처음에는 대시보드에서 먼저 만들라고 안내했는데, 그러면 「비밀값은 넣었는데
> 프로젝트가 없어서」 배포가 실패합니다 — 실제로 한 번 걸렸습니다
> (`Project not found`, code 8000007). 그 단계를 없앴습니다.

만들어지면 주소가 생깁니다: `https://rapfiweb.pages.dev`

### 1-2. Account ID

**Workers & Pages** 개요 화면 오른쪽 사이드바에 **Account ID** 가 있습니다.
32자리 16진수입니다. 복사해 두세요.

### 1-3. API 토큰

1. 오른쪽 위 프로필 ▸ **My Profile** ▸ **API Tokens** ▸ **Create Token**
2. 맨 아래 **Create Custom Token** ▸ **Get started**
3. 권한을 **하나만** 줍니다:

   | 종류 | 대상 | 권한 |
   |---|---|---|
   | Account | Cloudflare Pages | **Edit** |

   > 「Edit Cloudflare Workers」 템플릿을 쓰지 마세요 — 필요 없는 권한이 잔뜩 붙습니다.
   > 배포에 필요한 것은 위 한 줄뿐입니다.

4. **Account Resources** 에서 본인 계정만 고릅니다.
5. 만들고 나온 토큰 문자열을 복사합니다. **이 화면을 벗어나면 다시 볼 수 없습니다.**

---

## 2. GitHub 쪽 준비 (1분)

저장소 **Settings ▸ Secrets and variables ▸ Actions ▸ New repository secret** 에서
둘을 넣습니다:

| 이름 | 값 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 1-3 에서 만든 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | 1-2 의 Account ID |

이름을 정확히 이렇게 써야 합니다 — 워크플로가 이 이름을 봅니다.
빠지면 배포 잡이 **어느 것이 없는지 말하고** 멈춥니다(조용히 실패하지 않습니다).

---

## 3. 배포하기

### 자동

`main` 에 푸시하면 나갑니다. 단, 문서·스파이크·엔진 빌드만 바뀐 푸시는 건너뜁니다
(`paths-ignore`).

### 수동

저장소 **Actions ▸ deploy ▸ Run workflow**.
`target` 을 `artifact-only` 로 두면 **배포하지 않고** 빌드 결과만 아티팩트로 남깁니다 —
Cloudflare 를 건드리기 전에 결과물을 확인하고 싶을 때 쓰세요.

### 확인

배포가 끝나면 로그 마지막에 주소가 찍힙니다:

```
✨ Deployment complete! Take a peek over at https://<해시>.rapfiweb.pages.dev
```

- `https://rapfiweb.pages.dev` — 프로덕션(= `main`)
- `https://<브랜치>.rapfiweb.pages.dev` — 브랜치별 미리보기

---

## 4. 엔진 채우기

엔진 산출물은 저장소에 없습니다(`.data` 가 20MB 입니다). **한 번** 이렇게 채웁니다:

1. **Actions ▸ 엔진 릴리스 (WASM 산출물) ▸ Run workflow**
   빌드에 10~40분 걸립니다(캐시가 차 있으면 짧습니다). 끝나면
   `engine-3c94c2a9` 릴리스에 `.js`/`.wasm`/`.data` 가 올라갑니다.
2. 그 다음부터 `deploy` 와 `web` 워크플로가 그 릴리스에서 자동으로 받아 조립합니다.

릴리스가 없으면 배포는 **엔진 없이** 진행되고 경고만 남깁니다 — 보드는 그려지고
분석만 안 됩니다.

---

## 5. 알아 둘 것

### 파일 크기 상한 25MB — **해결됨**

Cloudflare Pages 는 **파일 하나가 25MB 를 넘으면 거부합니다.** 가중치 4종을 전부
구운 `.data` 는 40.3MB 라 그대로는 올라가지 않았습니다.

**이 앱은 렌주 전용으로 정리해서 통과합니다:**

```
Networks/wasm_preloads.txt 를 렌주 가중치만 남기도록 굽는다
  mix9svqrenju_bs15_black.bin.lz4    9,984,172
  mix9svqrenju_bs15_white.bin.lz4    9,844,944
  classical/model210901.bin             30,109   <- config 가 이름으로 가리킨다. 빼면 안 됨
  config.toml (렌주 전용 사본)            6,713
                                    ─────────────
                                      ~19.9MB     <- 25MB 통과
```

프리스타일·스탠다드 가중치는 아예 싣지 않습니다. 그 규칙을 고르면 화면이
「웹 버전은 렌주만 지원합니다」로 안내합니다(`src/core/model/rules.ts`).
규칙별 lazy load 는 구현하지 않았습니다 — 이 프로젝트는 렌주 도구라 그 복잡도를
사지 않기로 했습니다.

빌드 쪽 처리는 `tools/build_engine_wasm.sh` 의 `[2.5/6]` 단계에 있고, 앱은 기동 시
`INFO RULE 4`(렌주)를 `START` 보다 먼저 보냅니다 — 안 그러면 기본 규칙인
프리스타일로 시작해 싣지 않은 가중치를 찾습니다.

### 파일 개수 상한 20,000

지금 수십 개라 여유가 큽니다.

### 캐시

`public/_headers` 가 `/engine/*` 와 `/weights/*` 를 1년 불변으로 잡아 둡니다.
엔진을 갱신하면 파일 이름에 버전을 넣거나 Cloudflare 대시보드에서 캐시를 비우세요.

### 되돌리기

Cloudflare Pages 는 배포마다 고유 주소를 남깁니다. 대시보드의 배포 목록에서
이전 배포를 골라 **Rollback** 하면 즉시 되돌아갑니다.

### 다른 데로 옮기고 싶어지면

`deploy.yml` 의 마지막 단계 하나만 바꾸면 됩니다 — 그 앞은 전부 「`dist/` 를
만들고 검사하는」 호스팅 중립 단계입니다. 멀티스레드 변형을 되살리는 날에는
COOP/COEP 헤더가 필요해지는데, Cloudflare 는 `_headers` 로 그것도 됩니다.
