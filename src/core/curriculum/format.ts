/**
 * 배포 파일 `public/joseki/curriculum.json` 의 글꼴 — 스튜디오의 내려받기 · 저장소 저장(개발 서버)과
 * `pnpm curriculum:publish` 가 모두 이것으로 쓴다. 그래서 누가 어디서 고치든 같은 내용이면 같은 바이트이고,
 * 커밋의 diff 는 실제로 바뀐 줄뿐이다.
 *
 * 모양은 손으로 쓴 처음 파일 그대로다: 들여쓰기 2칸, 값이 모두 원시값인 작은 객체(`{ "x": 7, "y": 7 }`,
 * 짧은 두 언어 글)는 100칸 안이면 한 줄, 열쇠는 아래 차례. 빈 배열은 `[]`.
 *
 * **아무것도 가져오지 않는다** — `vite.config.ts` 의 개발 서버 플러그인과 node 스크립트가 그대로 읽는다.
 */

const ORDER = [
  "format",
  "schema",
  "version",
  "courses",
  "id",
  "title",
  "level",
  "summary",
  "quiz",
  "side",
  "lessons",
  "root",
  "move",
  "x",
  "y",
  "mark",
  "role",
  "comment",
  "ko",
  "en",
  "children",
];
const WIDTH = 100;

const rank = (k: string) => {
  const i = ORDER.indexOf(k);
  return i < 0 ? ORDER.length : i;
};

function entries(o: Record<string, unknown>): [string, unknown][] {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => rank(a) - rank(b));
}

const primitive = (v: unknown) => v === null || typeof v !== "object";

/** 보이는 너비 — 한글 · 한자 같은 넓은 글자는 두 칸(Prettier 와 같은 셈). */
function width(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

function print(v: unknown, indent: string, lead: number): string {
  if (primitive(v)) return JSON.stringify(v);
  const inner = indent + "  ";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[\n${v.map((x) => inner + print(x, inner, inner.length)).join(",\n")}\n${indent}]`;
  }
  const es = entries(v as Record<string, unknown>);
  if (es.length === 0) return "{}";
  if (es.every(([, x]) => primitive(x))) {
    const flat = `{ ${es.map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(", ")} }`;
    if (lead + width(flat) + 1 <= WIDTH) return flat;
  }
  return `{\n${es
    .map(([k, x]) => {
      const head = `${inner}${JSON.stringify(k)}: `;
      return head + print(x, inner, head.length);
    })
    .join(",\n")}\n${indent}}`;
}

/** 커리큘럼(또는 어떤 JSON 값)을 배포 파일의 글꼴로. 끝에 줄바꿈 하나. */
export function formatCurriculum(file: unknown): string {
  return print(file, "", 0) + "\n";
}
