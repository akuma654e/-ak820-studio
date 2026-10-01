import { describe, expect, test } from "vitest";
import { MAX_DELAY_MS, normalizeDelay, planFrames } from "../imaging";

const sum = (a: { delay: number }[]) => a.reduce((s, f) => s + f.delay, 0);

describe("planFrames", () => {
  test("imagem estática vira um quadro sem atraso", () => {
    expect(planFrames([100], 1, 140)).toEqual([{ index: 0, delay: 0 }]);
  });

  test("GIF curto mantém todos os quadros e aplica velocidade", () => {
    const p = planFrames([100, 100, 200], 2, 140);
    expect(p.map((f) => f.index)).toEqual([0, 1, 2]);
    expect(p.map((f) => f.delay)).toEqual([50, 50, 100]);
  });

  test("atrasos de 0–10 ms tocam a 100 ms como no navegador", () => {
    expect(normalizeDelay(0)).toBe(100);
    expect(normalizeDelay(10)).toBe(100);
    expect(normalizeDelay(40)).toBe(40);
  });

  test("GIF longo é reamostrado no limite preservando a duração", () => {
    const delays = Array.from({ length: 300 }, () => 40);
    const p = planFrames(delays, 1, 140);
    expect(p.length).toBeLessThanOrEqual(140);
    expect(Math.abs(sum(p) - 12000)).toBeLessThan(140);
    // índices em ordem crescente
    expect(p.every((f, i) => i === 0 || f.index > p[i - 1].index)).toBe(true);
  });

  test("atraso longo é quebrado em quadros repetidos", () => {
    const p = planFrames([2000, 100], 1, 140);
    expect(p.every((f) => f.delay <= MAX_DELAY_MS)).toBe(true);
    expect(p.filter((f) => f.index === 0).length).toBe(4);
    expect(sum(p)).toBe(2100);
  });

  test("nunca passa de 255 quadros", () => {
    const p = planFrames(Array.from({ length: 600 }, () => 30), 1, 9999);
    expect(p.length).toBeLessThanOrEqual(255);
  });
});
