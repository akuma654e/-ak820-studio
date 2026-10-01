// Layout das 81 teclas com LED do AK820 Pro, na mesma ordem do protocolo
// (espelha crates/ak820-core/src/layout.rs).

export type KeyCell = { kind: "key"; index: number; label: string; w: number; row: number; x: number } | { kind: "gap"; w: number } | { kind: "screen"; w: number };

const ROWS: [string, number][][] = [
  [["Esc", 1], ["_", 0.35], ["F1", 1], ["F2", 1], ["F3", 1], ["F4", 1], ["_", 0.25], ["F5", 1], ["F6", 1], ["F7", 1], ["F8", 1], ["_", 0.25], ["F9", 1], ["F10", 1], ["F11", 1], ["F12", 1], ["_", 0.15], ["Del", 1], ["_", 0.25], ["#screen", 1.5]],
  [["`", 1], ["1", 1], ["2", 1], ["3", 1], ["4", 1], ["5", 1], ["6", 1], ["7", 1], ["8", 1], ["9", 1], ["0", 1], ["-", 1], ["=", 1], ["⌫", 2], ["_", 0.75], ["Home", 1]],
  [["Tab", 1.5], ["Q", 1], ["W", 1], ["E", 1], ["R", 1], ["T", 1], ["Y", 1], ["U", 1], ["I", 1], ["O", 1], ["P", 1], ["[", 1], ["]", 1], ["\\", 1.5], ["_", 0.75], ["PgUp", 1]],
  [["Caps", 1.75], ["A", 1], ["S", 1], ["D", 1], ["F", 1], ["G", 1], ["H", 1], ["J", 1], ["K", 1], ["L", 1], [";", 1], ["'", 1], ["Enter", 2.25], ["_", 0.75], ["PgDn", 1]],
  [["Shift", 2.25], ["Z", 1], ["X", 1], ["C", 1], ["V", 1], ["B", 1], ["N", 1], ["M", 1], [",", 1], [".", 1], ["/", 1], ["Shift", 1.75], ["_", 0.2], ["↑", 1]],
  [["Ctrl", 1.25], ["Win", 1.25], ["Alt", 1.25], ["", 6.25], ["Alt", 1.25], ["Fn", 1.25], ["Ctrl", 1.25], ["_", 0.2], ["←", 1], ["↓", 1], ["→", 1]],
];

export const WIDTH_UNITS = 17;
export const KEY_COUNT = 81;

export const KEY_ROWS: KeyCell[][] = (() => {
  let index = 0;
  return ROWS.map((row, r) => {
    let x = 0;
    return row.map(([label, w]) => {
      const cell: KeyCell = label === "_" ? { kind: "gap", w } : label === "#screen" ? { kind: "screen", w } : { kind: "key", index: index++, label, w, row: r, x };
      x += w;
      return cell;
    });
  });
})();

export const KEYS = KEY_ROWS.flat().filter((c): c is Extract<KeyCell, { kind: "key" }> => c.kind === "key");
