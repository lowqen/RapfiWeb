import { downloadBlob } from "../../../app/download";
import { csv, dateStamp, html, markdown, type GameReport } from "../../../core/review/report";

/**
 * 리포트 내보내기 — 데스크톱이 쓰는 세 파일(CSV · MD · HTML)을 내려받기로.
 * HTML 틀(`report-shell/`, 15KB)은 누를 때 따로 받는다 — 첫 화면에 실을 까닭이 없다.
 */

const download = (name: string, text: string, mime: string) =>
  downloadBlob(name, text, `${mime};charset=utf-8`);

/** 파일 이름 — 제목의 공백은 밑줄로(`queue_basename` 과 같은 습관). */
const fileName = (r: GameReport, ext: string) =>
  `${r.title.replace(/[\s/\\:*?"<>|]+/g, "_") || "game"}_review.${ext}`;

export function exportCsv(r: GameReport) {
  download(fileName(r, "csv"), csv(r), "text/csv");
}

export function exportMarkdown(r: GameReport) {
  download(fileName(r, "md"), markdown(r), "text/markdown");
}

export async function exportHtml(r: GameReport, log: string) {
  const [head, body, tail] = await Promise.all([
    import("../../../core/review/report-shell/head.html?raw"),
    import("../../../core/review/report-shell/body.html?raw"),
    import("../../../core/review/report-shell/tail.html?raw"),
  ]);
  const page = html(
    r,
    { head: head.default, body: body.default, tail: tail.default },
    dateStamp(r.createdAt),
    log,
  );
  download(fileName(r, "html"), page, "text/html");
}
