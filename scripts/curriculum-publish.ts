/**
 * 공식 정석 커리큘럼 배포 — 검사 · 시험 · 커밋 · push 를 한 번에(docs/공식-정석-관리.md).
 *
 *   pnpm curriculum:publish                     # 스튜디오가 «저장소에 저장»으로 쓴 파일을
 *   pnpm curriculum:publish ~/Downloads/curriculum.json   # 스튜디오에서 내려받은 파일을
 *   … --no-push    커밋까지만      … --dry-run    검사만(파일도 안 바꾼다)
 *
 *  1. 파일을 읽어 앱과 같은 규칙으로 검증하고(`cleanCurriculum`), 스튜디오와 같은 검사(`auditCurriculum`)를
 *     지금 커밋된 배포본에 견줘 돌린다. **오류가 하나라도 있으면 멈춘다** — 경고(사라지는 레슨 · 링크 등)는
 *     보여 주고 지나간다.
 *  2. 배포 글꼴로 `public/joseki/curriculum.json` 에 쓴다(`formatCurriculum`). 바뀐 것이 없으면 끝.
 *  3. 커리큘럼 단위 시험(`src/core/curriculum`)을 돌린다 — 배포 파일 자체를 읽는 시험이 있다.
 *  4. 그 파일 하나만 커밋한다(«docs: curriculum <버전>», 본문에 더한 · 뺀 · 고친 레슨). 그리고 push.
 *     main 의 push 가 Cloudflare Pages 배포(deploy.yml)를 부르고, Zenyth 앱은 다음에 정석 탭을 열 때
 *     같은 파일을 받는다.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { auditCurriculum, errorsOf } from "../src/core/curriculum/audit";
import { formatCurriculum } from "../src/core/curriculum/format";
import { cleanCurriculum, type CurriculumFile, type Lesson } from "../src/core/curriculum/schema";
import { t } from "../src/i18n/i18n";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REL = "public/joseki/curriculum.json";
const TARGET = fileURLToPath(new URL(`../${REL}`, import.meta.url));

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const source = args.find((a) => !a.startsWith("--"));
const dry = flags.has("--dry-run");
const push = !flags.has("--no-push") && !dry;

const git = (...a: string[]) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
const fail = (msg: string): never => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

// 1. 읽기 · 검증
let raw: unknown;
try {
  raw = JSON.parse(readFileSync(source ?? TARGET, "utf8"));
} catch (e) {
  fail(`${source ?? REL} 을(를) 읽지 못했습니다: ${String(e)}`);
}
const clean = cleanCurriculum(raw);
if (!clean) fail("커리큘럼 파일(format: rapfiweb-curriculum, schema: 1)이 아닙니다");
const file = clean!.file;

let published: CurriculumFile | null = null;
try {
  published = cleanCurriculum(JSON.parse(git("show", `HEAD:${REL}`)))?.file ?? null;
} catch {
  /* 처음 싣는 커리큘럼 */
}

const issues = auditCurriculum(file, published);
const errors = errorsOf(issues);
const where = (i: (typeof issues)[number]) =>
  [i.course, i.lesson, i.path?.length ? `@${i.path.join(".")}` : ""].filter(Boolean).join(" › ");
for (const i of issues)
  console.log(
    `${i.level === "error" ? "✗ 오류" : "! 경고"}  ${t(i.text, i.vars)}${where(i) ? `  (${where(i)})` : ""}`,
  );
if (clean!.problems.length && !errors.length)
  console.log(`! 검증이 ${clean!.problems.length}곳을 버렸습니다(위 목록)`);
if (errors.length) fail(`오류 ${errors.length}개 — 스튜디오에서 고친 뒤 다시 실행하세요`);

const lessons = file.courses.reduce((n, c) => n + c.lessons.length, 0);
console.log(
  `✓ 검사 통과 — 코스 ${file.courses.length} · 레슨 ${lessons} · 버전 ${file.version || "(없음)"}`,
);
if (dry) process.exit(0);

// 2. 쓰기
writeFileSync(TARGET, formatCurriculum(file));
if (!git("status", "--porcelain", "--", REL)) {
  console.log("바뀐 것이 없습니다 — 배포본과 같습니다");
  process.exit(0);
}

// 3. 시험
const vitest = spawnSync("pnpm", ["exec", "vitest", "run", "src/core/curriculum"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (vitest.status !== 0)
  fail("커리큘럼 시험이 실패했습니다 — 파일은 바뀐 채로 두었습니다(git diff 로 보세요)");

// 4. 커밋 · push
const byId = (f: CurriculumFile | null) => {
  const m = new Map<string, Lesson>();
  for (const c of f?.courses ?? []) for (const l of c.lessons) m.set(l.id, l);
  return m;
};
const before = byId(published);
const after = byId(file);
const added = [...after.keys()].filter((id) => !before.has(id));
const removed = [...before.keys()].filter((id) => !after.has(id));
const changed = [...after.keys()].filter(
  (id) => before.has(id) && JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)),
);
const body = [
  added.length ? `Added: ${added.join(", ")}` : "",
  removed.length ? `Removed: ${removed.join(", ")}` : "",
  changed.length ? `Changed: ${changed.join(", ")}` : "",
  !added.length && !removed.length && !changed.length ? "Course order or course text only." : "",
]
  .filter(Boolean)
  .join("\n");
const subject = `docs: curriculum ${file.version}`.slice(0, 33);
git("add", "--", REL);
git("commit", "-m", subject, "-m", body, "--", REL);
console.log(`✓ 커밋 ${git("rev-parse", "--short", "HEAD")} ${subject}`);

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (!push) {
  console.log("push 는 하지 않았습니다(--no-push). 배포하려면 git push");
  process.exit(0);
}
const pushed = spawnSync("git", ["push"], { cwd: ROOT, stdio: "inherit" });
if (pushed.status !== 0)
  fail("push 하지 못했습니다 — 커밋은 남아 있습니다. git pull --rebase 뒤 git push");
console.log(
  branch === "main"
    ? "✓ push — 몇 분 뒤 https://rapfiweb.pages.dev/joseki 와 Zenyth 앱이 새 커리큘럼을 받습니다"
    : `! ${branch} 브랜치에 push 했습니다. 배포는 main 에서만 됩니다`,
);
