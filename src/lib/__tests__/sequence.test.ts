import { describe, expect, test } from "vitest";
import { defaultEdit, sequence, type Source } from "../imaging";
import { KEYS, KEY_COUNT } from "../layout";

const src = (n: number) => ({ name: "t", width: 1, height: 1, animated: n > 1, truncated: false, frames: Array.from({ length: n }, () => ({ bitmap: null as never, delay: 100 })) }) as Source;

describe("sequence", () => {
  test("normal, corte, invertido e vaivém", () => {
    const e = defaultEdit();
    expect(sequence(src(5), e)).toEqual([0, 1, 2, 3, 4]);
    expect(sequence(src(5), { ...e, trimStart: 1, trimEnd: 3 })).toEqual([1, 2, 3]);
    expect(sequence(src(5), { ...e, playback: "reverse" })).toEqual([4, 3, 2, 1, 0]);
    expect(sequence(src(4), { ...e, playback: "pingpong" })).toEqual([0, 1, 2, 3, 2, 1]);
    expect(sequence(src(1), { ...e, playback: "pingpong" })).toEqual([0]);
  });
  test("corte fora do intervalo é limitado", () => {
    expect(sequence(src(3), { ...defaultEdit(), trimStart: 9, trimEnd: 1 })).toEqual([2]);
  });
});

describe("layout", () => {
  test("81 teclas na ordem do protocolo", () => {
    expect(KEYS.length).toBe(KEY_COUNT);
    expect(KEYS[0].label).toBe("Esc");
    expect(KEYS[13].label).toBe("Del");
    expect(KEYS[80].label).toBe("→");
    expect(KEYS.map((k) => k.index)).toEqual(Array.from({ length: 81 }, (_, i) => i));
  });
});
