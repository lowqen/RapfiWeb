/**
 * 벤치에 쓸 두 엔진을 내려받는다 — 커밋하지 않는다(engines/ 는 .gitignore).
 *
 *   node bench/gomocalc/fetch-engines.mjs
 *
 * - gomocalc: www.gomocalc.com/build 에 배포된 그대로(서비스 중인 바이너리).
 *   `rapfi.data` 하나를 모든 변형이 같이 쓴다(gomocalc 의 locateFile 이 그렇게 돌린다).
 * - rapfiweb: 이 저장소가 배포하는 엔진 릴리스(web.yml 의 ENGINE_TAG 와 같은 것).
 *
 * 이미 있는 파일은 크기만 맞으면 건너뛴다. 폴더마다 `package.json`({"type":"commonjs"})을 둔다 — 저장소 루트의
 * `"type": "module"` 때문에 글루 .js 가 ESM 으로 읽혀 `bench/sprt/wasm-pbrain.mjs`(require)가 factory 를 못 찾는다.
 *
 * 우리 릴리스는 `gh` 로 받고, gh 가 없는 러너(갓 띄운 self-hosted 컨테이너)에서는 GH_TOKEN · GITHUB_TOKEN 으로
 * REST API 를 직접 부른다.
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// 배포 중인 릴리스 — 변형 4종(relaxed 포함)과 공유 가중치 rapfi.data 하나.
const ENGINE_TAG = process.env.ENGINE_TAG ?? "engine-3c94c2a9-a3";
const RX_VARIANTS = [
  "multi-simd128",
  "multi-simd128-relaxed",
  "single-simd128",
  "single-simd128-relaxed",
];

const SOURCES = {
  gomocalc: {
    base: "https://www.gomocalc.com/build/",
    files: [
      "rapfi-multi-simd128.js",
      "rapfi-multi-simd128.wasm",
      "rapfi-multi-simd128-relaxed.js",
      "rapfi-multi-simd128-relaxed.wasm",
      "rapfi-single-simd128.js",
      "rapfi-single-simd128.wasm",
      "rapfi.data",
    ],
  },
  rapfiweb: {
    base: null,
    files: [
      ...RX_VARIANTS.flatMap((v) => [`rapfi-${v}.js`, `rapfi-${v}.wasm`]),
      "rapfi.data",
      "ENGINE_VERSION.txt",
    ],
  },
};

async function fetchOne(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? NaN);
  try {
    const s = await stat(dest);
    if (Number.isFinite(len) && s.size === len) {
      await res.body?.cancel();
      return { dest, bytes: s.size, cached: true, lastModified: res.headers.get("last-modified") };
    }
  } catch {
    /* 없음 — 받는다 */
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return { dest, bytes: buf.length, cached: false, lastModified: res.headers.get("last-modified") };
}

/**
 * 이 저장소는 비공개라 릴리스 자산이 익명 URL 로는 404 다 — CI(web.yml)처럼
 * `gh release download` 로 받는다(GH_TOKEN 또는 gh 로그인 필요).
 */
const REPO = "lowqen/RapfiWeb";
async function ghDownload(tag, files, dir) {
  const args = ["release", "download", tag, "--repo", REPO, "--dir", dir, "--clobber"];
  for (const f of files) args.push("--pattern", f);
  try {
    execFileSync("gh", args, { stdio: "inherit" });
    return;
  } catch (e) {
    if (e.code !== "ENOENT") throw e; // gh 는 있는데 실패 — 인증 · 없는 태그. 그대로 알린다
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token)
    throw new Error(
      "gh 가 없고 GH_TOKEN · GITHUB_TOKEN 도 없습니다 — 비공개 릴리스를 받을 수 없음",
    );
  const auth = { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
  const rel = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
    headers: { ...auth, Accept: "application/vnd.github+json" },
  });
  if (!rel.ok) throw new Error(`릴리스 ${tag} → HTTP ${rel.status}`);
  const assets = new Map((await rel.json()).assets.map((a) => [a.name, a]));
  for (const f of files) {
    const a = assets.get(f);
    if (!a) throw new Error(`릴리스 ${tag} 에 ${f} 가 없습니다`);
    const res = await fetch(a.url, { headers: { ...auth, Accept: "application/octet-stream" } });
    if (!res.ok) throw new Error(`${f} → HTTP ${res.status}`);
    await writeFile(join(dir, f), Buffer.from(await res.arrayBuffer()));
  }
}
const COMMONJS = '{ "type": "commonjs" }\n';

const manifest = {};
for (const [name, src] of Object.entries(SOURCES)) {
  manifest[name] = [];
  const dir = join(HERE, "engines", name);
  if (name === "rapfiweb") {
    await mkdir(dir, { recursive: true });
    await ghDownload(ENGINE_TAG, src.files, dir);
    await writeFile(join(dir, "package.json"), COMMONJS);
    // 하네스는 변형마다 rapfi-<변형>.data 를 찾는다(글루 기본 이름) — 공유 파일을 그 이름들로 둔다.
    for (const v of RX_VARIANTS)
      await copyFile(join(dir, "rapfi.data"), join(dir, `rapfi-${v}.data`));
    for (const f of src.files) {
      const s = await stat(join(dir, f));
      manifest[name].push({ file: f, bytes: s.size, lastModified: null });
      console.log(`↓ ${name}/${f} ${s.size.toLocaleString()}B`);
    }
    continue;
  }
  for (const f of src.files) {
    const r = await fetchOne(src.base + f, join(dir, f));
    manifest[name].push({ file: f, bytes: r.bytes, lastModified: r.lastModified });
    console.log(`${r.cached ? "=" : "↓"} ${name}/${f} ${r.bytes.toLocaleString()}B`);
  }
  await writeFile(join(dir, "package.json"), COMMONJS);
}
await writeFile(
  resolve(HERE, "engines", "manifest.json"),
  JSON.stringify({ fetchedAt: new Date().toISOString(), engineTag: ENGINE_TAG, manifest }, null, 2),
);
