#!/usr/bin/env node
/**
 * Rapfi config.toml 의 표 하나에 키를 넣거나 바꾼다 — 재빌드 없이 설정만 다른 엔진을 만들 때(P2-7 margin_scale 등).
 *
 *   node tools/config_set.mjs <config.toml> "model.evaluator:margin_scale=300" ["표:키=값" …]
 *
 * - 표 머리(`[model.evaluator]`)를 찾아, 그 표 안(다음 `[` 머리 전)에 같은 키가 있으면 값을 바꾸고 없으면 머리
 *   바로 아래에 넣는다(TOML 은 표의 키가 하위 표 `[[model.evaluator.weights]]` 보다 앞서야 한다 — 머리 바로 아래가 안전).
 * - 표가 없으면 실패한다(오타로 설정이 조용히 무시되는 것을 막는다). 값은 그대로 쓴다(숫자 · "문자열" · true).
 * - 원래 줄 끝을 지킨다(upstream config 는 CRLF).
 */
import { readFileSync, writeFileSync } from "node:fs";

const fail = (msg) => {
  console.error(`config_set: ${msg}`);
  process.exit(1);
};
const [file, ...sets] = process.argv.slice(2);
if (!file || !sets.length) fail('쓰임: node tools/config_set.mjs <config.toml> "표:키=값" …');

const text = readFileSync(file, "utf8");
const eol = text.includes("\r\n") ? "\r\n" : "\n";
const lines = text.split(/\r?\n/);
for (const s of sets) {
  const m = /^([\w.]+):(\w+)=(.+)$/.exec(s.trim());
  if (!m) fail(`형식이 아닙니다(표:키=값): ${s}`);
  const [, table, key, value] = m;
  const head = lines.findIndex((l) => l.trim() === `[${table}]`);
  if (head < 0) fail(`표가 없습니다: [${table}]`);
  let end = lines.findIndex((l, i) => i > head && /^\s*\[/.test(l));
  if (end < 0) end = lines.length;
  const at = lines.findIndex(
    (l, i) => i > head && i < end && new RegExp(`^\\s*${key}\\s*=`).test(l),
  );
  const line = `${key} = ${value}`;
  if (at >= 0) lines[at] = line;
  else lines.splice(head + 1, 0, line);
  console.log(`  . [${table}] ${line}${at >= 0 ? " (바꿈)" : " (넣음)"}`);
}
writeFileSync(file, lines.join(eol));
