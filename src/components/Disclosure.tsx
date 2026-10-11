import { useId, type ReactNode } from "react";
import { useRememberedOpen } from "./useRememberedOpen";

/**
 * 펼침 — 전문 설정을 접어 두고 한 줄 요약만 보이는 자리(점진적 공개, .calm-design/DESIGN.md §4).
 *
 * 처음 온 사람에게는 «분석 설정 · 무제한 · 후보 1수» 한 줄이면 충분하다. 고치고 싶은 사람만 연다.
 * 한 번 연 것은 열린 채로 기억한다(`rapfi.open.<id>`) — 늘 고치는 사람이 매번 다시 열지 않게.
 *
 * 닫힌 내용은 DOM 에 남고 `hidden` 만 붙는다. 그 안의 값(스위치의 켜짐 등)은 그대로 살아 있고,
 * 열 때 다시 그리지 않는다. 머리는 단추 하나(`aria-expanded` · `aria-controls`)다.
 */
export function Disclosure({
  id,
  title,
  summary,
  level = 2,
  defaultOpen = false,
  children,
}: {
  /** 기억 열쇠 — 화면 안에서 겹치지 않게. */
  id: string;
  title: ReactNode;
  /** 닫혀 있을 때 무엇이 골라져 있는지 한 줄. 열려 있어도 보인다. */
  summary?: ReactNode;
  level?: 2 | 3;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useRememberedOpen(id, defaultOpen);
  const bodyId = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="disclosure" data-open={open || undefined} data-k={`disclosure-${id}`}>
      <Heading className="disclosure__heading">
        <button
          type="button"
          className="disclosure__head"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <span className="disclosure__title">{title}</span>
          {summary ? <span className="disclosure__summary tnum">{summary}</span> : null}
          <svg className="disclosure__chev" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9.3 5.3 8 6.6l5.4 5.4L8 17.4l1.3 1.3 6.7-6.7z" />
          </svg>
        </button>
      </Heading>
      <div id={bodyId} className="disclosure__body quiet-switch" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
