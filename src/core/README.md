# src/core/ — 프레임워크 무관 순수 로직

React 도 DOM 도 모르는 코드만 여기 온다. 앱(Kotlin)에서 옮겨 오는 6,500줄 남짓이
이 자리에 앉고, 그래야 **시험이 브라우저 없이 돈다**.

| 폴더 | 무엇 | 단계 |
|---|---|---|
| `design/` | Oklch 색 수학, 아홉 램프, 역할 표, 치수 토큰 | W1 ✅ |
| `board/` | 보드 기하 · 스킨 · 2레이어 렌더러 · 값 사다리 · 입력 | W2 ✅ |
| `model/` | `Move` · `PosKey`(8대칭 정규 키) · `GameFile`(.psq/.sav/.pos) | W4·W5a ✅ |
| `settings/` | settings.txt · settings_dev.txt 67칸 명세 · 파서 · 렌더러, 웹 값과의 다리(33칸) | W5b ✅ |
| `database/` | yixindb 전선 — 명령 · 응답 파서 · 집계기 · 국면 값 · 증명 판정 | W8 ✅ |
| `joseki/` | 정석 문서 · 트리 고치기 · 수순 글 파서 · 분류 · JSON/.psq · 국면 색인 · 마크다운(부분집합) | W9 ✅ |
| `opening/` | 26주형 · 프레임 키(4수 이름) · 흑 5수 유불리 표 · 환원 · 이론 다음 수 | W6a ✅ |
| `moveorder/` | 수순 DAG(경로 수 메모 · 규칙 넷 · 환원) · 세션 · 문구 | W6c ✅ |
| `prove/` | AND/OR 증명 트리 · 비용 · 전파 · 덧그림 · 진행/결과 문구 | W6d ✅ |
| `review/` | 수 등급 판정기(데스크톱 4단계 분류기) · 정확도 · 리포트 CSV/MD/HTML · HTML 틀 | W6b ✅ |
| `rif/` | `.rif` 바이트 스트리밍 파서 · 64비트 정규 해시(`pos-key` 와 같은 동치류) · 정렬 기반 팩 생성 · 조회 · 랭킹 — **결과는 IndexedDB 에만** | W7 ✅ |

`board/BoardCanvas.tsx` 하나만 React 를 안다. 나머지는 DOM 도 프레임워크도 모르는
순수 함수라 브라우저 없이 시험이 돈다 — 렌더러가 `CanvasRenderingContext2D` 만 받는
것이 그 경계다.
