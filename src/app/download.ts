/**
 * 바이트 · 글을 파일로 내려받는다 — 링크를 하나 만들어 누르고 곧 거둔다. 파일 저장 대화상자
 * (`showSaveFilePicker`)를 쓰는 기보 저장(`gameFileActions.ts`)과 달리 묻지 않고 받는다.
 */
export function downloadBlob(name: string, data: Uint8Array | string, mime: string): void {
  const part: BlobPart =
    typeof data === "string" ? data : (data.slice() as Uint8Array<ArrayBuffer>);
  const url = URL.createObjectURL(new Blob([part], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 파일 이름에 붙이는 날짜(`20261009-1432`). */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
