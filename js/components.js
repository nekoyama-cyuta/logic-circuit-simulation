// components.js — 部品（ゲート・入出力）の定義
//
// 各部品は「入力ピン」「出力ピン（最大1本）」「論理関数」を持つ。
// 座標系はノード左上を原点とするローカル座標。ピンは左端(入力)・右端(出力)に等間隔で並ぶ。
// 型名(positive/negative/normal …)は旧バージョンの保存データと互換。
(function (root) {
  'use strict';

  const TYPES = {
    positive: {
      name: '入力スイッチ', short: 'IN', w: 60, h: 40,
      inputs: [], outputs: ['OUT'], source: true, labeled: true,
      labelX: 27, labelY: 20,
    },
    negative: {
      name: '出力ランプ', short: 'OUT', w: 60, h: 40,
      inputs: ['IN'], outputs: [], labeled: true,
      labelX: 34, labelY: 20,
    },
    clock: {
      name: 'クロック', short: 'CLK', w: 60, h: 40,
      inputs: [], outputs: ['OUT'], source: true,
      labelX: 27, labelY: 28,
    },
    normal: {
      name: '中継点', short: '', w: 20, h: 20,
      inputs: ['IN'], outputs: ['OUT'],
      fn: ([a]) => a,
    },
    and: {
      name: 'AND', short: 'AND', w: 60, h: 50,
      inputs: ['A', 'B'], outputs: ['OUT'], labelX: 28, labelY: 25,
      fn: ([a, b]) => a && b,
    },
    or: {
      name: 'OR', short: 'OR', w: 60, h: 50,
      inputs: ['A', 'B'], outputs: ['OUT'], labelX: 29, labelY: 25,
      fn: ([a, b]) => a || b,
    },
    not: {
      name: 'NOT', short: 'NOT', w: 60, h: 40,
      inputs: ['IN'], outputs: ['OUT'], labelX: 23, labelY: 20,
      fn: ([a]) => !a,
    },
    xor: {
      name: 'XOR', short: 'XOR', w: 60, h: 50,
      inputs: ['A', 'B'], outputs: ['OUT'], labelX: 31, labelY: 25,
      fn: ([a, b]) => a !== b,
    },
    nand: {
      name: 'NAND', short: 'NAND', w: 60, h: 50,
      inputs: ['A', 'B'], outputs: ['OUT'], labelX: 26, labelY: 25,
      fn: ([a, b]) => !(a && b),
    },
    nor: {
      name: 'NOR', short: 'NOR', w: 60, h: 50,
      inputs: ['A', 'B'], outputs: ['OUT'], labelX: 27, labelY: 25,
      fn: ([a, b]) => !(a || b),
    },
    xnor: {
      name: 'XNOR', short: 'XNOR', w: 60, h: 50,
      inputs: ['A', 'B'], outputs: ['OUT'], labelX: 29, labelY: 25,
      fn: ([a, b]) => a === b,
    },
  };

  // ツールバーに並べる順番
  const PALETTE = [
    ['positive', 'negative', 'clock'],
    ['and', 'or', 'not', 'xor'],
    ['nand', 'nor', 'xnor', 'normal'],
  ];

  const CLOCK_DEFAULT_PERIOD = 1000; // ms（1周期）
  const CLOCK_MIN_PERIOD = 100;
  const CLOCK_MAX_PERIOD = 60000;
  const LABEL_MAX = 12;

  /** ピンのローカル座標と向き。存在しないピンなら null */
  function pinPosition(type, pin) {
    const def = TYPES[type];
    if (!def) return null;
    let i = def.inputs.indexOf(pin);
    if (i >= 0) return { x: 0, y: (def.h * (i + 1)) / (def.inputs.length + 1), dir: 'in' };
    i = def.outputs.indexOf(pin);
    if (i >= 0) return { x: def.w, y: (def.h * (i + 1)) / (def.outputs.length + 1), dir: 'out' };
    return null;
  }

  function pinDirection(type, pin) {
    const def = TYPES[type];
    if (!def) return null;
    if (def.inputs.includes(pin)) return 'in';
    if (def.outputs.includes(pin)) return 'out';
    return null;
  }

  function clampPeriod(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return CLOCK_DEFAULT_PERIOD;
    return Math.min(CLOCK_MAX_PERIOD, Math.max(CLOCK_MIN_PERIOD, Math.round(n)));
  }

  const api = {
    TYPES, PALETTE, pinPosition, pinDirection, clampPeriod,
    CLOCK_DEFAULT_PERIOD, LABEL_MAX,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LogicSim = Object.assign(root.LogicSim || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
