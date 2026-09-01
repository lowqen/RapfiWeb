# src/core/ — 프레임워크 무관 순수 로직

React 도 DOM 도 모르는 코드만 여기 온다. 앱(Kotlin)에서 옮겨 오는 6,500줄 남짓이
이 자리에 앉고, 그래야 **시험이 브라우저 없이 돈다**.

| 폴더 | 무엇 | 단계 |
|---|---|---|
| `design/` | Oklch 색 수학, 아홉 램프, 역할 표, 치수 토큰 | W1 ✅ |
| `model/` | `Move` · `PosKey`(8대칭 정규 키) · `GameFile`(.psq/.sav/.pos) · 설정 67항목 | W4·W5 |
| `rif/` | `.rif` 스트리밍 파서와 팩 생성 — **결과는 IndexedDB 에만** | W7 |
| `board/` | 보드 기하(`MARGIN 0.75`, `radius 0.45*step`, `hair step/45`)와 값 사다리 | W2 |

`design/` 만 채워져 있는 것이 지금은 정상이다.
