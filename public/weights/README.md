# public/weights/

규칙별 가중치(`*.bin.lz4`)가 들어올 자리. **비어 있는 것이 정상이다.**

| 파일 | 크기 | 언제 필요한가 |
|---|---|---|
| `mix9svqfreestyle_bsmix.bin.lz4` | 10.0 MB | 프리스타일 — `.data` 에 구워 함께 받는다 |
| `mix9svqstandard_bs15.bin.lz4` | 10.3 MB | 스탠다드 — 필요할 때 받는다 |
| `mix9svqrenju_bs15_black.bin.lz4` | 10.0 MB | 렌주(흑) — 필요할 때 |
| `mix9svqrenju_bs15_white.bin.lz4` | 9.8 MB | 렌주(백) — 필요할 때 |

라이선스는 CC0(`dhbloo/rapfi-networks`)라 재배포가 자유롭다.
**RenjuNet 자료와 혼동하지 말 것** — 그쪽은 어떤 이유로도 배포물에 넣지 않는다.

`.gitignore` 가 `*.bin.lz4` 를 막고 있다. 릴리스 자산으로 받아 배포에 조립한다(계획서 §8).
