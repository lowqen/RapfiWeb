/**
 * 레슨 링크 — `/joseki?lesson=<id>`(학습으로 바로 열려면 `&mode=learn`). 정석 화면이 주소의 이 값으로 레슨을
 * 연다(`features/joseki/curriculum/CurriculumHome.tsx`).
 */
export type LessonMode = "browse" | "learn";

export function lessonUrl(origin: string, base: string, id: string, mode: LessonMode): string {
  const q = new URLSearchParams({ lesson: id });
  if (mode === "learn") q.set("mode", "learn");
  return `${origin}${base}joseki?${q.toString()}`;
}
