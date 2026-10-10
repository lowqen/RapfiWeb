import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * 판 위에 뜨는 확인 상자(W10 접근성) — `role="alertdialog"`.
 *
 *  - 뜨는 순간 초점을 안쪽 버튼으로 옮긴다. 되돌릴 수 없는 일을 묻는 상자는 **취소**에(`focus="cancel"`),
 *    그렇지 않으면 확인 버튼에 — Enter 한 번이 지우기가 되지 않게.
 *  - Esc 는 취소다. 닫히면 열기 전 초점(누른 버튼)으로 돌아간다.
 */
export function ConfirmBox({
  text,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  danger = false,
  focus = danger ? "cancel" : "confirm",
  className = "sequence__prompt",
  children,
}: {
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  focus?: "confirm" | "cancel";
  className?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    (focus === "cancel" ? cancelRef : confirmRef).current?.focus({ preventScroll: true });
    return () => {
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
    // 상자가 뜰 때 한 번만 — 글이 바뀌어도 초점을 다시 빼앗지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className={className}
      role="alertdialog"
      aria-labelledby={id}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onCancel();
      }}
    >
      <p id={id}>{text}</p>
      {children}
      <div className="panel__actions">
        <button
          ref={confirmRef}
          type="button"
          className={danger ? "btn--danger" : "button--primary"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button ref={cancelRef} type="button" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
