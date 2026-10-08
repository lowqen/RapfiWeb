# src/data/ — 저장소 계층

셋을 **일부러 나눠** 쓴다. 하나로 뭉치면 각자의 실패 방식이 섞인다.

| | 무엇을 담나 | 왜 이것인가 |
|---|---|---|
| **Dexie / IndexedDB** | 앱 자신의 데이터 — 기보, 정석 노트, 리뷰 결과, 설정 | 질의가 필요하고 우리가 스키마를 쥔다 |
| **Emscripten IDBFS** | 엔진이 파일로 아는 것 — `yixindb` | 엔진이 `fopen` 하는 대상이라 파일 시스템이어야 한다 |
| **Cache API** | 가중치(`*.bin.lz4`) | 불변·대용량. HTTP 캐시 의미가 그대로 맞는다 |

`syncfs` 호출 시점은 **세 곳으로 고정**한다(분석 조각 경계 / 명시적 저장 / 세션 종료).
`beforeunload` 에서 기다릴 수 없다 — 브라우저가 언로드 중 비동기 완료를 보장하지 않는다.

지금 들어 있는 것: Dexie v1 의 `games` 표(`db.ts`)와 판 자동 저장 · 링크로 덮인 판(`games.ts`, W5a),
v2 의 리뷰 큐 · 리포트(`reviews.ts`, W6b), 고른 리포트를 보드에 건네는 `current-review.ts`. 오프닝 표 둘을
받아 두는 `opening-tables.ts`(W6a)도 여기다. 가중치 캐시는 `src/engine/weights-cache.ts` 에 있다. 나머지 표는 그 기능이 들어올 때 버전을 올리며 더한다.
