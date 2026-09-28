import { useId, useState, type ReactNode } from "react";
import { Icon, ICON } from "./icons";

/**
 * 접히는 카드 — 앱의 「데이터베이스 ⌄」「대국 ⌄」 줄과 같은 모양.
 *
 * 머리 줄에 **요약**을 같이 적는다. 접힌 채로도 무엇이 들어 있는지 읽혀야
 * 펼쳐 볼지 말지를 정할 수 있다.
 *
 * 접힌 내용은 `hidden` 으로 숨기고 DOM 에서 빼지 않는다 — 콘솔은 접혀 있어도
 * 줄을 계속 받아야 하고, 스모크가 그 원문을 읽는다.
 */
export function Section({
  title,
  summary,
  defaultOpen = false,
  actions,
  children,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** 머리 줄 오른쪽의 작은 버튼(예: 콘솔 「지우기」). 펼침 버튼과 따로 산다. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="panel section" data-open={open || undefined}>
      <div className="section__head">
        <button
          type="button"
          className="section__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="section__title">{title}</span>
          {summary !== undefined && <span className="section__summary">{summary}</span>}
          <Icon d={ICON.expand} className="icon section__chevron" />
        </button>
        {actions}
      </div>
      <div id={bodyId} className="section__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
