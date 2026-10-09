import { isRifFile } from "./rifStore";

/** W7 화면들이 함께 쓰는 형식 · 상수(컴포넌트 파일 밖 — 빠른 새로고침이 깨지지 않게). */

/** RenjuNet 의 내려받기 화면 — 사용자가 직접 받는다(우리는 그 파일을 싣지도 거치지도 않는다). */
export const RENJUNET_DOWNLOADS = "https://www.renju.net/downloads/";
export const fmtInt = (n: number): string => n.toLocaleString("ko-KR");
export const fmtMB = (b: number): string => `${(b / 1048576).toFixed(1)}MB`;
export const fmtSec = (ms: number): string =>
  ms < 10_000 ? `${(ms / 1000).toFixed(1)}초` : `${Math.round(ms / 1000)}초`;
export const pct = (x: number, n: number) => (n ? Math.round((x / n) * 100) : 0);
/** 끌어다 놓은 파일 가운데 `.rif` — 없으면 null. */
export const rifFrom = (files: FileList | null | undefined): File | null =>
  [...(files ?? [])].find(isRifFile) ?? null;
