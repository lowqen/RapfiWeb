# src/features/ — 화면별 기능

한 폴더가 한 화면(또는 한 탭)이다. 화면끼리 서로를 import 하지 않는다 —
공유할 것이 생기면 `core/` 나 `components/` 로 내린다.

```
board/      대국·분석 화면 (W4)
research/   리뷰·증명 / 오프닝 / 수순 / 랭킹 (W6) — 탭 넷은 ResearchTabs 가 묶는다
database/   yixindb 국면 저장소 (W6)
engine/     엔진 상태·도구·piskvork 콘솔 (W3)
settings/   settings.txt 67항목 왕복 (W5)
joseki/     오프닝 정석 노트 — 신규 기능 (W8)
```

**각 화면의 상태 슬라이스는 라우팅으로 초기화되지 않는다.** 앱과 같은 규칙이다:
탭을 옮겼다가 돌아오면 보던 자리가 그대로여야 한다. 진행 중인 리뷰·증명은 애초에
워커에 있으므로 이 규칙과 무관하다.
