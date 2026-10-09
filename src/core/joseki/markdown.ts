import { DEFAULT_SIZE, fromLabel, type Move } from "../model/move";

/**
 * 정석 메모의 마크다운 — 요구한 만큼만: **굵게** · *기울임* · `코드` · [링크](https://…) ·
 * 목록(`- ` · `1. `) · 문단 · 줄바꿈, 그리고 **좌표 자동 링크**(`h8` 을 누르면 그 수로).
 *
 * 계획서는 `marked` + `DOMPurify` 를 적었지만, 이 부분집합이면 HTML 을 만들 까닭이 없다: 여기서는
 * 나무(AST)만 만들고 화면이 그것을 React 요소로 그린다(`JosekiComment.tsx`). `innerHTML` 이 없으니
 * 가져온 파일의 `<script>` 나 `onerror=` 는 그냥 글자로 보인다 — 막을 것이 애초에 생기지 않는다.
 * 링크는 http · https · mailto 만 링크가 된다(`javascript:` 는 글자로).
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "coord"; label: string; move: Move }
  | { t: "br" };

export type Block = { t: "p"; c: Inline[] } | { t: "ul" | "ol"; items: Inline[][] };

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const COORD = /(^|[^A-Za-z0-9])([A-Oa-o](?:1[0-5]|[1-9]))(?![A-Za-z0-9])/g;

/** 좌표를 링크로 — 글자 사이(`abc8`)나 숫자에 붙은 것은 건드리지 않는다. */
function coords(text: string, size: number): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  COORD.lastIndex = 0;
  for (let m = COORD.exec(text); m; m = COORD.exec(text)) {
    const start = m.index + m[1]!.length;
    const mv = fromLabel(m[2]!, size);
    if (!mv) continue;
    if (start > last) out.push({ t: "text", v: text.slice(last, start) });
    out.push({ t: "coord", label: m[2]!, move: mv });
    last = start + m[2]!.length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/** 한 줄(또는 이어진 줄들)의 인라인. */
export function parseInline(src: string, size = DEFAULT_SIZE): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(...coords(buf, size));
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\" && i + 1 < src.length && /[\\*_`[\]()]/.test(src[i + 1]!)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "b", c: parseInline(src.slice(i + 2, end), size) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] !== ch && src[i + 1] !== " ") {
      const end = src.indexOf(ch, i + 1);
      if (end > i + 1 && src[end - 1] !== " ") {
        flush();
        out.push({ t: "i", c: parseInline(src.slice(i + 1, end), size) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const close = src.indexOf("](", i + 1);
      const end = close > 0 ? src.indexOf(")", close + 2) : -1;
      if (close > i && end > close) {
        const href = src.slice(close + 2, end).trim();
        if (SAFE_HREF.test(href)) {
          flush();
          out.push({ t: "link", href, c: parseInline(src.slice(i + 1, close), size) });
          i = end + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(src: string, size = DEFAULT_SIZE): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: string[] } | null = null;
  const endPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join("\n"), size) });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push({ t: list.t, items: list.items.map((x) => parseInline(x, size)) });
    list = null;
  };
  for (const line of src.replace(/\r\n?/g, "\n").split("\n")) {
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      endPara();
      const t = ul ? "ul" : "ol";
      if (!list || list.t !== t) {
        endList();
        list = { t, items: [] };
      }
      list.items.push((ul ?? ol)![1]!);
    } else if (line.trim() === "") {
      endPara();
      endList();
    } else if (list && /^\s{2,}/.test(line)) {
      // 들여 쓴 줄은 앞 항목의 이어짐
      list.items[list.items.length - 1] += `\n${line.trim()}`;
    } else {
      endList();
      para.push(line);
    }
  }
  endPara();
  endList();
  return blocks;
}

/** 서식을 뗀 글 — 검색과 목록 미리보기용. */
export function plainText(src: string): string {
  return src
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
