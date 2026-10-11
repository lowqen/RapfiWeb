import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** 툴팁 — 왜 꺼져 있는지 · 무엇이 되는지. */
  title?: string;
}

/**
 * 작은 메뉴 — 가끔 쓰는 동작 여럿(기보 열기 · .psq/.sav 저장 · 링크 복사)을 단추 하나 뒤에 둔다.
 * 늘 펼쳐 둔 네 단추가 옆 칸 맨 위 카드의 절반을 차지하던 것.
 *
 * 바깥을 누르거나 Esc 면 닫히고, Esc 는 초점을 단추로 돌려준다. 위 · 아래 화살표로 옮긴다.
 */
export function Menu({
  label,
  ariaLabel,
  items,
}: {
  label: ReactNode;
  ariaLabel?: string;
  items: readonly MenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    // 열리면 첫 항목으로 — 키보드로 연 사람이 곧바로 고를 수 있게.
    root.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      button.current?.focus();
      e.stopPropagation();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const all = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ??
        []),
    ];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = all[(at + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length];
    next?.focus();
    e.preventDefault();
  };

  return (
    <div className="menu" ref={root} onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        className="menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
      >
        {label}
        <svg className="menu__chev" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7.4 8.6 6 10l6 6 6-6-1.4-1.4-4.6 4.6z" />
        </svg>
      </button>
      {open && (
        <div id={menuId} className="menu__list quiet-switch" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="menu__item"
              disabled={it.disabled}
              title={it.title}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
