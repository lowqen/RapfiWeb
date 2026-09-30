import type { WeightsSpec } from "./engine-types";

/**
 * 가중치(.data, ~20MB) 캐시 계층 — 엔진 워커가 기동할 때 부른다.
 *
 * ## 왜 따로 두는가
 *
 * 글루는 `.data` 를 스스로 `fetch` 한다. 그러면 (1) 변형마다 파일 이름이 달라
 * (`rapfi-multi-simd128.data`·`rapfi-single-simd128.data` — 내용은 바이트까지 같다) 멀티가
 * 기동에 실패해 단일로 물러서면 **같은 20MB 를 다시 받고**, (2) 받은 것이 맞는지 아무도
 * 보지 않는다. 그래서 모든 변형이 **파일 하나**(`rapfi.data`)를 쓰게 하고, 그것을 여기서
 * 받아 해시를 확인한 뒤 글루에 `getPreloadedPackage` 로 넘긴다 — 글루는 그 훅이 버퍼를
 * 주면 내려받지 않는다(Emscripten file_packager).
 *
 * ## 무결성
 *
 * 기대값은 빌드가 낸 `engine-manifest.json` 의 크기·SHA-256 이다. **캐시에서 꺼낸 것도
 * 새로 받은 것도 해시를 다시 본다** — 버전이 바뀌었거나(해시 불일치) 저장소가 상했으면
 * 지우고 다시 받는다. 새로 받은 것이 틀리면 HTTP 캐시를 건너뛰어(`cache: "reload"`) 한 번 더
 * 받고, 그래도 틀리면 던진다 — 틀린 가중치로 뜬 엔진은 조용히 약해진다.
 *
 * ## 저장소
 *
 * Cache Storage(`caches`) 를 쓴다. 워커에서도 열리고 응답을 통째로 담기에 알맞다. 없거나
 * 막혀 있으면(사설 창·저장소 차단) 캐시 없이 네트워크만 쓴다 — 기동은 그대로 된다.
 * 키에 버전 쿼리(`?v=<해시 앞자리>`)가 들어 있어, 새 엔진이 나오면 옛 항목은 정리한다.
 */

export const WEIGHTS_CACHE_NAME = "rapfi-weights-v1";

export interface WeightsDeps {
  /** 없으면(null) 캐시 없이 네트워크만. */
  caches: CacheStorage | null;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  sha256: (buf: ArrayBuffer) => Promise<string>;
  now: () => number;
}

export interface LoadedWeights {
  buffer: ArrayBuffer;
  source: "cache" | "network";
  ms: number;
  /** 사람이 읽을 기록 — 콘솔에 남긴다(캐시 불일치로 다시 받았다 등). */
  notes: string[];
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function defaultWeightsDeps(): WeightsDeps {
  let store: CacheStorage | null = null;
  try {
    store = typeof caches === "undefined" ? null : caches;
  } catch {
    store = null; // 일부 환경은 접근만으로 던진다
  }
  return {
    caches: store,
    fetch: (url, init) => fetch(url, init),
    sha256: sha256Hex,
    now: () => performance.now(),
  };
}

const short = (h: string) => h.slice(0, 12);

async function verify(
  buf: ArrayBuffer,
  spec: WeightsSpec,
  deps: WeightsDeps,
): Promise<string | null> {
  if (buf.byteLength !== spec.size) return `크기 ${buf.byteLength} ≠ ${spec.size}`;
  const got = await deps.sha256(buf);
  return got === spec.sha256 ? null : `SHA-256 ${short(got)}… ≠ ${short(spec.sha256)}…`;
}

async function download(
  spec: WeightsSpec,
  deps: WeightsDeps,
  init?: RequestInit,
): Promise<ArrayBuffer> {
  const res = await deps.fetch(spec.url, init);
  if (!res.ok) throw new Error(`가중치를 받지 못했습니다: HTTP ${res.status} ${spec.url}`);
  return res.arrayBuffer();
}

/**
 * 가중치를 얻는다 — 캐시(검증) → 네트워크(검증, 틀리면 캐시 우회로 한 번 더) → 캐시에 넣기.
 * 캐시의 실패는 삼키고(기록만) 네트워크·무결성의 실패만 던진다.
 */
export async function loadWeights(
  spec: WeightsSpec,
  deps: WeightsDeps = defaultWeightsDeps(),
): Promise<LoadedWeights> {
  const t0 = deps.now();
  const notes: string[] = [];
  let cache: Cache | null = null;
  try {
    cache = deps.caches ? await deps.caches.open(WEIGHTS_CACHE_NAME) : null;
  } catch (e) {
    notes.push(`캐시 저장소를 열 수 없어 네트워크로 받습니다: ${String(e)}`);
  }

  if (cache) {
    try {
      const hit = await cache.match(spec.url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        const bad = await verify(buf, spec, deps);
        if (!bad) return { buffer: buf, source: "cache", ms: Math.round(deps.now() - t0), notes };
        notes.push(`캐시의 가중치가 맞지 않아(${bad}) 지우고 다시 받습니다`);
        await cache.delete(spec.url);
      }
    } catch (e) {
      notes.push(`캐시를 읽지 못해 네트워크로 받습니다: ${String(e)}`);
    }
  }

  let buf = await download(spec, deps);
  let bad = await verify(buf, spec, deps);
  if (bad) {
    // HTTP 캐시가 옛 파일을 내줬을 수 있다(같은 URL 에 다른 내용) — 건너뛰고 한 번 더.
    notes.push(`받은 가중치가 맞지 않아(${bad}) HTTP 캐시를 건너뛰고 다시 받습니다`);
    buf = await download(spec, deps, { cache: "reload" });
    bad = await verify(buf, spec, deps);
    if (bad) throw new Error(`가중치 무결성 검사 실패 — ${bad} (${spec.url})`);
  }

  if (cache) {
    try {
      // Response 는 본문을 **복사**해 담는다 — 넘기는 버퍼는 글루가 그대로 쓴다.
      await cache.put(
        spec.url,
        new Response(buf, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(buf.byteLength),
            "X-Rapfi-Sha256": spec.sha256,
          },
        }),
      );
      // 옛 버전 정리 — 키가 버전 쿼리를 품고 있으므로 지금 것이 아니면 전부 옛것이다.
      for (const req of await cache.keys()) {
        if (req.url !== spec.url) await cache.delete(req);
      }
    } catch (e) {
      notes.push(`가중치를 캐시에 넣지 못했습니다(다음에도 받습니다): ${String(e)}`);
    }
  }
  return { buffer: buf, source: "network", ms: Math.round(deps.now() - t0), notes };
}
