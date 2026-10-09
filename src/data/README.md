# src/data/ — 저장소 계층

셋을 **일부러 나눠** 쓴다. 하나로 뭉치면 각자의 실패 방식이 섞인다.

| | 무엇을 담나 | 왜 이것인가 |
|---|---|---|
| **Dexie / IndexedDB** | 앱 자신의 데이터 — 기보, 정석 노트, 리뷰 결과, 설정 | 질의가 필요하고 우리가 스키마를 쥔다 |
| **엔진 메모리 FS ↔ Dexie** | 엔진이 파일로 아는 것 — `yixindb` 의 `rapfi.db` | 엔진이 `fopen` 하는 대상이라 파일 시스템이어야 한다 |
| **Cache API** | 가중치(`*.bin.lz4`) | 불변·대용량. HTTP 캐시 의미가 그대로 맞는다 |

계획서는 yixindb 를 Emscripten IDBFS 에 둘 생각이었다. 멀티 변형은 pthread 워커가 FS 를 함께 쓰고
`syncfs` 는 비동기라 «언제 디스크에 닿았나»를 붙잡기 어려워 바꿨다: 엔진이 `FS` 를 내보내고(엔진
`-w8`), 워커가 바이트를 직접 넣고 꺼낸다. 영속은 Dexie 의 `dbfiles` 한 줄이다 — 엔진이 뜰 때
메모리 FS 에 쓰고, 저장할 때(`YXSAVEDATABASE` → 파일 읽기) 덮어쓴다(`features/database/dbStore.ts`).

지금 들어 있는 것: Dexie v1 의 `games` 표(`db.ts`)와 판 자동 저장 · 링크로 덮인 판(`games.ts`, W5a),
v2 의 리뷰 큐 · 리포트(`reviews.ts`, W6b), 고른 리포트를 보드에 건네는 `current-review.ts`, v3 의 엔진 DB
파일 `dbfiles`(W8), v4 의 정석 문서 · 국면 색인(`joseki.ts`, W9 — 문서와 색인을 한 트랜잭션으로). 오프닝 표 둘을
받아 두는 `opening-tables.ts`(W6a)도 여기다. 가중치 캐시는 `src/engine/weights-cache.ts` 에 있다. 나머지 표는 그 기능이 들어올 때 버전을 올리며 더한다.
