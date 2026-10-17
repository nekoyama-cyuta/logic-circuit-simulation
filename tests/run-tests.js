// 回路モデルのテスト（依存なし）:  node tests/run-tests.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TYPES } = require('../js/components.js');
const { Circuit, truthTable, sanitizeAsset, normalize } = require('../js/circuit.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  NG  ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n      ')); }
}

const IN = (node) => ({ node, pin: 'IN' });
const OUT = (node) => ({ node, pin: 'OUT' });
const A = (node) => ({ node, pin: 'A' });
const B = (node) => ({ node, pin: 'B' });

function gate2(type) {
  const c = new Circuit();
  const a = c.addNode({ type: 'positive', x: 0, y: 0 }).id;
  const b = c.addNode({ type: 'positive', x: 0, y: 60 }).id;
  const g = c.addNode({ type, x: 100, y: 30 }).id;
  const l = c.addNode({ type: 'negative', x: 200, y: 30 }).id;
  c.connect(OUT(a), A(g));
  c.connect(B(g), OUT(b)); // 逆向き指定でも繋がる
  c.connect(OUT(g), IN(l));
  return { c, a, b, g, l };
}

console.log('基本ゲート');
const expect = {
  and: [0, 0, 0, 1], or: [0, 1, 1, 1], xor: [0, 1, 1, 0],
  nand: [1, 1, 1, 0], nor: [1, 0, 0, 0], xnor: [1, 0, 0, 1],
};
for (const [type, table] of Object.entries(expect)) {
  test(type.toUpperCase() + ' の真理値', () => {
    const { c, a, b, l } = gate2(type);
    [[0, 0], [0, 1], [1, 0], [1, 1]].forEach(([x, y], i) => {
      c.nodes.get(a).on = !!x; c.nodes.get(b).on = !!y;
      assert.equal(c.simulate(), true);
      assert.equal(c.inputValue(IN(l)), !!table[i], `${x}${y}`);
    });
  });
}

test('NOT と中継点', () => {
  const c = new Circuit();
  const s = c.addNode({ type: 'positive' }).id;
  const j = c.addNode({ type: 'normal' }).id;
  const n = c.addNode({ type: 'not' }).id;
  const l = c.addNode({ type: 'negative' }).id;
  c.connect(OUT(s), IN(j)); c.connect(OUT(j), IN(n)); c.connect(OUT(n), IN(l));
  c.simulate(); assert.equal(c.inputValue(IN(l)), true);
  c.nodes.get(s).on = true; c.simulate(); assert.equal(c.inputValue(IN(l)), false);
});

console.log('配線ルール');
test('入力ピンへの配線は1本だけ（置き換え）', () => {
  const { c, a, b, g } = gate2('and');
  c.connect(OUT(b), A(g));
  assert.equal(c.wireInto(A(g)).from.node, b);
  assert.equal([...c.wires.values()].filter((w) => w.to.node === g).length, 2);
});
test('出力同士・入力同士は接続できない', () => {
  const { c, a, b, g, l } = gate2('and');
  assert.equal(c.connect(OUT(a), OUT(b)), null);
  assert.equal(c.connect(A(g), IN(l)), null);
});
test('同じ配線の重複は作られない', () => {
  const { c, a, g } = gate2('and');
  const n = c.wires.size;
  c.connect(OUT(a), A(g));
  assert.equal(c.wires.size, n);
});
test('ノード削除で配線も消える', () => {
  const { c, g } = gate2('and');
  c.removeNode(g);
  assert.equal(c.wires.size, 0);
  assert.equal(c.inputIndex.size, 0);
});

console.log('順序回路');
test('NOR SR ラッチが状態を保持する', () => {
  const c = new Circuit();
  const S = c.addNode({ type: 'positive' }).id, R = c.addNode({ type: 'positive' }).id;
  const n1 = c.addNode({ type: 'nor' }).id, n2 = c.addNode({ type: 'nor' }).id;
  c.connect(OUT(R), A(n1)); c.connect(OUT(n2), B(n1)); // Q  = n1
  c.connect(OUT(S), A(n2)); c.connect(OUT(n1), B(n2)); // Q' = n2
  assert.ok(c.simulate());
  const q = () => c.outputValue(n1);
  c.nodes.get(S).on = true; c.simulate(); assert.equal(q(), true, 'set');
  c.nodes.get(S).on = false; c.simulate(); assert.equal(q(), true, 'hold 1');
  c.nodes.get(R).on = true; c.simulate(); assert.equal(q(), false, 'reset');
  c.nodes.get(R).on = false; c.simulate(); assert.equal(q(), false, 'hold 0');
  assert.equal(c.outputValue(n2), true);
});
test('NOT の自己ループは発振として検出', () => {
  const c = new Circuit();
  const n = c.addNode({ type: 'not' }).id;
  c.connect(OUT(n), IN(n));
  assert.equal(c.simulate(), false);
  assert.equal(c.stable, false);
});

console.log('保存・読込');
test('toJSON → load で同じ回路になる', () => {
  const { c, a } = gate2('xor');
  c.nodes.get(a).on = true;
  c.nodes.get(a).label = 'A';
  const d = JSON.parse(JSON.stringify(c.toJSON()));
  const c2 = Circuit.fromJSON(d);
  assert.deepEqual(c2.toJSON(), c.toJSON());
  c2.simulate();
  assert.equal([...c2.nodes.values()].find((n) => n.type === 'negative') && c2.inputValue(IN([...c2.nodes.values()].find((n) => n.type === 'negative').id)), true);
});
test('旧形式（"id:PIN" 文字列・isOn 文字列）を読める', () => {
  const old = {
    nodes: [
      { id: 'node_1_0.5', x: 0, y: 0, type: 'positive', isOn: 'true' },
      { id: 'node_2_0.7', x: 100, y: 0, type: 'not' },
      { id: 'node_3_0.9', x: 200, y: 0, type: 'negative' },
    ],
    connections: [
      { from: 'node_1_0.5:OUT', to: 'node_2_0.7:IN' },
      { from: 'node_2_0.7:OUT', to: 'node_3_0.9:IN' },
    ],
  };
  const c = Circuit.fromJSON(old);
  assert.equal(c.wires.size, 2);
  assert.equal(c.nodes.get('node_1_0.5').on, true);
  c.simulate();
  assert.equal(c.inputValue(IN('node_3_0.9')), false);
});
test('ピン名の無い旧データは向きで補完', () => {
  const c = Circuit.fromJSON({
    nodes: [{ id: 'a', type: 'positive' }, { id: 'b', type: 'and' }],
    connections: [{ from: 'a', to: 'b' }],
  });
  assert.equal(c.wireInto(A('b')).from.node, 'a');
});
test('壊れたデータでも落ちない', () => {
  assert.equal(Circuit.fromJSON(null).nodes.size, 0);
  assert.equal(Circuit.fromJSON({ nodes: [{ type: 'unknown' }, null, { type: 'and', x: 'abc' }] }).nodes.size, 1);
  assert.deepEqual(normalize({ nodes: 'x' }), { nodes: [], wires: [] });
});

console.log('アセット');
test('extract → insert で配線ごと複製できる', () => {
  const { c, a, b, g, l } = gate2('and');
  const asset = c.extract([a, g, l]);
  assert.equal(asset.nodes.length, 3);
  assert.equal(asset.connections.length, 2);
  const ids = c.insert(asset, 500, 500);
  assert.equal(ids.length, 3);
  assert.equal(c.wires.size, 5);
  const bb = c.bounds(ids);
  assert.equal(bb.x, 500); assert.equal(bb.y, 500);
});

const starter = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets_starterAssets.json'), 'utf8'));
test('スターターアセットが全て読み込める', () => {
  for (const a of starter) {
    const s = sanitizeAsset(a);
    assert.ok(s, a.name);
    assert.equal(s.nodes.length, a.nodes.length, a.name + ' nodes');
    assert.equal(s.connections.length, a.connections.length, a.name + ' wires');
  }
});
test('スターター「全加算回路」の真理値表が正しい', () => {
  const asset = starter.find((a) => a.name === '全加算回路');
  const c = new Circuit(); c.insert(asset, 0, 0);
  const t = truthTable(c);
  assert.equal(t.inputs.length, 3); assert.equal(t.outputs.length, 2);
  // 出力ランプは上から 和, 桁上げ の順に並んでいる
  for (const r of t.rows) {
    const sum = r.inputs.filter(Boolean).length;
    assert.deepEqual(r.outputs, [sum % 2 === 1, sum >= 2], r.inputs.map(Number).join(''));
    assert.ok(r.stable);
  }
});
test('スターター「半加算回路」を入力付きで検証', () => {
  const asset = starter.find((a) => a.name === '半加算回路');
  const c = new Circuit();
  const ids = c.insert(asset, 0, 0);
  // 入力となる中継点（入力配線なし）にスイッチを、ゲート出力にランプを付ける
  const relays = ids.filter((id) => c.nodes.get(id).type === 'normal');
  const sw = relays.map((r) => { const s = c.addNode({ type: 'positive' }).id; c.connect(OUT(s), IN(r)); return s; });
  const xor = ids.find((id) => c.nodes.get(id).type === 'xor');
  const and = ids.find((id) => c.nodes.get(id).type === 'and');
  for (let m = 0; m < 4; m++) {
    c.nodes.get(sw[0]).on = !!(m & 1); c.nodes.get(sw[1]).on = !!(m & 2);
    c.simulate();
    const n = (m & 1) + ((m & 2) >> 1);
    assert.equal(c.outputValue(xor), n === 1);
    assert.equal(c.outputValue(and), n === 2);
  }
});
test('スターター「5ビット加算」系の大きな回路も収束する', () => {
  for (const a of starter.filter((x) => x.nodes.length > 50)) {
    const c = new Circuit(); c.insert(a, 0, 0);
    for (const n of c.nodes.values()) if (n.type === 'positive') n.on = Math.random() < 0.5;
    assert.ok(c.simulate(), a.name);
  }
});

console.log('真理値表');
test('入力が多すぎる場合は計算しない', () => {
  const c = new Circuit();
  for (let i = 0; i < 11; i++) c.addNode({ type: 'positive' });
  c.addNode({ type: 'negative' });
  assert.equal(truthTable(c).tooMany, true);
});
test('元の回路の状態を変えない', () => {
  const { c, a } = gate2('or');
  c.nodes.get(a).on = true; c.simulate();
  truthTable(c);
  assert.equal(c.nodes.get(a).on, true);
});

test('全部品タイプのピン定義が一貫している', () => {
  for (const [t, d] of Object.entries(TYPES)) {
    assert.ok(d.outputs.length <= 1, t);
    if (!d.source && d.outputs.length) assert.equal(typeof d.fn, 'function', t);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
