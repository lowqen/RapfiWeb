/**
 * 바이트 · 글을 파일로 내려받는다 — 링크를 하나 만들어 누르고 곧 거둔다. 파일 저장 대화상자
 * (`showSaveFilePicker`)를 쓰는 기보 저장(`gameFileActions.ts`)과 달리 묻지 않고 받는다.
 */
export function downloadBlob(name: string, data: Blob | Uint8Array | string, mime: string): void {
  const blob =
    data instanceof Blob
      ? data
      : new Blob([typeof data === "string" ? data : (data.slice() as Uint8Array<ArrayBuffer>)], {
          type: mime,
        });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // 곧바로(0ms) 거두지 않는다. 브라우저는 다운로드를 클릭 뒤 **비동기로** 시작하므로, 그 전에
  // 주소를 거두면 느린 기기 · 일부 브라우저에서 빈 파일이나 「실패」가 된다. 1분이면 넉넉하고,
  // 그동안 쥐는 것은 이 Blob 하나다.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

const REVOKE_AFTER_MS = 60_000;

/** 파일 이름에 붙이는 날짜(`20261009-1432`). */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
