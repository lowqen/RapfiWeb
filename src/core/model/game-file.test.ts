import { describe, expect, it } from "vitest";
import { baseName, formatOf, parseGameFile, writePsq, writeSav } from "./game-file";
import { move } from "./move";

/**
 * 세 기보 형식을 데스크톱이 읽고 쓰는 바이트에 맞춰 본다 — 앱 `GameFileTest` 의 이식
 * (`load_game_file` main.c:3536, `show_dialog_save` 3665, `queue_add_current` 7470).
 */

const size = 15;
const line = [move(7, 7), move(8, 6), move(6, 8)];
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("형식 고르기", () => {
  it("확장자를 대소문자 없이 알아본다", () => {
    expect(formatOf("game.psq")).toBe("psq");
    expect(formatOf("GAME.PSQ")).toBe("psq");
    expect(formatOf("a.b.SAV")).toBe("sav");
    expect(formatOf("x.pos")).toBe("pos");
    expect(formatOf("notes.txt")).toBeNull();
    expect(formatOf("noextension")).toBeNull();
  });
});

describe("psq", () => {
  /** `x,y,time` 은 1부터이고 x 가 열이며, `-1` 에서 끝난다. */
  it("데스크톱이 읽는 대로 읽는다", () => {
    const t = [
      "Piskvorky 15x15, 11:11, 0",
      "8,8,0",
      "9,7,3",
      "7,9,1",
      "-1",
      "some trailing junk",
    ].join("\n");
    expect(parseGameFile(bytes(t), "psq", size)).toEqual(line);
  });

  it("CRLF 줄 끝도 읽는다", () => {
    const t = "Piskvorky 15x15, 0:0, 0\r\n8,8,0\r\n9,7,0\r\n7,9,0\r\n-1\r\n";
    expect(parseGameFile(bytes(t), "psq", size)).toEqual(line);
  });

  it("숫자로 시작하지 않는 첫 줄에서 멈춘다", () => {
    const t = "header\n8,8,0\nPlayer1 wins\n9,7,0\n";
    expect(parseGameFile(bytes(t), "psq", size)).toEqual([move(7, 7)]);
  });

  it("쓰개를 거쳐 왕복한다", () => {
    const b = writePsq(line, size);
    expect(text(b).startsWith("Piskvorky 15x15, 0:0, 0\n8,8,0\n")).toBe(true);
    expect(text(b).endsWith("-1\n")).toBe(true);
    expect(parseGameFile(b, "psq", size)).toEqual(line);
  });
});

describe("sav", () => {
  /** 건너뛸 크기 둘, 수, 그다음 `행 열` — 데스크톱 자신의 배치. */
  it("왕복한다", () => {
    const b = writeSav(line, size);
    expect(text(b)).toBe("15\n15\n3\n7 7\n6 8\n8 6\n");
    expect(parseGameFile(b, "sav", size)).toEqual(line);
  });

  it("저장된 수에서 멈춘다", () => {
    const t = "15\n15\n2\n7 7\n6 8\n8 6\n";
    expect(parseGameFile(bytes(t), "sav", size)).toEqual(line.slice(0, 2));
  });

  it("머리가 있어야 한다", () => {
    expect(parseGameFile(bytes("15\n"), "sav", size)).toBeNull();
  });
});

describe("pos", () => {
  /** 한 수 1바이트, `열 * 15 + 행`(main.c:3546 은 `xy % 15` 를 행으로 읽는다). */
  it("한 바이트에 한 수를 푼다", () => {
    const b = Uint8Array.of(2, 7 * 15 + 7, 8 * 15 + 6);
    expect(parseGameFile(b, "pos", size)).toEqual(line.slice(0, 2));
  });

  it("잘린 파일은 있는 만큼만 남긴다", () => {
    const b = Uint8Array.of(5, 7 * 15 + 7);
    expect(parseGameFile(b, "pos", size)).toEqual([move(7, 7)]);
  });

  it("빈 파일은 기보가 아니다", () => {
    expect(parseGameFile(new Uint8Array(0), "pos", size)).toBeNull();
  });
});

describe("이름과 경계", () => {
  /** `queue_basename`: 디렉터리 없이, 확장자 없이, 공백은 밑줄로. */
  it("파일 이름을 데스크톱처럼 줄인다", () => {
    expect(baseName("C:\\dir\\my game.psq")).toBe("my_game");
    expect(baseName("/sdcard/games/final.round.sav")).toBe("final");
    expect(baseName("")).toBe("game");
    expect(baseName(".psq")).toBe("game");
  });

  it("판 밖의 수에서 수순이 끝난다", () => {
    expect(parseGameFile(bytes("header\n8,8,0\n99,99,0\n"), "psq", size)).toEqual([move(7, 7)]);
  });

  it("같은 자리가 다시 나오면 수순이 끝난다", () => {
    expect(parseGameFile(bytes("header\n8,8,0\n8,8,0\n"), "psq", size)).toEqual([move(7, 7)]);
  });
});
