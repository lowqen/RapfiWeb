import { useEffect, useRef, useState } from "react";
import type { Issue } from "../../../core/curriculum/audit";
import { t } from "../../../i18n/i18n";
import { useStudio, type Sel } from "./studioStore";

/**
 * 스튜디오의 작은 부품 — 고쳐 쓰는 입력칸(초점을 잃을 때 들인다), 두 언어 칸, 검사 목록.
 */

/**
 * 고쳐 쓰는 칸 — 치는 동안은 칸 안에만 두고, 초점을 잃거나 Enter(한 줄 칸) 때 `onCommit`. 글자마다 파일을
 * 바꾸지 않으므로 되돌리기가 «한 번 고친 것» 단위가 된다. `live` 면 쉬는 동안(0.4초)에도 들인다(해설).
 */
export function DraftField({
  value,
  onCommit,
  multiline = false,
  rows = 3,
  live = false,
  label,
  placeholder,
  lang,
  check,
}: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  live?: boolean;
  label: string;
  placeholder?: string;
  lang?: "ko" | "en";
  /** 들이기 전에 묻는다 — 문제가 있으면 그 글(이미 번역됨)을 보이고 들이지 않는다. */
  check?: (v: string) => string | null;
}) {
  const [draft, setDraft] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  const last = useRef(value);
  // 밖에서 바뀌면(되돌리기 · 다른 것 고르기) 따라간다.
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setDraft(value);
      setProblem(null);
    }
  }, [value]);
  const commit = (v = draft) => {
    if (v === last.current) return;
    const why = check?.(v) ?? null;
    setProblem(why);
    if (why) return;
    last.current = v;
    onCommit(v);
  };
  useEffect(() => {
    if (!live || draft === last.current) return;
    const h = setTimeout(() => commit(draft), 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, live]);
  const common = {
    value: draft,
    "aria-label": label,
    "aria-invalid": problem ? true : undefined,
    placeholder,
    lang,
    onBlur: () => commit(),
  };
  return (
    <span className="sfield__box">
      {multiline ? (
        <textarea {...common} rows={rows} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <input
          {...common}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(last.current);
              setProblem(null);
            }
          }}
        />
      )}
      {problem && (
        <span className="sfield__problem" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}

/** 한국어 · 영어 두 칸. 영어가 비면 앱이 한국어를 보인다(검사가 «영어 없음»으로 짚는다). */
export function TextPair({
  label,
  ko,
  en,
  onCommit,
  multiline = false,
  live = false,
  rows = 3,
}: {
  label: string;
  ko: string;
  en: string;
  onCommit: (lang: "ko" | "en", v: string) => void;
  multiline?: boolean;
  live?: boolean;
  rows?: number;
}) {
  return (
    <div className="sfield">
      <span className="sfield__label">{label}</span>
      <div className="spair">
        <DraftField
          label={`${label} (${t("한국어")})`}
          placeholder={t("한국어")}
          lang="ko"
          value={ko}
          multiline={multiline}
          live={live}
          rows={rows}
          onCommit={(v) => onCommit("ko", v)}
        />
        <DraftField
          label={`${label} (English)`}
          placeholder="English"
          lang="en"
          value={en}
          multiline={multiline}
          live={live}
          rows={rows}
          onCommit={(v) => onCommit("en", v)}
        />
      </div>
    </div>
  );
}

/** 검사 목록 — 누르면 그 코스 · 레슨 · 마디로 간다. */
export function IssueList({ issues, empty }: { issues: readonly Issue[]; empty?: string }) {
  const select = useStudio((s) => s.select);
  const go = useStudio((s) => s.go);
  if (issues.length === 0)
    return (
      <p className="panel__hint" data-k="studio-clean">
        {empty ?? t("문제가 없습니다")}
      </p>
    );
  const open = (i: Issue) => {
    const sel: Sel | null = i.lesson
      ? { kind: "lesson", id: i.lesson }
      : i.course
        ? { kind: "course", id: i.course }
        : null;
    if (!sel) return;
    select(sel);
    if (i.path) go(i.path);
  };
  return (
    <ul className="sissues" data-k="studio-issues">
      {issues.map((i, n) => {
        const where = [i.course, i.lesson].filter(Boolean).join(" › ");
        const text = t(i.text, i.vars);
        return (
          <li key={n} data-level={i.level}>
            <button
              type="button"
              onClick={() => open(i)}
              disabled={!i.course && !i.lesson}
              aria-label={`${i.level === "error" ? t("오류") : t("경고")}: ${text}`}
            >
              <span className="sissues__dot" aria-hidden="true" />
              <span className="sissues__text">{text}</span>
              {where && <span className="sissues__where">{where}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
