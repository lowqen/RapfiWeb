import { useRef, useState } from "react";
import { Segmented } from "../../../components/controls";
import { Disclosure } from "../../../components/Disclosure";
import { useRifStore } from "./rifStore";
import { RENJUNET_DOWNLOADS, fmtInt, pct } from "./format";
import { t } from "../../../i18n/i18n";
import { rich } from "../../../i18n/rich";

/**
 * W7 의 작은 부품들 — 승·무·패 막대, `.rif` 가져오기 안내, 자료 출처 줄. 랭킹 · 오프닝 화면이
 * 함께 쓴다.
 */

/**
 * 흑승 · 무 · 백승 막대 — 결과 배지와 같은 세 색(흑 = 파랑 · 백 = 초록 · 무 = 중립). 글자는 막대
 * 옆에 흑 점수(무 = 반 점)로 하나만 — 세 숫자를 다 쓰면 목록이 읽히지 않는다. 자세한 것은 툴팁.
 */
export function WdlBar({
  b,
  d,
  w,
  compact,
}: {
  b: number;
  d: number;
  w: number;
  compact?: boolean;
}) {
  const n = b + d + w;
  const title = n
    ? t("흑 승 {b} ({bp}%) · 무 {d} ({dp}%) · 백 승 {w} ({wp}%)", {
        b: fmtInt(b),
        bp: pct(b, n),
        d: fmtInt(d),
        dp: pct(d, n),
        w: fmtInt(w),
        wp: pct(w, n),
      })
    : t("결과가 난 판이 없습니다");
  const score = n ? Math.round(((b + d / 2) / n) * 100) : null;
  return (
    <span className={"wdl" + (compact ? " wdl--compact" : "")} title={title} aria-label={title}>
      <span className="wdl__bar" aria-hidden="true">
        {n > 0 ? (
          <>
            <span className="wdl__b" style={{ width: `${(b / n) * 100}%` }} />
            <span className="wdl__d" style={{ width: `${(d / n) * 100}%` }} />
            <span className="wdl__w" style={{ width: `${(w / n) * 100}%` }} />
          </>
        ) : (
          <span className="wdl__none" />
        )}
      </span>
      <span className="wdl__score tnum">
        {score === null ? t("없음") : t("흑 {b}%", { b: score })}
      </span>
    </span>
  );
}

/** 파일 고르기 버튼 — 숨은 `<input type=file>` 을 대신 누른다. */
export function PickRifButton({ label, tonal }: { label?: string; tonal?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const importFile = useRifStore((s) => s.importFile);
  const busy = useRifStore((s) => s.job !== null);
  return (
    <>
      <button
        type="button"
        className={"btn" + (tonal ? " btn--tonal" : "")}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {label ?? t("파일 고르기")}
      </button>
      <input
        ref={input}
        type="file"
        accept=".rif,.xml,application/xml,text/xml"
        hidden
        data-k="rif-input"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) void importFile(f);
        }}
      />
    </>
  );
}

/**
 * `.rif` 가져오기 안내 — RenjuNet 팩이 없을 때. 세 걸음(받기 → 놓기 → 몇 초)을 그대로 보여 주고,
 * 이 파일과 통계가 기기 밖으로 나가지 않는다는 것을 말한다(왜 앱이 대신 받아 주지 않는지도).
 */
export function RifImportCard({ compact }: { compact?: boolean }) {
  // 받는 방법 세 걸음 — 처음 화면(랭킹)에서는 펼쳐 두고, 오프닝 화면의 작은 카드에서는 접는다.
  const steps = (
    <ol className="rifsteps">
      <li>
        <span className="rifsteps__n" aria-hidden="true">
          1
        </span>
        <span>
          {rich(
            t(
              "{link}에서 {xml} 버튼을 눌러 기보 파일(약 43MB)을 받습니다. 옆의 [XML.GZ] 는 압축본이라 읽지 못합니다.",
            ),
            {
              link: (
                <a href={RENJUNET_DOWNLOADS} target="_blank" rel="noreferrer noopener">
                  {t("renju.net 기보 화면")}
                </a>
              ),
              xml: <b>[XML]</b>,
            },
          )}
        </span>
      </li>
      <li>
        <span className="rifsteps__n" aria-hidden="true">
          2
        </span>
        <span>
          {rich(t("받은 파일을 {drop} 아래에서 고릅니다."), {
            drop: <b>{t("이 앱의 아무 화면에나 끌어다 놓거나")}</b>,
          })}
        </span>
      </li>
      <li>
        <span className="rifsteps__n" aria-hidden="true">
          3
        </span>
        <span>{t("몇 초 뒤 랭킹과 오프닝 통계가 열립니다. 다음부터는 바로 뜹니다.")}</span>
      </li>
    </ol>
  );
  return (
    <section
      className={"panel rifcard" + (compact ? " rifcard--compact" : "")}
      aria-labelledby="rifcard-title"
    >
      <h2 id="rifcard-title" className="panel__title">
        {t("RenjuNet 기보로 통계 만들기")}
      </h2>
      <p className="rifcard__lead">
        {t(
          "세계 렌주 대국 약 12만 판으로 오프닝 통계와 랭킹을 봅니다. 파일은 한 번만 넣으면 됩니다.",
        )}
      </p>
      {!compact && steps}
      <div className="panel__actions">
        <PickRifButton tonal />
        <a className="btn" href={RENJUNET_DOWNLOADS} target="_blank" rel="noreferrer noopener">
          {t("renju.net 열기")}
        </a>
      </div>
      {compact && (
        <div className="panel__fold">
          <Disclosure id="rif-howto" level={3} title={t("받는 방법")}>
            {steps}
          </Disclosure>
        </div>
      )}
      <p className="panel__hint rifcard__legal">
        {rich(t("파일과 통계는 {here} 남습니다."), {
          here: <b>{t("이 브라우저 안에만")}</b>,
        })}
      </p>
    </section>
  );
}

/**
 * 지금 보고 있는 자료 — RenjuNet(날짜 · 판 수) 또는 내 기보. 둘 다 있으면 고른다. 다시 만들기 ·
 * 지우기는 여기서.
 */
export function PackSourceBar() {
  const pack = useRifStore((s) => s.pack);
  const local = useRifStore((s) => s.local);
  const source = useRifStore((s) => s.source);
  const setSource = useRifStore((s) => s.setSource);
  const remove = useRifStore((s) => s.remove);
  const [asking, setAsking] = useState(false);
  const showing =
    source === "renjunet" && pack ? "renjunet" : local ? "local" : pack ? "renjunet" : null;
  if (!showing) return null;
  return (
    <div className="packbar" data-k="pack-source">
      {pack && local ? (
        <Segmented
          label={t("자료")}
          value={showing}
          options={[
            { value: "renjunet", label: "RenjuNet" },
            { value: "local", label: t("내 기보") },
          ]}
          onChange={setSource}
        />
      ) : (
        <span className="pill">{showing === "renjunet" ? "RenjuNet" : t("내 기보")}</span>
      )}
      <span className="packbar__meta tnum">
        {showing === "renjunet" && pack
          ? t("{n}판 · {date} 판", {
              n: fmtInt(pack.games.id.length),
              date: pack.date || t("날짜 모름"),
            })
          : local
            ? t("{n}판: 저장한 기보와 지금 판", { n: fmtInt(local.games.id.length) })
            : ""}
      </span>
      <span className="packbar__actions">
        {pack && asking ? (
          <span className="packbar__confirm" role="alert">
            {t("RenjuNet 통계를 지울까요? 다시 보려면 파일을 다시 넣어야 합니다.")}
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                setAsking(false);
                void remove();
              }}
            >
              {t("지우기")}
            </button>
            <button type="button" className="btn" autoFocus onClick={() => setAsking(false)}>
              {t("그대로 두기")}
            </button>
          </span>
        ) : pack ? (
          <>
            <PickRifButton label={t("새 파일로 다시")} />
            <button type="button" className="btn" onClick={() => setAsking(true)}>
              {t("지우기")}
            </button>
          </>
        ) : (
          <PickRifButton label={t("RenjuNet 파일 넣기")} tonal />
        )}
      </span>
    </div>
  );
}
