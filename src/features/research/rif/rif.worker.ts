/// <reference lib="webworker" />
import { RifStreamParser } from "../../../core/rif/rif-parse";
import { buildPack, rifInput, type RenjuPack } from "../../../core/rif/pack";
import { overallFraction, type FromRifWorker, type RifPhase, type ToRifWorker } from "./protocol";

/**
 * W7 변환 워커 — 사용자가 고른 `.rif` 를 **스트림으로** 읽어(1MB 남짓씩) 팩을 만든다. 파일 전체를
 * 한 문자열로 들지 않는다(43MB · 저사양 폰). 결과의 타입드 배열은 복사 없이 넘긴다.
 *
 * 이 파일은 사용자의 기기 안에서만 돈다 — 아무것도 네트워크로 나가지 않는다.
 */

const post = (m: FromRifWorker, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

let lastPost = 0;
function progress(
  phase: RifPhase,
  f: number,
  loaded: number,
  total: number,
  games: number,
  part = 0,
  parts = 1,
) {
  const now = performance.now();
  if (now - lastPost < 80 && f < 1) return;
  lastPost = now;
  post({
    type: "progress",
    phase,
    fraction: overallFraction(phase, f, part, parts),
    loaded,
    total,
    games,
  });
}

/** 팩의 모든 타입드 배열 버퍼(중복 없이) — 넘길 목록. */
function buffers(p: RenjuPack): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  for (const group of [p.games, p.pos, p.edges])
    for (const v of Object.values(group) as ArrayBufferView[]) set.add(v.buffer as ArrayBuffer);
  set.add(p.tourYear.buffer as ArrayBuffer);
  return [...set];
}

async function convertRif(file: File, partitions?: number): Promise<void> {
  const t0 = performance.now();
  const parser = new RifStreamParser(undefined, file.size);
  const reader = file.stream().getReader();
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    parser.pushBytes(value); // 문자열로 바꾸지 않는다 — 쓰레기가 메모리 피크였다(rif-parse.ts)
    progress("read", loaded / file.size, loaded, file.size, parser.gameCount);
  }
  const parsed = parser.finish();
  if (parsed.games.count === 0) {
    throw new Error(
      "이 파일에서 대국을 찾지 못했습니다 — renju.net 의 «games database (XML)» 파일(.rif)인지 확인해 주세요.",
    );
  }
  const games = parsed.games.count;
  const pack = buildPack(rifInput(parsed, file, performance.now() - t0), {
    ...(partitions ? { partitions } : {}),
    onProgress: (phase, f, part, parts) =>
      progress(phase, f, file.size, file.size, games, part, parts),
  });
  post({ type: "done", pack, ms: performance.now() - t0 }, buffers(pack));
}

self.onmessage = (ev: MessageEvent<ToRifWorker>) => {
  const msg = ev.data;
  convertRif(msg.file, msg.partitions).catch((e: unknown) =>
    post({ type: "error", message: e instanceof Error ? e.message : String(e) }),
  );
};
