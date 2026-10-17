// shapes.js — 部品の見た目（SVG）。キャンバス・ツールバーのアイコン・アセットのプレビューで共用
(function (root) {
  'use strict';
  const LS = root.LogicSim;
  const { TYPES, pinPosition } = LS;

  const bubble = (cx, cy) => `<circle class="body bubble" cx="${cx}" cy="${cy}" r="4"/>`;
  const OR_BACK = '<path class="back-line" d="M5,5 Q19,25 5,45"/>';

  const BODY = {
    positive: '<rect class="body" x="4" y="4" width="46" height="32" rx="7"/>',
    negative: '<circle class="body" cx="34" cy="20" r="16"/>',
    clock: '<rect class="body" x="4" y="4" width="46" height="32" rx="5"/>'
      + '<path class="wave" d="M12,20 H18 V10 H27 V20 H36 V10 H42"/>',
    normal: '<circle class="body" cx="10" cy="10" r="6"/>',
    and: '<path class="body" d="M8,5 H30 A22,20 0 0 1 30,45 H8 Z"/>',
    nand: '<path class="body" d="M8,5 H26 A20,20 0 0 1 26,45 H8 Z"/>' + bubble(50, 25),
    or: '<path class="body" d="M8,5 Q22,25 8,45 Q38,45 52,25 Q38,5 8,5 Z"/>',
    nor: '<path class="body" d="M8,5 Q22,25 8,45 Q34,45 46,25 Q34,5 8,5 Z"/>' + bubble(50, 25),
    xor: OR_BACK + '<path class="body" d="M11,5 Q25,25 11,45 Q40,45 52,25 Q40,5 11,5 Z"/>',
    xnor: OR_BACK + '<path class="body" d="M11,5 Q25,25 11,45 Q36,45 46,25 Q36,5 11,5 Z"/>' + bubble(50, 25),
    not: '<path class="body" d="M10,5 L44,20 L10,35 Z"/>' + bubble(48, 20),
  };

  /** ピン → 本体 をつなぐ短い線。本体の塗りの下に描くので長さは大雑把でよい */
  function stubs(type) {
    const def = TYPES[type];
    if (type === 'normal') return '';
    let s = '';
    for (const p of def.inputs) {
      const pos = pinPosition(type, p);
      s += `<line class="stub stub-in" x1="0" y1="${pos.y}" x2="20" y2="${pos.y}"/>`;
    }
    for (const p of def.outputs) {
      const pos = pinPosition(type, p);
      s += `<line class="stub stub-out" x1="${def.w - 20}" y1="${pos.y}" x2="${def.w}" y2="${pos.y}"/>`;
    }
    return s;
  }

  /** 本体（ピンを除く）のマークアップ。ラベル文字はここには含めない */
  function bodyMarkup(type) {
    return stubs(type) + BODY[type];
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function labelText(node) {
    const def = TYPES[node.type];
    if (def.labeled) return node.label || def.short;
    return def.short;
  }

  /** 配線の形。style: curve | straight | step */
  function wirePath(style, x1, y1, x2, y2) {
    const f = (v) => Math.round(v * 10) / 10;
    if (style === 'straight') return `M${f(x1)},${f(y1)}L${f(x2)},${f(y2)}`;
    if (style === 'step') {
      const mx = x2 > x1 + 20 ? (x1 + x2) / 2 : x1 + 12;
      if (x2 > x1 + 20) return `M${f(x1)},${f(y1)}H${f(mx)}V${f(y2)}H${f(x2)}`;
      const my = (y1 + y2) / 2;
      return `M${f(x1)},${f(y1)}H${f(mx)}V${f(my)}H${f(x2 - 12)}V${f(y2)}H${f(x2)}`;
    }
    const dx = Math.max(Math.abs(x2 - x1) * 0.5, 24);
    return `M${f(x1)},${f(y1)}C${f(x1 + dx)},${f(y1)} ${f(x2 - dx)},${f(y2)} ${f(x2)},${f(y2)}`;
  }

  /** ツールバー用の小さなアイコン SVG */
  function iconSVG(type) {
    const d = TYPES[type];
    const label = d.labeled || !d.short ? '' : `<text class="label" x="${d.labelX}" y="${d.labelY}">${escapeXml(d.short)}</text>`;
    const pins = [...d.inputs, ...d.outputs].map((p) => {
      const pos = pinPosition(type, p);
      return `<circle class="pin pin-${pos.dir}" cx="${pos.x}" cy="${pos.y}" r="3"/>`;
    }).join('');
    const pad = 4;
    return `<svg class="icon" viewBox="${-pad} ${-pad} ${d.w + pad * 2} ${d.h + pad * 2}" aria-hidden="true">`
      + `<g class="node node-${type}">${bodyMarkup(type)}${label}${pins}</g></svg>`;
  }

  /** アセット（インデックス形式）のプレビュー SVG 文字列 */
  function previewSVG(asset, wireStyle) {
    const nodes = asset.nodes || [];
    if (!nodes.length) return '<svg viewBox="0 0 10 10"></svg>';
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const d = TYPES[n.type];
      if (!d) continue;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + d.w); maxY = Math.max(maxY, n.y + d.h);
    }
    const pad = 12;
    let wires = '';
    for (const c of asset.connections || []) {
      const a = nodes[c.from], b = nodes[c.to];
      if (!a || !b || !TYPES[a.type] || !TYPES[b.type]) continue;
      const pa = pinPosition(a.type, c.fromPin) || pinPosition(a.type, TYPES[a.type].outputs[0]);
      const pb = pinPosition(b.type, c.toPin) || pinPosition(b.type, TYPES[b.type].inputs[0]);
      if (!pa || !pb) continue;
      wires += `<path class="wire-line" d="${wirePath(wireStyle, a.x + pa.x, a.y + pa.y, b.x + pb.x, b.y + pb.y)}"/>`;
    }
    let body = '';
    for (const n of nodes) {
      const d = TYPES[n.type];
      if (!d) continue;
      const text = labelText(n);
      const label = text ? `<text class="label" x="${d.labelX}" y="${d.labelY}">${escapeXml(text)}</text>` : '';
      body += `<g class="node node-${n.type}${n.on ? ' on' : ''}" transform="translate(${n.x},${n.y})">${bodyMarkup(n.type)}${label}</g>`;
    }
    const vb = [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2].join(' ');
    return `<svg class="preview" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${wires}${body}</svg>`;
  }

  LS.shapes = { bodyMarkup, labelText, wirePath, iconSVG, previewSVG, escapeXml };
})(window);
