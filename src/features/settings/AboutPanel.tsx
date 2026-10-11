import type { ReactNode } from "react";
import engineManifest from "../../engine/engine-manifest.json";
import { msg, t } from "../../i18n/i18n";

/**
 * 설정 ▸ 정보 — GPLv3 §0 · §5(d) 의 «적절한 법적 고지»(Appropriate Legal Notices).
 *
 * 대화형 화면이 있는 GPL 프로그램은 화면에서 저작권 고지 · 무보증 · 라이선스 조건과 그 전문을 볼
 * 방법을 알려야 한다. 배포물에 Rapfi(GPL-3.0-or-later)가 들어 있으므로 앱 전체가 그 대상이다.
 * 함께 싣거나 이식한 구성요소와 엔진의 대응 소스(업스트림 커밋 + `tools/patches/`)도 여기서
 * 가리킨다. 자세한 표와 BSD 고지 전문은 저장소의 `THIRD_PARTY_NOTICES.md` 가 정본이다.
 *
 * 구성요소 이름 · 라이선스 식별자는 번역하지 않는다(고유 명사 · SPDX).
 *
 * 설정 묶음(`.sgroup`)이 아니다 — 머리 모양만 빌려 쓰고 카드 클래스는 따로 둔다(스모크가
 * `.sgroup` 수로 설정 카드를 센다).
 */

const REPO = "https://github.com/lowqen/RapfiWeb";
const UPSTREAM = engineManifest.upstream;

interface Component {
  name: string;
  href: string;
  /** 사전 열쇠 — 그릴 때 `t()`. */
  role: string;
  license: string;
}

const COMPONENTS: readonly Component[] = [
  {
    name: "Rapfi",
    href: "https://github.com/dhbloo/rapfi",
    role: msg("탐색 엔진(WebAssembly 빌드)"),
    license: "GPL-3.0-or-later",
  },
  {
    name: "rapfi-networks",
    href: "https://github.com/dhbloo/rapfi-networks",
    role: msg("엔진 가중치"),
    license: "CC0-1.0",
  },
  {
    name: "Yixin-Board © 2009-2017 Kai Sun",
    href: "https://github.com/accreator/Yixin-Board",
    role: msg("이식한 데스크톱 로직(프로토콜 · 국면 키 · 설정 · 리뷰)"),
    license: "BSD-2-Clause",
  },
  {
    name: "RapfiDroid",
    href: "https://github.com/lowqen/RapfiDroid",
    role: msg("이식 원본 안드로이드 앱"),
    license: "BSD-2-Clause",
  },
  {
    name: "React · React Router · Zustand",
    href: "https://react.dev/",
    role: msg("화면 라이브러리"),
    license: "MIT",
  },
  {
    name: "Dexie.js",
    href: "https://dexie.org/",
    role: msg("저장 라이브러리(IndexedDB)"),
    license: "Apache-2.0",
  },
  {
    name: "Pretendard © 2021 Kil Hyung-jin",
    href: "https://github.com/orioncactus/pretendard",
    role: msg("본문 글꼴"),
    license: "OFL-1.1",
  },
];

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="linkish" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

export function AboutPanel() {
  return (
    <section className="panel about" aria-labelledby="sg-about">
      <header className="sgroup__head">
        <h2 id="sg-about" className="sgroup__title">
          {t("정보")}
        </h2>
        <p className="sgroup__desc">RapfiWeb · © 2026 lowqen</p>
      </header>

      <div className="about__body">
        <p>
          {t(
            "RapfiWeb 은 자유 소프트웨어입니다. GNU 일반 공중 사용 허가서(GPL) 3판 또는 그 이후 판의 조건에 따라 다시 배포하거나 고칠 수 있습니다.",
          )}
        </p>
        <p className="about__warranty">
          {t(
            "이 프로그램은 쓸모 있기를 바라며 배포되지만, 상품성이나 특정 목적 적합성에 대한 묵시적 보증을 포함해 어떠한 보증도 하지 않습니다.",
          )}
        </p>
        <p className="about__links">
          <Ext href={REPO}>{t("소스 코드")}</Ext>
          <Ext href={`${REPO}/blob/main/LICENSE`}>{t("라이선스 전문")}</Ext>
          <Ext href={`${REPO}/blob/main/THIRD_PARTY_NOTICES.md`}>{t("서드파티 고지")}</Ext>
        </p>
      </div>

      <h3 className="about__subtitle">{t("구성 요소")}</h3>
      <ul className="about__list">
        {COMPONENTS.map((c) => (
          <li key={c.name} className="about__item">
            <span className="about__name">
              <Ext href={c.href}>{c.name}</Ext>
            </span>
            <span className="about__role">{t(c.role)}</span>
            <code className="srow__key about__license">{c.license}</code>
          </li>
        ))}
      </ul>

      <p className="about__source">
        {t("엔진 소스")}:{" "}
        <Ext href={`https://github.com/dhbloo/rapfi/tree/${UPSTREAM}`}>
          dhbloo/rapfi@{UPSTREAM.slice(0, 8)}
        </Ext>{" "}
        + <Ext href={`${REPO}/tree/main/tools/patches`}>tools/patches</Ext>{" "}
        <span className="about__tag tnum">({engineManifest.tag})</span>
      </p>
    </section>
  );
}
