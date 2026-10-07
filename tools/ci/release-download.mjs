#!/usr/bin/env node
/**
 * 이 저장소(비공개)의 릴리스 자산 받기 — `gh` 가 있으면 그것으로, 없으면 GH_TOKEN · GITHUB_TOKEN 으로 REST API 를 직접.
 * gh 가 없는 self-hosted 러너(c4 — Intel Xeon 8581C)에서 deploy 가 「엔진 없이 배포하지 않는다」 관문에 걸렸다(37699365318).
 *
 *   node tools/ci/release-download.mjs <태그> <폴더> <패턴>…      패턴은 gh 처럼 * 하나짜리 glob(예: 'rapfi-*.js')
 *
 * 종료 코드: 0 = 받음 · 3 = 릴리스가 없음(web.yml 이 엔진 스모크를 건너뛰는 유일한 경우) · 1 = 그 밖의 실패(인증 · 네트워크 · 자산 없음).
 * 일시적 실패(네트워크 · 5xx · 429)는 물러서며 5번까지 다시 — 릴리스 자산이 HTTP 500 을 한 번 낸 적이 있다(match-gomocalc 37633345358).
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "lowqen/RapfiWeb";

export class ReleaseNotFound extends Error {}

/** 일시적 실패는 물러서며 다시. 4xx 는 곧바로(404 는 호출한 쪽이 res.status 로 가린다). */
export async function fetchRetry(url, init, what, tries = 5) {
  for (let i = 1; ; i++) {
    let why;
    try {
      const res = await fetch(url, init);
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      await res.body?.cancel();
      why = `HTTP ${res.status}`;
    } catch (e) {
      why = e.message;
    }
    if (i >= tries) throw new Error(`${what} → ${why}(${tries}번 시도)`);
    console.log(`  ! ${what}: ${why} — ${2 * i}초 뒤 다시(${i}/${tries})`);
    await new Promise((r) => setTimeout(r, 2000 * i));
  }
}

const globRe = (p) =>
  new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

/** @returns {Promise<string[]>} 받은 파일 이름 */
export async function releaseDownload(tag, dir, patterns) {
  await mkdir(dir, { recursive: true });
  const args = ["release", "download", tag, "--repo", REPO, "--dir", dir, "--clobber"];
  for (const p of patterns) args.push("--pattern", p);
  try {
    execFileSync("gh", args, { stdio: ["ignore", "inherit", "pipe"] });
    return patterns;
  } catch (e) {
    if (e.code !== "ENOENT") {
      const err = String(e.stderr ?? e.message);
      if (/release not found/i.test(err)) throw new ReleaseNotFound(`릴리스 ${tag} 가 없습니다`);
      throw new Error(`gh release download 실패: ${err.trim()}`);
    }
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token)
    throw new Error(
      "gh 가 없고 GH_TOKEN · GITHUB_TOKEN 도 없습니다 — 비공개 릴리스를 받을 수 없음",
    );
  const auth = { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
  const rel = await fetchRetry(
    `https://api.github.com/repos/${REPO}/releases/tags/${tag}`,
    { headers: { ...auth, Accept: "application/vnd.github+json" } },
    `릴리스 ${tag}`,
  );
  if (rel.status === 404) throw new ReleaseNotFound(`릴리스 ${tag} 가 없습니다`);
  if (!rel.ok) throw new Error(`릴리스 ${tag} → HTTP ${rel.status}`);
  const assets = (await rel.json()).assets;
  const got = [];
  for (const p of patterns) {
    const re = globRe(p);
    const hits = assets.filter((a) => re.test(a.name));
    if (!hits.length) throw new Error(`릴리스 ${tag} 에 '${p}' 에 맞는 자산이 없습니다`);
    for (const a of hits) {
      const res = await fetchRetry(
        a.url,
        { headers: { ...auth, Accept: "application/octet-stream" } },
        a.name,
      );
      if (!res.ok) throw new Error(`${a.name} → HTTP ${res.status}`);
      await writeFile(join(dir, a.name), Buffer.from(await res.arrayBuffer()));
      console.log(`↓ ${a.name} ${a.size.toLocaleString("en-US")}B`);
      got.push(a.name);
    }
  }
  return got;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [tag, dir, ...patterns] = process.argv.slice(2);
  if (!tag || !dir || !patterns.length) {
    console.error("쓰임: node tools/ci/release-download.mjs <태그> <폴더> <패턴>…");
    process.exit(2);
  }
  try {
    await releaseDownload(tag, dir, patterns);
  } catch (e) {
    console.error(`release-download: ${e.message}`);
    process.exit(e instanceof ReleaseNotFound ? 3 : 1);
  }
}
