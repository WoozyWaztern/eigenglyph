// material ids + base colors (dark palette)
export const M = {
  NONE: 0, CONCRETE: 1, DARK: 2, CRATE: 3, PILLAR: 4, PANEL: 5, BORDER: 6, METAL: 7, FLOOR: 8,
  BODY: 10, EYE: 11, ARM: 12, GUNMETAL: 13, WOOD: 14, BLADE: 15, CAN: 16, CAN_TOP: 17,
  SHELL: 18, GRIP: 19, BRASS: 20, DEADEYE: 21,
  AKBLACK: 22, POLY: 23, BATWOOD: 24, GLASS: 25, RAG: 26, FLAME: 27, MEDWHITE: 28, MEDRED: 29, TAPE: 30, STEEL: 31, SIGMA: 32,
};
export const BASE = [];
const set = (id, rgb, spec = 0) => { BASE[id] = { c: rgb, spec }; };
set(M.CONCRETE, [112, 116, 124]);
set(M.DARK,     [80, 83, 90]);
set(M.CRATE,    [116, 90, 64]);
set(M.PILLAR,   [118, 34, 42], 0.2);
set(M.PANEL,    [48, 92, 98], 0.3);
set(M.BORDER,   [66, 68, 76]);
set(M.METAL,    [124, 128, 138], 0.6);
set(M.FLOOR,    [74, 76, 86]);
set(M.BODY,     [104, 108, 118], 0.25);
set(M.EYE,      [225, 230, 240]);
set(M.ARM,      [128, 132, 142], 0.3);
set(M.GUNMETAL, [70, 78, 96], 0.9);
set(M.WOOD,     [120, 74, 44], 0.15);
set(M.BLADE,    [190, 196, 206], 1.0);
set(M.CAN,      [138, 22, 34], 0.7);
set(M.CAN_TOP,  [175, 178, 186], 0.9);
set(M.SHELL,    [150, 30, 30], 0.3);
set(M.GRIP,     [44, 45, 50], 0.1);
set(M.BRASS,    [170, 136, 64], 0.8);
set(M.DEADEYE,  [40, 8, 10]);
set(M.AKBLACK,  [86, 91, 104], 0.95);   // blackened steel of the dark AK
set(M.POLY,     [64, 65, 74], 0.35);   // black polymer furniture
set(M.BATWOOD,  [178, 132, 82], 0.3);
set(M.GLASS,    [74, 118, 70], 1.0);
set(M.RAG,      [176, 164, 140], 0);
set(M.FLAME,    [255, 168, 60], 0);    // emissive, flickers
set(M.MEDWHITE, [204, 206, 210], 0.35);
set(M.MEDRED,   [190, 34, 42], 0.2);
set(M.TAPE,     [30, 30, 34], 0.05);
set(M.STEEL,    [150, 156, 168], 0.9);
set(M.SIGMA,    [246, 200, 84], 1.0);   // the golden Σ of CAPTURE mode
