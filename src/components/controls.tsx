import { useEffect, useId, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { ICON } from "./icon-paths";
import { durationText, parseDuration, type DurationSpec } from "../core/settings/duration";
import { t } from "../i18n/i18n";

/**
 * 입력 부품 — 앱의 `FilterChip`·`Switch`·스테퍼를 옮긴 것. 설정 · 보드 옆 칸 · 연구가 함께 쓴다.
 *
 * 네이티브 `<input>`·`<select>` 를 그대로 두지 않는다. 브라우저 기본 모양은
 * 다크 테마에서 흰 상자로 튀고, 플랫폼마다 크기가 달라 줄이 흔들린다.
 */

/**
 * 칩 한 줄. `fieldset`/`legend` 를 쓰지 않는 이유가 있다 — flex 컨테이너 안의
 * legend 는 브라우저마다 배치가 달라 첫 줄이 어긋난다. 묶음의 뜻은 `role`+라벨로.
 *
 * 대국 스모크가 `[role=group][aria-label=오프닝] .chip` 과 `aria-pressed` 로 집는다.
 */
export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function Chip({
  on,
  title,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={"chip" + (on ? " is-on" : "")}
      aria-pressed={on}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * 하나만 고르는 칸 묶음 — 스타일(0~5)·해시 크기처럼 값이 줄지어 있는 것.
 * 칩과 달리 칸이 붙어 있어 «눈금»으로 읽힌다.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  /** `lang` — 지금 화면 언어와 다른 말로 적은 항목(언어 고르기의 «English» · «한국어»). */
  options: readonly {
    value: T;
    label: string;
    title?: string;
    disabled?: boolean;
    lang?: string;
  }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          className="seg__opt"
          aria-checked={o.value === value}
          title={o.title}
          lang={o.lang}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 켜고 끄기. `role="switch"` — 스크린 리더가 «켬/끔»으로 읽는다. */
export function Switch({
  label,
  on,
  onChange,
  disabled,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="switch__thumb" />
    </button>
  );
}

/** − 값 + . 앱의 「후보 수 (멀티 PV)」 줄과 같은 모양. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="stepper stepper--inline" role="group" aria-label={label}>
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={t("{name} 줄이기", { name: label })}
      >
        <Icon d={ICON.minus} />
      </button>
      <output className="stepper__value tnum" aria-live="polite">
        {format ? format(value) : value}
      </output>
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={t("{name} 늘리기", { name: label })}
      >
        <Icon d={ICON.plus} />
      </button>
    </div>
  );
}

/**
 * 숫자 입력. **치는 도중에는 반영하지 않는다** — 「30」을 치려다 「3」에서 한 번
 * 반영되면 시계·엔진이 3초짜리로 한 번 튄다. 칸을 떠나거나 Enter 를 칠 때 한 번,
 * 범위로 잘라서 넘긴다(앱의 `CommitField` 와 같다).
 */
export function NumberField({
  label,
  value,
  min,
  max,
  unit,
  onCommit,
  disabled,
  hideLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onCommit: (v: number) => void;
  disabled?: boolean;
  /** 설정 줄 이름이 이미 같은 말을 할 때 — 화면에서만 숨긴다. */
  hideLabel?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n) || text.trim() === "") {
      setText(String(value));
      return;
    }
    const v = Math.min(max, Math.max(min, Math.round(n)));
    setText(String(v));
    if (v !== value) onCommit(v);
  };

  return (
    <label className="field" htmlFor={id} data-disabled={disabled || undefined}>
      <span className={"field__label" + (hideLabel ? " field__label--hidden" : "")}>{label}</span>
      <span className="field__box">
        <input
          id={id}
          className="field__input tnum"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(String(value));
          }}
        />
        {unit && <span className="field__unit">{unit}</span>}
      </span>
    </label>
  );
}

/**
 * 시간 직접 입력 — 칩 · 눈금 옆에 붙는 「직접」 칸. 착수 시간 · 분석 시간 · 리뷰 · 증명 예산이 쓴다.
 *
 * `NumberField` 처럼 **치는 도중에는 반영하지 않고** 칸을 떠나거나 Enter 에서 한 번 넘긴다.
 * 해석은 `parseDuration` 이 한다 — `2.5` · `1500ms` · `1분` · `무제한` 을 받고, 범위를 벗어나면
 * 끝값으로 자르고, 음수 · 글자 · 빈칸이면 그 칸의 기본값으로 돌린다. 자르거나 돌렸으면 칸 밑에
 * 까닭을 잠깐 띄운다(`role="status"` — 스크린 리더도 읽는다).
 *
 * 지금 값이 프리셋(`presetsMs`) 중 하나면 칸은 비어 있고(옆 칩이 켜져 있다), 아니면 그 값을
 * 칸의 기본 단위로 보여 주고 켜진 모양이 된다 — 값 하나에 켜진 표시도 하나다.
 */
export function DurationField({
  label,
  valueMs,
  spec,
  presetsMs = [],
  onCommit,
  disabled,
}: {
  label: string;
  valueMs: number;
  spec: DurationSpec;
  presetsMs?: readonly number[];
  onCommit: (ms: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const custom = !presetsMs.includes(valueMs);
  const shown = custom ? durationText(valueMs, spec.unit) : "";
  const [text, setText] = useState(shown);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setText(shown), [shown]);
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 3_500);
    return () => window.clearTimeout(t);
  }, [note]);

  const commit = () => {
    // 손대지 않고 떠난 칸 — 비어 있는 것은 «기본값으로»가 아니라 «그대로»다.
    if (text.trim() === shown.trim()) return;
    const r = parseDuration(text, spec);
    setNote(r.kind === "ok" ? null : r.note);
    const next = presetsMs.includes(r.ms) ? "" : durationText(r.ms, spec.unit);
    setText(next);
    if (r.ms !== valueMs) onCommit(r.ms);
  };

  return (
    <label
      className="field field--duration"
      htmlFor={id}
      data-on={(custom && valueMs > 0) || undefined}
      data-disabled={disabled || undefined}
    >
      <span className="field__box">
        <input
          id={id}
          className="field__input tnum"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={t("직접")}
          aria-label={t("{name} 직접 입력", { name: label })}
          title={t("{name}: 2.5 · 1500ms · 1분 · 무제한처럼 적고 Enter", { name: label })}
          value={text}
          disabled={disabled}
          aria-invalid={note !== null || undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(shown);
          }}
        />
        <span className="field__unit">{spec.unit === "s" ? t("초") : "ms"}</span>
      </span>
      {note && (
        <span className="field__note" role="status">
          {note}
        </span>
      )}
    </label>
  );
}
