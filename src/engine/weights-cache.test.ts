import { describe, expect, it } from "vitest";
import { WEIGHTS_CACHE_NAME, loadWeights, sha256Hex, type WeightsDeps } from "./weights-cache";
import type { WeightsSpec } from "./engine-types";

/**
 * 가중치 캐시 계층 — 가짜 Cache Storage(키→Response 맵)와 가짜 fetch 로 경로마다 본다.
 * 해시는 진짜 SubtleCrypto 로 셈한다(노드 20 에 있다).
 */

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

class FakeCache {
  store = new Map<string, Response>();
  async match(url: string) {
    const r = this.store.get(url);
    return r ? r.clone() : undefined;
  }
  async put(url: string, res: Response) {
    this.store.set(url, res);
  }
  async delete(req: string | { url: string }) {
    return this.store.delete(typeof req === "string" ? req : req.url);
  }
  async keys() {
    return [...this.store.keys()].map((url) => ({ url }));
  }
}

function setup(opts: { served: string[]; cache?: boolean }) {
  const cache = new FakeCache();
  const opened: string[] = [];
  const requests: { url: string; init?: RequestInit | undefined }[] = [];
  const served = [...opts.served];
  const deps: WeightsDeps = {
    caches:
      opts.cache === false
        ? null
        : ({
            open: async (name: string) => {
              opened.push(name);
              return cache;
            },
          } as unknown as CacheStorage),
    fetch: async (url, init) => {
      requests.push({ url, init });
      const body = served.length > 1 ? served.shift()! : served[0]!;
      return new Response(bytes(body));
    },
    sha256: sha256Hex,
    now: () => 0,
  };
  return { cache, deps, requests, opened };
}

async function specOf(content: string, v = "1"): Promise<WeightsSpec> {
  const buf = bytes(content);
  return {
    url: `https://x/engine/rapfi.data?v=${v}`,
    size: buf.byteLength,
    sha256: await sha256Hex(buf),
  };
}

const text = (b: ArrayBuffer) => new TextDecoder().decode(b);

describe("가중치 캐시", () => {
  it("처음엔 내려받아 해시를 확인하고 캐시에 넣는다 — 다음 기동은 캐시에서", async () => {
    const spec = await specOf("WEIGHTS-A");
    const { deps, requests, cache, opened } = setup({ served: ["WEIGHTS-A"] });
    const first = await loadWeights(spec, deps);
    expect(first.source).toBe("network");
    expect(text(first.buffer)).toBe("WEIGHTS-A");
    expect(opened).toEqual([WEIGHTS_CACHE_NAME]);
    expect(cache.store.has(spec.url)).toBe(true);
    expect(cache.store.get(spec.url)!.headers.get("X-Rapfi-Sha256")).toBe(spec.sha256);

    const second = await loadWeights(spec, deps);
    expect(second.source).toBe("cache");
    expect(text(second.buffer)).toBe("WEIGHTS-A");
    expect(requests).toHaveLength(1); // 엔진 전환·재방문에 다시 받지 않는다
  });

  it("캐시의 내용이 해시와 다르면(손상·옛 버전) 지우고 다시 받는다", async () => {
    const spec = await specOf("WEIGHTS-A");
    const { deps, requests, cache } = setup({ served: ["WEIGHTS-A"] });
    await cache.put(spec.url, new Response(bytes("WEIGHTS-X")));
    const r = await loadWeights(spec, deps);
    expect(r.source).toBe("network");
    expect(text(r.buffer)).toBe("WEIGHTS-A");
    expect(r.notes.join()).toContain("맞지 않아");
    expect(requests).toHaveLength(1);
    expect(text(await (await cache.match(spec.url))!.arrayBuffer())).toBe("WEIGHTS-A");
  });

  it("새 버전이 오면 옛 버전 항목을 정리한다", async () => {
    const old = await specOf("OLD", "old");
    const now = await specOf("NEW", "new");
    const { deps, cache } = setup({ served: ["NEW"] });
    await cache.put(old.url, new Response(bytes("OLD")));
    await loadWeights(now, deps);
    expect([...cache.store.keys()]).toEqual([now.url]);
  });

  it("받은 것이 틀리면 HTTP 캐시를 건너뛰어 한 번 더 받는다", async () => {
    const spec = await specOf("GOOD");
    const { deps, requests } = setup({ served: ["STALE", "GOOD"] });
    const r = await loadWeights(spec, deps);
    expect(text(r.buffer)).toBe("GOOD");
    expect(requests.map((q) => q.init?.cache ?? "default")).toEqual(["default", "reload"]);
  });

  it("두 번 다 틀리면 던진다 — 틀린 가중치로는 띄우지 않는다", async () => {
    const spec = await specOf("GOOD");
    const { deps, cache } = setup({ served: ["BAD"] });
    await expect(loadWeights(spec, deps)).rejects.toThrow(/무결성/);
    expect(cache.store.size).toBe(0);
  });

  it("크기가 다르면 해시를 셈하기 전에 걸러진다", async () => {
    const spec = { ...(await specOf("GOOD")), size: 999 };
    const { deps } = setup({ served: ["GOOD"] });
    await expect(loadWeights(spec, deps)).rejects.toThrow(/크기/);
  });

  it("Cache Storage 가 없으면(사설 창 등) 네트워크만으로 뜬다", async () => {
    const spec = await specOf("W");
    const { deps } = setup({ served: ["W"], cache: false });
    const r = await loadWeights(spec, deps);
    expect(r.source).toBe("network");
    expect(text(r.buffer)).toBe("W");
  });

  it("캐시 저장이 실패해도(용량 등) 기동은 된다 — 기록만 남긴다", async () => {
    const spec = await specOf("W");
    const { deps, cache } = setup({ served: ["W"] });
    cache.put = async () => {
      throw new Error("QuotaExceededError");
    };
    const r = await loadWeights(spec, deps);
    expect(r.source).toBe("network");
    expect(r.notes.join()).toContain("QuotaExceededError");
  });

  it("HTTP 오류는 그대로 던진다", async () => {
    const spec = await specOf("W");
    const { deps } = setup({ served: ["W"] });
    deps.fetch = async () => new Response("nope", { status: 404 });
    await expect(loadWeights(spec, deps)).rejects.toThrow(/HTTP 404/);
  });
});
