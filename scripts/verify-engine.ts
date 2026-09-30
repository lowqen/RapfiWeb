/**
 * 조립된 엔진 산출물(dist/engine)이 **커밋된 매니페스트와 짝인가** — web.yml·deploy.yml 이
 * 릴리스에서 받은 직후 부른다.
 *
 *   pnpm exec tsx scripts/verify-engine.ts
 *
 * 앱은 `src/engine/engine-manifest.json` 의 크기·SHA-256 으로 가중치를 검증한다
 * (weights-cache.ts). 여기서 어긋나면 배포된 앱이 **모든 사용자에게서** 무결성 검사에
 * 실패하므로, 배포 전에 같은 검사를 한 번 먼저 한다:
 *
 *   1. dist/engine/rapfi.data 의 크기·SHA-256 = 매니페스트
 *   2. 릴리스의 engine-manifest.json 과 커밋된 매니페스트의 가중치 값이 같다
 *   3. 매니페스트의 변형마다 .js·.wasm 이 있다
 *   4. 커밋된 글루(public/engine/*.js)가 릴리스의 글루와 바이트까지 같다 — 글루에 패키지
 *      목록(가중치 파일별 위치)이 박혀 있어, 다른 빌드의 것과 섞이면 가중치를 잘못 자른다
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist/engine");
const PUBLIC = join(ROOT, "public/engine");

interface Manifest {
  tag: string;
  data: { file: string; size: number; sha256: string };
  variants: string[];
}

const committed = JSON.parse(
  readFileSync(join(ROOT, "src/engine/engine-manifest.json"), "utf8"),
) as Manifest;
const errors: string[] = [];
const ok = (m: string) => console.log(`  ✓ ${m}`);

const dataPath = join(DIST, committed.data.file);
if (!existsSync(dataPath)) {
  errors.push(`${committed.data.file} 가 없습니다 — 릴리스 ${committed.tag} 를 받았는가?`);
} else {
  const size = statSync(dataPath).size;
  const sha = createHash("sha256").update(readFileSync(dataPath)).digest("hex");
  if (size !== committed.data.size)
    errors.push(`${committed.data.file} 크기 ${size} ≠ 매니페스트 ${committed.data.size}`);
  else if (sha !== committed.data.sha256)
    errors.push(`${committed.data.file} SHA-256 ${sha} ≠ 매니페스트 ${committed.data.sha256}`);
  else ok(`${committed.data.file} ${size} bytes · sha256 ${sha.slice(0, 16)}… = 매니페스트`);
}

const releasedPath = join(DIST, "engine-manifest.json");
if (existsSync(releasedPath)) {
  const released = JSON.parse(readFileSync(releasedPath, "utf8")) as Manifest;
  if (
    released.data.sha256 !== committed.data.sha256 ||
    released.data.size !== committed.data.size
  ) {
    errors.push("릴리스의 engine-manifest.json 과 커밋된 매니페스트의 가중치 값이 다릅니다");
  } else ok(`릴리스 매니페스트(${released.tag}) = 커밋된 매니페스트`);
} else {
  errors.push("릴리스에 engine-manifest.json 이 없습니다");
}

for (const v of committed.variants) {
  for (const ext of ["js", "wasm"]) {
    const f = `rapfi-${v}.${ext}`;
    if (!existsSync(join(DIST, f))) {
      errors.push(`${f} 가 없습니다`);
      continue;
    }
    const pub = join(PUBLIC, f);
    if (!existsSync(pub)) {
      errors.push(`커밋된 ${f} 가 없습니다(public/engine)`);
    } else if (!readFileSync(pub).equals(readFileSync(join(DIST, f)))) {
      errors.push(`커밋된 ${f} 가 릴리스의 것과 다릅니다 — 같은 빌드의 짝이 아니다`);
    }
  }
}
if (!errors.some((e) => e.includes("rapfi-")))
  ok(`변형 ${committed.variants.length}종의 .js·.wasm = 커밋된 것`);

if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("엔진 산출물 검증 통과");
