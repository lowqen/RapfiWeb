import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import {
  baseName,
  formatOf,
  parseGameFile,
  writePsq,
  writeSav,
  type GameFileFormat,
} from "../../core/model/game-file";

/**
 * 기보 파일 열기 · 저장 — 계획서 §4 「기보 파일 I/O」.
 *
 * 읽기는 `<input type=file>` 과 보드에 끌어다 놓기, 쓰기는 Chromium 이면
 * `showSaveFilePicker()`(진짜 «다른 이름으로 저장»), 그 밖에서는 Blob 내려받기다.
 * 판에 올리는 일은 `gameStore.loadMoves` 한 문으로 간다 — 자동 저장도 그 문을 쓴다.
 */

/** 열기의 결과 — 보드 위 안내 한 줄로 띄운다. */
export type OpenResult = { ok: true; text: string } | { ok: false; text: string };

export async function openGameFile(file: File): Promise<OpenResult> {
  const format = formatOf(file.name);
  if (!format) return { ok: false, text: `모르는 형식입니다 (${file.name}) — .psq · .sav · .pos` };
  const size = useBoardStore.getState().render.size;
  let moves;
  try {
    moves = parseGameFile(new Uint8Array(await file.arrayBuffer()), format, size);
  } catch {
    moves = null;
  }
  if (!moves) return { ok: false, text: `읽을 수 없는 파일입니다 (${file.name})` };
  useGameStore.getState().loadMoves(moves, {
    name: baseName(file.name),
    what: `기보 열기 — ${file.name} (${moves.length}수)`,
  });
  return { ok: true, text: `${file.name} — ${moves.length}수를 올렸습니다` };
}

/** 쓰는 형식 — 데스크톱이 쓰는 둘(.pos 는 읽기만). */
export type SaveFormat = Exclude<GameFileFormat, "pos">;

const MIME: Record<SaveFormat, string> = { psq: "text/plain", sav: "text/plain" };

/** `showSaveFilePicker` — DOM 타입 정의에 아직 없다(Chromium 86+ 에만 있다). */
type SavePicker = (opts: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

/**
 * 지금 판(무른 수는 빼고)을 `format` 으로 저장한다. 사용자가 저장 창을 닫으면 조용히
 * 끝난다. 저장했으면 파일 이름을, 취소했으면 `null` 을 돌려준다.
 */
export async function saveGameFile(format: SaveFormat): Promise<string | null> {
  const { stones, size } = useBoardStore.getState().render;
  const bytes = format === "psq" ? writePsq(stones, size) : writeSav(stones, size);
  const name = `${useGameStore.getState().gameName ?? "game"}.${format}`;
  const blob = new Blob([bytes], { type: MIME[format] });

  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description: `.${format} 기보`, accept: { [MIME[format]]: [`.${format}`] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return name;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      // 그 밖의 실패(권한 · 보안 정책)는 내려받기로 물러선다.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return name;
}
