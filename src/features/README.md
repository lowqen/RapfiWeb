# src/features/ — 화면별 기능

한 폴더가 한 화면(또는 한 탭)이다. 화면끼리 서로를 import 하지 않는다 —
공유할 것이 생기면 `core/` 나 `components/` 로 내린다.

**예외 하나: 판.** `board/` 의 `boardStore` · `gameStore` 는 앱 전체가 함께 쓰는 «지금 판»이다
(앱도 연구 탭이 보드의 국면을 그대로 읽는다). 연구 화면은 이 둘을 직접 읽고 쓴다 — 그 밖의
`board/` 내부(패널 · 동작)는 가져다 쓰지 않는다. 거꾸로 보드가 연구의 결과를 보여야 할 때(리뷰
배지)는 `data/current-review.ts` 처럼 사이의 작은 칸을 지난다. 여러 화면이 쓰는 입력 부품 · 아이콘은
`components/` 에 있다.

**예외 둘: DB 와 설정 파일.** `database/` 의 DB 는 화면이기 전에 엔진에 붙은 자원이라 증명(`research/prove`)이
그 손잡이(`proveDb()`)를 쓴다. `settings/desktopBridge.ts` 는 settings.txt 67칸이 여러 화면(리뷰 · 증명 · DB)에
걸쳐 있어 그 스토어들을 읽고 쓴다 — 칸의 뜻은 `core/settings/` 에 있고 여기는 옮겨 담기만 한다.

```
board/      대국·분석 화면 (W4) · 기보 열기/저장 · 판 자동 저장 (W5a)
research/   리뷰·증명(review/ W6b · prove/ W6d) / 오프닝 (W6a · 빈도 W7) / 수순(sequence/ W6c) / 랭킹(ranking/ W7)
            — 탭 넷은 ResearchTabs 가 묶는다. rif/ 는 .rif 변환 워커 · 팩 스토어 · 셸의 드롭 층(W7)
database/   yixindb 국면 저장소 (W8)
engine/     엔진 상태·도구·piskvork 콘솔 (W3)
settings/   설정 화면 (W4) · settings.txt 67항목 왕복 (W5b)
joseki/     오프닝 정석 노트 — 신규 기능 (W9)
```

**각 화면의 상태 슬라이스는 라우팅으로 초기화되지 않는다.** 앱과 같은 규칙이다:
탭을 옮겼다가 돌아오면 보던 자리가 그대로여야 한다. 진행 중인 리뷰·증명은 애초에
워커에 있으므로 이 규칙과 무관하다.
