# RenjuNet 파생 통계 게시 허락 문의 — 메일 초안 (미발송)

> **상태: 초안. 보내지 않았다.** 사용자가 검토 · 수정한 뒤 직접 보낸다.
> 받는 곳: `web@renju.net` (`.rif` 머리말 «COPYRIGHT INFORMATION» 의 연락처)
> 관련: 계획서 부록 A «W7 결정» — 지금은 사용자가 받은 파일을 **그 브라우저 안에서만** 변환한다(허락이 필요 없는 길).
> 허락을 받으면 바뀌는 것: 같은 변환을 CI 에서 돌려 통계를 정적 자산으로 싣는다 — 브라우저 코드는 그대로다.

## 무엇을 묻는가 — 단계별로

허락받기 쉬운 것부터 나눠 묻는다. 한꺼번에 «데이터베이스를 웹에 올려도 되나»로 물으면 답은 거의 확실히
«아니오»이고, 그 답은 아래의 좁은 요청까지 닫는다.

| 단계 | 싣는 것 | 사용자에게 열리는 것 | 비고 |
|---|---|---|---|
| **A** | 국면 집계만 — 접두 ≤ 20수 · 2판 이상 국면의 판 수 · 흑승/무/백승, 다음 수별 같은 수. 선수 이름 · 대회 · 개별 기보 **없음**. 64비트 해시 키라 기보를 되살릴 수 없다 | 클릭 없이 오프닝 탐색 빈도 · 26주형 / 5수 모양 랭킹(거르기 없이) | 가장 좁다. 핵심 요청 |
| **B** | A + 26주형 · 5수 모양 × 규칙 × 연도 집계 | 규칙 · 연도 거르기 | 여전히 사람 · 기보 없음 |
| **C** | 선수 이름이 붙은 대국 단위 자료 | 선수 거르기 · 대국 목록 | 사실상 데이터베이스 재배포 — 묻되 기대하지 않는다. 계속 «파일을 넣으면» 으로 둔다 |

## 영문 초안

**Subject:** Permission request: publishing aggregate opening statistics derived from the RenjuNet games database (non-commercial, open source)

Dear RenjuNet team,

My name is [이름], and I develop **RapfiWeb** (https://github.com/lowqen/RapfiWeb), a free, open-source
(GPL-3.0) renju analysis board that runs entirely in the web browser. It has no ads, no accounts, no
paid features and no server-side processing; the Rapfi engine runs locally in the user's browser.

First, thank you for maintaining the RenjuNet games database. We read its copyright notice carefully:
*"It is allowed to use this database for non-commercial purposes in the forms of OFFLINE databases only.
It is forbidden to use any contents of this database or its modifications in any website or ONLINE system."*

To respect this, RapfiWeb currently **does not include or host any RenjuNet data**. Instead, each user
downloads the database themselves from renju.net and drops the file into the app; it is converted inside
their own browser and stored only on their own device. Nothing is uploaded anywhere. The app links users
to your downloads page for this.

Many of our users, especially on mobile phones, find this step difficult, so we would like to ask whether
you would allow a narrower form of use. Specifically, we would like to publish, as a static file shipped
with the app:

1. **Aggregate position statistics only** — for opening positions up to 20 moves that occur in at least two
   games: the number of games, and the black-win / draw / white-win counts, plus the same counts for each
   next move. No player names, tournaments, dates or individual game records would be included, and the
   positions are stored as one-way 64-bit hashes, so the original games cannot be reconstructed from the
   file. (About 116,000 positions; a few megabytes.)

2. *(Optionally, if you are comfortable with it)* the same counts aggregated by **rule set and year** for the
   26 standard openings and the most common 5-move shapes.

We would of course:

- credit RenjuNet clearly on every screen that shows these statistics, with a link to renju.net;
- keep the project non-commercial;
- state the database version/date the statistics were derived from, and update them only from your
  official releases;
- remove the statistics promptly at any time if you ask us to.

We would not publish player names, individual games, or anything that could replace the database itself;
for those, users would continue to download the database from renju.net.

If this is acceptable — or acceptable with conditions you would like us to follow — please let us know.
If you prefer that we keep the current "download it yourself" approach only, we will of course respect that.

Thank you very much for your time and for everything RenjuNet does for the renju community.

Best regards,
[이름]
RapfiWeb — https://github.com/lowqen/RapfiWeb
[연락 이메일]

## 보내기 전에 확인할 것

- [ ] 이름 · 연락처 채우기. 배포 주소(Cloudflare Pages)가 정해져 있으면 저장소 주소 옆에 넣는다.
- [ ] 크기: A 단계는 국면 116,191개(키 · 판 수 2.8MB) + 다음 수 238,267개(4MB) ≈ 7MB, 압축하면 몇 MB 다 — 실제로 만들게 되면 다시 잰다.
- [ ] 답이 오면 이 문서에 날짜와 요지를 적고, 허락 범위를 계획서 결정 ①과 CI 오염 게이트(`web.yml`)에
      반영한다. **허락 전에는 어떤 RenjuNet 파생물도 배포물에 넣지 않는다**(게이트가 막는다).
