// circuit.js — 回路モデル・シミュレーション・保存形式（DOM 非依存）
//
// ノード: { id, type, x, y, on?, label?, period? }
// 配線  : { id, from: { node, pin }, to: { node, pin } }   from は出力ピン、to は入力ピン
// 1つの入力ピンに接続できる配線は1本だけ（新しく繋ぐと置き換わる）。出力ピンは何本でも分岐可。
(function (root) {
  'use strict';

  const C = (typeof module !== 'undefined' && module.exports) ? require('./components.js') : root.LogicSim;
  const { TYPES, pinDirection, clampPeriod, LABEL_MAX } = C;

  const FORMAT = 'logic-circuit';
  const VERSION = 2;

  const pinKey = (ref) => ref.node + '\u0001' + ref.pin;
  const round = (v) => Math.round(v * 100) / 100;
  const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

  class Circuit {
    constructor() {
      this.clear();
    }

    clear() {
      this.nodes = new Map();
      this.wires = new Map();
      this.inputIndex = new Map(); // 入力ピン → 配線ID
      this.out = new Map();        // ノードID → 出力値
      this.stable = true;
      this._order = null;
      this._counter = 0;
    }

    _newId(prefix, taken) {
      let id;
      do { id = prefix + (++this._counter).toString(36); } while (taken.has(id));
      return id;
    }

    _invalidate() { this._order = null; }

    // ---------- ノード ----------

    addNode(spec) {
      const def = TYPES[spec.type];
      if (!def) throw new Error('未知の部品タイプ: ' + spec.type);
      const wanted = spec.id != null ? String(spec.id) : null;
      const id = wanted && !this.nodes.has(wanted) ? wanted : this._newId('n', this.nodes);
      const node = { id, type: spec.type, x: round(num(spec.x)), y: round(num(spec.y)) };
      if (def.source) node.on = spec.on === true || spec.on === 'true';
      if (def.labeled) node.label = typeof spec.label === 'string' ? spec.label.slice(0, LABEL_MAX) : '';
      if (spec.type === 'clock') node.period = clampPeriod(spec.period);
      this.nodes.set(id, node);
      this._invalidate();
      return node;
    }

    removeNode(id) {
      for (const w of this.wiresOf(id)) this.removeWire(w.id);
      this.nodes.delete(id);
      this.out.delete(id);
      this._invalidate();
    }

    moveNode(id, x, y) {
      const n = this.nodes.get(id);
      if (n) { n.x = round(x); n.y = round(y); }
    }

    // ---------- 配線 ----------

    pinDir(ref) {
      const n = ref && this.nodes.get(ref.node);
      return n ? pinDirection(n.type, ref.pin) : null;
    }

    /** 2つのピンを「出力 → 入力」の向きに並べる。繋げない組み合わせなら null */
    orient(a, b) {
      const da = this.pinDir(a), db = this.pinDir(b);
      if (da === 'out' && db === 'in') return { from: a, to: b };
      if (da === 'in' && db === 'out') return { from: b, to: a };
      return null;
    }

    /** ピン同士を接続する（順不同）。入力側に既存の配線があれば置き換える。 */
    connect(a, b) {
      const ends = this.orient(a, b);
      if (!ends) return null;
      const key = pinKey(ends.to);
      const existingId = this.inputIndex.get(key);
      if (existingId) {
        const w = this.wires.get(existingId);
        if (w.from.node === ends.from.node && w.from.pin === ends.from.pin) return w;
        this.removeWire(existingId);
      }
      const wire = {
        id: this._newId('w', this.wires),
        from: { node: ends.from.node, pin: ends.from.pin },
        to: { node: ends.to.node, pin: ends.to.pin },
      };
      this.wires.set(wire.id, wire);
      this.inputIndex.set(key, wire.id);
      this._invalidate();
      return wire;
    }

    removeWire(id) {
      const w = this.wires.get(id);
      if (!w) return;
      this.wires.delete(id);
      this.inputIndex.delete(pinKey(w.to));
      this._invalidate();
    }

    wiresOf(nodeId) {
      const list = [];
      for (const w of this.wires.values()) {
        if (w.from.node === nodeId || w.to.node === nodeId) list.push(w);
      }
      return list;
    }

    wireInto(ref) {
      const id = this.inputIndex.get(pinKey(ref));
      return id ? this.wires.get(id) : null;
    }

    // ---------- シミュレーション ----------

    outputValue(nodeId) { return this.out.get(nodeId) === true; }

    inputValue(ref) {
      const w = this.wireInto(ref);
      return w ? this.out.get(w.from.node) === true : false;
    }

    evaluate(node) {
      const def = TYPES[node.type];
      if (def.source) return node.on === true;
      if (!def.fn) return false;
      return def.fn(def.inputs.map((pin) => this.inputValue({ node: node.id, pin })));
    }

    /** 入力側から順に評価できるよう並べる（トポロジカル順。ループ部分は末尾） */
    evalOrder() {
      if (this._order) return this._order;
      const indeg = new Map();
      const next = new Map();
      for (const id of this.nodes.keys()) { indeg.set(id, 0); next.set(id, []); }
      for (const w of this.wires.values()) {
        if (w.from.node === w.to.node) continue;
        indeg.set(w.to.node, indeg.get(w.to.node) + 1);
        next.get(w.from.node).push(w.to.node);
      }
      const queue = [];
      for (const [id, d] of indeg) if (d === 0) queue.push(id);
      const order = [];
      const done = new Set();
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        order.push(this.nodes.get(id));
        done.add(id);
        for (const to of next.get(id)) {
          indeg.set(to, indeg.get(to) - 1);
          if (indeg.get(to) === 0) queue.push(to);
        }
      }
      for (const [id, n] of this.nodes) if (!done.has(id)) order.push(n);
      this._order = order.filter((n) => TYPES[n.type].outputs.length > 0);
      return this._order;
    }

    /**
     * 回路が落ち着くまで評価を繰り返す。
     * 値は前回の結果から引き継ぐため、ラッチなどの記憶回路も状態を保持できる。
     * 収束しなければ（発振）stable=false。
     */
    simulate(maxPasses = 100) {
      const order = this.evalOrder();
      let stable = false;
      for (let pass = 0; pass < maxPasses; pass++) {
        let changed = false;
        for (const n of order) {
          const v = this.evaluate(n);
          if (this.out.get(n.id) !== v) { this.out.set(n.id, v); changed = true; }
        }
        if (!changed) { stable = true; break; }
      }
      this.stable = stable;
      return stable;
    }

    resetState() { this.out.clear(); }

    // ---------- 範囲・抽出 ----------

    bounds(ids) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const list = ids ? [...ids].map((id) => this.nodes.get(id)).filter(Boolean) : [...this.nodes.values()];
      for (const n of list) {
        const d = TYPES[n.type];
        minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + d.w); maxY = Math.max(maxY, n.y + d.h);
      }
      return list.length ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
    }

    /** 指定ノード群を、内部の配線ごと「アセット形式」で取り出す（座標は左上基準） */
    extract(ids) {
      const list = [...ids].map((id) => this.nodes.get(id)).filter(Boolean);
      const b = this.bounds(list.map((n) => n.id));
      const index = new Map(list.map((n, i) => [n.id, i]));
      const nodes = list.map((n) => {
        const o = { type: n.type, x: round(n.x - b.x), y: round(n.y - b.y) };
        if (n.on) o.on = true;
        if (n.label) o.label = n.label;
        if (n.period != null) o.period = n.period;
        return o;
      });
      const connections = [];
      for (const w of this.wires.values()) {
        if (index.has(w.from.node) && index.has(w.to.node)) {
          connections.push({
            from: index.get(w.from.node), fromPin: w.from.pin,
            to: index.get(w.to.node), toPin: w.to.pin,
          });
        }
      }
      return { nodes, connections };
    }

    /** アセット（または任意形式の回路データ）を (x, y) を左上にして追加し、新ノードIDを返す */
    insert(data, x, y) {
      const norm = normalize(data);
      if (!norm.nodes.length) return [];
      let minX = Infinity, minY = Infinity;
      for (const n of norm.nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); }
      const map = new Map();
      for (const n of norm.nodes) {
        const node = this.addNode({ ...n, id: null, x: n.x - minX + x, y: n.y - minY + y });
        map.set(n.ref, node.id);
      }
      this._connectNormalized(norm.wires, map);
      return [...map.values()];
    }

    _connectNormalized(wires, map) {
      for (const w of wires) {
        const from = map.get(w.from.ref), to = map.get(w.to.ref);
        if (from == null || to == null) continue;
        const fromRef = { node: from, pin: this._fixPin(from, w.from.pin, 'out') };
        const toRef = { node: to, pin: this._fixPin(to, w.to.pin, 'in') };
        if (fromRef.pin && toRef.pin) this.connect(fromRef, toRef);
      }
    }

    /** 旧データ救済: ピン名が無い/合わない場合は同じ向きの最初のピンを使う */
    _fixPin(nodeId, pin, dir) {
      const def = TYPES[this.nodes.get(nodeId).type];
      const pins = dir === 'in' ? def.inputs : def.outputs;
      return pins.includes(pin) ? pin : (pins[0] || null);
    }

    // ---------- 保存・読込 ----------

    toJSON() {
      return {
        format: FORMAT,
        version: VERSION,
        nodes: [...this.nodes.values()].map((n) => ({ ...n })),
        wires: [...this.wires.values()].map((w) => ({ from: { ...w.from }, to: { ...w.to } })),
      };
    }

    /** 新形式・旧形式（ID:ピン 形式 / インデックス形式）のどれでも読み込む */
    load(data) {
      this.clear();
      const norm = normalize(data);
      const map = new Map();
      for (const n of norm.nodes) {
        const node = this.addNode(n);
        map.set(n.ref, node.id);
      }
      this._connectNormalized(norm.wires, map);
      return this;
    }

    static fromJSON(data) { return new Circuit().load(data); }
  }

  /**
   * あらゆる保存形式を { nodes:[{ref,...}], wires:[{from:{ref,pin},to:{ref,pin}}] } に揃える。
   *  - v2:        wires: [{ from:{node,pin}, to:{node,pin} }]
   *  - 旧グラフ:  connections: [{ from:"nodeId:PIN", to:"nodeId:PIN" }]
   *  - アセット:  connections: [{ from:0, fromPin:"OUT", to:1, toPin:"A" }]
   */
  function normalize(data) {
    const out = { nodes: [], wires: [] };
    if (!data || !Array.isArray(data.nodes)) return out;

    const refs = new Set();
    data.nodes.forEach((n, i) => {
      if (!n || !TYPES[n.type]) return;
      const ref = n.id != null ? String(n.id) : '#' + i;
      if (refs.has(ref)) return;
      refs.add(ref);
      out.nodes.push({
        ref, id: n.id != null ? String(n.id) : null, type: n.type,
        x: num(n.x), y: num(n.y),
        on: n.on === true || n.isOn === true || n.isOn === 'true',
        label: typeof n.label === 'string' ? n.label : undefined,
        period: n.period,
      });
    });
    const byIndex = (i) => {
      const n = data.nodes[i];
      if (!n) return null;
      return n.id != null ? String(n.id) : '#' + i;
    };
    const parseEnd = (end, pin) => {
      if (end && typeof end === 'object') return { ref: String(end.node), pin: end.pin };
      if (typeof end === 'number') return { ref: byIndex(end), pin };
      if (typeof end === 'string') {
        const at = end.lastIndexOf(':');
        if (at > 0 && !refs.has(end)) return { ref: end.slice(0, at), pin: end.slice(at + 1) };
        return { ref: end, pin };
      }
      return null;
    };
    const list = Array.isArray(data.wires) ? data.wires : Array.isArray(data.connections) ? data.connections : [];
    for (const c of list) {
      if (!c) continue;
      const from = parseEnd(c.from, c.fromPin);
      const to = parseEnd(c.to, c.toPin);
      if (from && to && from.ref != null && to.ref != null) out.wires.push({ from, to });
    }
    return out;
  }

  /** アセットとして読める形かを確認し、整えたコピーを返す（不正なら null） */
  function sanitizeAsset(a) {
    if (!a || !Array.isArray(a.nodes)) return null;
    const c = new Circuit();
    const ids = c.insert(a, 0, 0);
    if (!ids.length) return null;
    const asset = c.extract(ids);
    asset.name = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : '無題のアセット';
    return asset;
  }

  // ---------- 真理値表 ----------

  const byPosition = (a, b) => (a.y - b.y) || (a.x - b.x);

  /**
   * 入力スイッチの全組み合わせについて出力ランプの値を求める。
   * 組み合わせ回路として計算するため、各行は内部状態をリセットしてから評価する。
   */
  function truthTable(circuit, maxInputs = 10) {
    const c = Circuit.fromJSON(circuit.toJSON());
    const inputs = [...c.nodes.values()].filter((n) => n.type === 'positive').sort(byPosition);
    const outputs = [...c.nodes.values()].filter((n) => n.type === 'negative').sort(byPosition);
    const name = (n, i, prefix) => n.label || prefix + (i + 1);
    const result = {
      inputs: inputs.map((n, i) => name(n, i, 'IN')),
      outputs: outputs.map((n, i) => name(n, i, 'OUT')),
      rows: [],
      tooMany: inputs.length > maxInputs,
    };
    if (result.tooMany || !inputs.length || !outputs.length) return result;
    const count = 1 << inputs.length;
    for (let mask = 0; mask < count; mask++) {
      const bits = inputs.map((_, i) => ((mask >> (inputs.length - 1 - i)) & 1) === 1);
      inputs.forEach((n, i) => { n.on = bits[i]; });
      c.resetState();
      const stable = c.simulate();
      result.rows.push({
        inputs: bits,
        outputs: outputs.map((n) => c.inputValue({ node: n.id, pin: 'IN' })),
        stable,
      });
    }
    return result;
  }

  const api = { Circuit, normalize, sanitizeAsset, truthTable, FORMAT, VERSION };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LogicSim = Object.assign(root.LogicSim || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
