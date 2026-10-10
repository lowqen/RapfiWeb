import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CSP_KEYS, ISOLATION_KEYS, omit, parseHeaders, siteHeaders } from "./headers";

/**
 * `public/_headers` 의 보안 정책을 못 박는다(docs/보안-강화-계획.md Phase 1). 스모크가 «이 정책 아래서
 * 앱이 도는가»를 보고, 이 시험은 «정책이 느슨해지거나 어긋나지 않았는가»를 본다.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...values]) => [name!, values]),
  );
}

describe("_headers 파서", () => {
  it("경로 · 헤더 · 주석", () => {
    const rules = parseHeaders("# c\n/*\n  A: 1\n  B: x: y\n\n/e/*\n  C: 2\n");
    expect(rules.get("/*")).toEqual({ A: "1", B: "x: y" });
    expect(rules.get("/e/*")).toEqual({ C: "2" });
  });

  it("한 규칙의 같은 이름 · 경로 없는 헤더는 거부", () => {
    expect(() => parseHeaders("/*\n  A: 1\n  A: 2\n")).toThrow();
    expect(() => parseHeaders("  A: 1\n")).toThrow();
  });

  it("omit 은 대소문자를 가리지 않는다", () => {
    expect(omit({ "Cross-Origin-Opener-Policy": "x", B: "y" }, ISOLATION_KEYS)).toEqual({ B: "y" });
  });
});

describe("배포 정책", () => {
  const site = siteHeaders();
  const csp = directives(site["Content-Security-Policy"] ?? "");

  it("격리 · 프레임 · 출처 헤더가 있다", () => {
    expect(site["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(site["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
    expect(site["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(site["X-Frame-Options"]).toBe("DENY");
    expect(site["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("CSP 는 강제이고(Report-Only 아님) 핵심 지시어가 조여 있다", () => {
    expect(site["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(csp.get("worker-src")).toEqual(["'self'"]);
    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.get("style-src")).toEqual(["'self'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'none'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("어디에도 'unsafe-eval' · 'unsafe-inline' · 와일드카드가 없다", () => {
    for (const values of csp.values()) {
      expect(values).not.toContain("'unsafe-eval'");
      expect(values).not.toContain("'unsafe-inline'");
      expect(values).not.toContain("*");
    }
  });

  it("CSP · 격리 헤더는 `/*` 한 규칙에만 있다(Pages 가 같은 이름을 쉼표로 이어 «두 정책»이 된다)", () => {
    const rules = parseHeaders(read("../public/_headers"));
    for (const [path, headers] of rules) {
      if (path === "/*") continue;
      for (const k of [...CSP_KEYS, ...ISOLATION_KEYS])
        expect(headers[k], `${path} ${k}`).toBeUndefined();
    }
  });

  it("HTML 에 인라인 <script> 가 없다(script-src 'self' 가 막는다)", () => {
    for (const html of ["../index.html", "../showcase/index.html"]) {
      const inline = read(html).match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? [];
      expect(inline, html).toEqual([]);
    }
  });
});
