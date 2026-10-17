// editor.js — キャンバス（SVG）の描画とマウス・キーボード操作
(function (root) {
  'use strict';
  const LS = root.LogicSim;
  const { TYPES, pinPosition, shapes, ui, DND_TYPE } = LS;

  const NS = 'http://www.w3.org/2000/svg';
  const GRID = 10;
  const DRAG_PX = 4;        // これ以上動いたらクリックではなくドラッグ
  const SNAP_PX = 18;       // 配線ドラッグ時、この距離以内のピンに吸着
  const DBL_MS = 350;
  const MIN_SCALE = 0.2, MAX_SCALE = 4;

  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  const snapTo = (v) => Math.round(v / GRID) * GRID;
  const sameRef = (a, b) => a && b && a.node === b.node && a.pin === b.pin;

  class Editor {
    constructor({ svg, circuit, history, dropZone, onRender, onChange, onSaveAsset, onDropData }) {
      this.svg = svg;
      this.circuit = circuit;
      this.history = history;
      this.dropZone = dropZone;
      this.onRender = onRender || (() => {});
      this.onChange = onChange || (() => {});
      this.onSaveAsset = onSaveAsset || (() => {});
      this.onDropData = onDropData || (() => {});

      this.view = { x: 0, y: 0, scale: 1 };
      this.selection = new Set();
      this.selectedWire = null;
      this.nodeEls = new Map();
      this.wireEls = new Map();
      this.snap = true;
      this.wireStyle = 'curve';

      this.mode = null;      // ドラッグ中の操作
      this.pending = null;   // クリック→クリックで配線するときの始点ピン
      this.target = null;    // 配線ドラッグ中に吸着しているピン
      this.clipboard = null;
      this.pasteCount = 0;
      this.pointerWorld = null;
      this.spaceDown = false;
      this.lastDown = { t: 0 };
      this.menu = null;
      this._raf = 0;

      this._build();
      this._bindPointer();
      this._bindKeys();
      this._bindDrop();
    }

    // =====================================================================
    // 描画
    // =====================================================================

    _build() {
      this.svg.innerHTML = `
        <defs>
          <pattern id="gridMinor" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse">
            <path class="grid-minor" d="M${GRID},0H0V${GRID}"/></pattern>
          <pattern id="gridMajor" width="${GRID * 5}" height="${GRID * 5}" patternUnits="userSpaceOnUse">
            <path class="grid-major" d="M${GRID * 5},0H0V${GRID * 5}"/></pattern>
          <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <rect class="grid grid-minor-fill" fill="url(#gridMinor)" width="100%" height="100%"/>
        <rect class="grid" fill="url(#gridMajor)" width="100%" height="100%"/>
        <g class="viewport"><g class="wires"></g><g class="nodes"></g><path class="wire-preview" d=""/></g>
        <rect class="marquee" display="none"/>`;
      this.viewport = this.svg.querySelector('.viewport');
      this.wireLayer = this.svg.querySelector('.wires');
      this.nodeLayer = this.svg.querySelector('.nodes');
      this.preview = this.svg.querySelector('.wire-preview');
      this.marquee = this.svg.querySelector('.marquee');
      this.patterns = [...this.svg.querySelectorAll('pattern')];
      this.minorGrid = this.svg.querySelector('.grid-minor-fill');
      this._applyView();
    }

    requestRender() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
    }

    /** 回路モデルと SVG を同期する（要素は使い回し、差分だけ更新） */
    render() {
      const c = this.circuit;
      for (const [id, r] of this.nodeEls) {
        if (!c.nodes.has(id)) { r.g.remove(); this.nodeEls.delete(id); }
      }
      for (const n of c.nodes.values()) {
        let r = this.nodeEls.get(n.id);
        if (!r) { r = this._createNodeEl(n); this.nodeEls.set(n.id, r); }
        this._updateNodeEl(n, r);
      }
      for (const [id, r] of this.wireEls) {
        if (!c.wires.has(id)) { r.g.remove(); this.wireEls.delete(id); }
      }
      for (const w of c.wires.values()) {
        let r = this.wireEls.get(w.id);
        if (!r) { r = this._createWireEl(w); this.wireEls.set(w.id, r); }
        this._updateWireEl(w, r);
      }
      if (this.selectedWire && !c.wires.has(this.selectedWire)) this.selectedWire = null;
      this._updatePreview();
      this.onRender(this);
    }

    _createNodeEl(n) {
      const def = TYPES[n.type];
      const g = svgEl('g', { class: `node node-${n.type}`, 'data-id': n.id });
      g.innerHTML = `<rect class="hit" x="-2" y="-2" width="${def.w + 4}" height="${def.h + 4}" rx="6"/>`
        + `<rect class="sel" x="-5" y="-5" width="${def.w + 10}" height="${def.h + 10}" rx="8"/>`
        + shapes.bodyMarkup(n.type);
      const label = def.short || def.labeled ? svgEl('text', { class: 'label', x: def.labelX, y: def.labelY }, g) : null;
      const pins = new Map();
      const hitR = n.type === 'normal' ? 5 : 9;
      for (const p of [...def.inputs, ...def.outputs]) {
        const pos = pinPosition(n.type, p);
        const el = svgEl('circle', { class: `pin pin-${pos.dir}`, cx: pos.x, cy: pos.y, r: n.type === 'normal' ? 3 : 4 }, g);
        svgEl('circle', { class: 'pin-hit', cx: pos.x, cy: pos.y, r: hitR, 'data-pin': p }, g);
        pins.set(p, { el, dir: pos.dir });
      }
      this.nodeLayer.appendChild(g);
      return { g, label, pins, cache: {} };
    }

    _updateNodeEl(n, r) {
      const c = this.circuit;
      const tf = `translate(${n.x},${n.y})`;
      if (r.cache.tf !== tf) { r.g.setAttribute('transform', tf); r.cache.tf = tf; }
      const def = TYPES[n.type];
      const on = def.source ? n.on === true
        : n.type === 'negative' ? c.inputValue({ node: n.id, pin: 'IN' })
          : c.outputValue(n.id);
      r.g.classList.toggle('on', on);
      r.g.classList.toggle('selected', this.selection.has(n.id));
      if (r.label) {
        const t = shapes.labelText(n);
        if (r.cache.label !== t) { r.label.textContent = t; r.cache.label = t; }
      }
      for (const [pin, p] of r.pins) {
        const ref = { node: n.id, pin };
        const high = p.dir === 'in' ? c.inputValue(ref) : c.outputValue(n.id);
        p.el.classList.toggle('high', high);
        p.el.classList.toggle('open', p.dir === 'in' && !c.wireInto(ref));
        p.el.classList.toggle('target', sameRef(this.target, ref) || sameRef(this.pending, ref)
          || (this.mode && this.mode.type === 'wire' && this.mode.moved && sameRef(this.mode.start, ref)));
      }
    }

    _createWireEl(w) {
      const g = svgEl('g', { class: 'wire', 'data-id': w.id });
      const hit = svgEl('path', { class: 'wire-hit' }, g);
      const line = svgEl('path', { class: 'wire-line' }, g);
      this.wireLayer.appendChild(g);
      return { g, hit, line, cache: {} };
    }

    _updateWireEl(w, r) {
      const a = this.pinWorld(w.from), b = this.pinWorld(w.to);
      const d = shapes.wirePath(this.wireStyle, a.x, a.y, b.x, b.y);
      if (r.cache.d !== d) { r.hit.setAttribute('d', d); r.line.setAttribute('d', d); r.cache.d = d; }
      r.g.classList.toggle('high', this.circuit.outputValue(w.from.node));
      r.g.classList.toggle('selected', this.selectedWire === w.id);
    }

    /** 配線中のプレビュー線 */
    _updatePreview() {
      const start = this.mode && this.mode.type === 'wire' && this.mode.moved ? this.mode.start : this.pending;
      if (!start || !this.pointerWorld || !this.circuit.nodes.has(start.node)) {
        this.preview.setAttribute('d', '');
        return;
      }
      const s = this.pinWorld(start);
      const e = this.target ? this.pinWorld(this.target) : this.pointerWorld;
      const isOut = this.circuit.pinDir(start) === 'out';
      const d = isOut ? shapes.wirePath(this.wireStyle, s.x, s.y, e.x, e.y)
        : shapes.wirePath(this.wireStyle, e.x, e.y, s.x, s.y);
      this.preview.setAttribute('d', d);
      this.preview.classList.toggle('ok', !!this.target);
    }

    pinWorld(ref) {
      const n = this.circuit.nodes.get(ref.node);
      const p = pinPosition(n.type, ref.pin);
      return { x: n.x + p.x, y: n.y + p.y };
    }

    // =====================================================================
    // 表示（パン・ズーム）
    // =====================================================================

    _applyView() {
      const { x, y, scale } = this.view;
      this.viewport.setAttribute('transform', `translate(${x},${y}) scale(${scale})`);
      for (const p of this.patterns) p.setAttribute('patternTransform', `translate(${x},${y}) scale(${scale})`);
      this.minorGrid.style.display = scale < 0.5 ? 'none' : '';
      this.onRender(this);
    }

    setView(v) {
      this.view = { x: v.x, y: v.y, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale)) };
      this._applyView();
    }

    toWorld(clientX, clientY) {
      const r = this.svg.getBoundingClientRect();
      return { x: (clientX - r.left - this.view.x) / this.view.scale, y: (clientY - r.top - this.view.y) / this.view.scale };
    }

    viewCenterWorld() {
      const r = this.svg.getBoundingClientRect();
      return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    }

    zoomAt(clientX, clientY, factor) {
      const r = this.svg.getBoundingClientRect();
      const sx = clientX - r.left, sy = clientY - r.top;
      const old = this.view.scale;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * factor));
      this.setView({ x: sx - ((sx - this.view.x) / old) * scale, y: sy - ((sy - this.view.y) / old) * scale, scale });
    }

    zoomBy(factor) {
      const r = this.svg.getBoundingClientRect();
      this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
    }

    resetZoom() { this.zoomBy(1 / this.view.scale); }

    fitView() {
      const b = this.circuit.bounds();
      const r = this.svg.getBoundingClientRect();
      if (!b) { this.setView({ x: r.width / 2, y: r.height / 2, scale: 1 }); return; }
      // 左のアセットパネルに隠れない範囲に収める
      let left = 0;
      if (this.dropZone && !this.dropZone.classList.contains('collapsed')) {
        const p = this.dropZone.getBoundingClientRect();
        if (p.width && p.right - r.left < r.width * 0.5) left = p.right - r.left;
      }
      const pad = 50, bottom = 30;
      const aw = r.width - left - pad * 2, ah = r.height - bottom - pad * 2;
      const scale = Math.min(2, Math.max(MIN_SCALE, Math.min(aw / Math.max(b.w, 1), ah / Math.max(b.h, 1))));
      this.setView({
        x: left + (r.width - left) / 2 - (b.x + b.w / 2) * scale,
        y: (r.height - bottom) / 2 - (b.y + b.h / 2) * scale,
        scale,
      });
    }

    // =====================================================================
    // 編集操作
    // =====================================================================

    /** 回路を再計算して描画 */
    refresh() {
      this.circuit.simulate();
      this.render();
    }

    /** 編集を履歴に記録 */
    commit() {
      this.history.push(this.circuit.toJSON());
      this.onChange('edit');
    }

    select(ids) {
      this.selection = new Set(ids);
      this.selectedWire = null;
      this.requestRender();
    }

    clearSelection() {
      this.selection.clear();
      this.selectedWire = null;
      this.requestRender();
    }

    selectAll() { this.select(this.circuit.nodes.keys()); }

    _autoLabel(type) {
      const used = new Set([...this.circuit.nodes.values()].filter((n) => n.type === type).map((n) => n.label));
      if (type === 'positive') {
        for (let i = 0; i < 26; i++) { const l = String.fromCharCode(65 + i); if (!used.has(l)) return l; }
      }
      const prefix = type === 'positive' ? 'IN' : 'Y';
      for (let i = 1; ; i++) if (!used.has(prefix + i)) return prefix + i;
    }

    /** 部品を (wx, wy) が中心になるように追加 */
    addNodeAt(type, wx, wy) {
      const def = TYPES[type];
      let x = wx - def.w / 2, y = wy - def.h / 2;
      if (this.snap) { x = snapTo(x); y = snapTo(y); }
      // 同じ場所に重ねて置かないよう少しずらす
      const occupied = (px, py) => [...this.circuit.nodes.values()].some((n) => Math.abs(n.x - px) < 1 && Math.abs(n.y - py) < 1);
      for (let i = 0; i < 50 && occupied(x, y); i++) { x += 20; y += 20; }
      const spec = { type, x, y };
      if (def.labeled) spec.label = this._autoLabel(type);
      const n = this.circuit.addNode(spec);
      this.select([n.id]);
      this.refresh();
      this.commit();
      return n;
    }

    /** アセット等を配置。centered=true なら (wx, wy) が中心、false なら左上 */
    placeAsset(asset, wx, wy, centered = true) {
      const tmp = new LS.Circuit();
      tmp.insert(asset, 0, 0);
      const b = tmp.bounds();
      if (!b) return [];
      let x = centered ? wx - b.w / 2 : wx, y = centered ? wy - b.h / 2 : wy;
      if (this.snap) { x = snapTo(x); y = snapTo(y); }
      const ids = this.circuit.insert(tmp.toJSON(), x, y);
      this.select(ids);
      this.refresh();
      this.commit();
      return ids;
    }

    deleteSelection() {
      if (!this.selection.size && !this.selectedWire) return;
      for (const id of this.selection) this.circuit.removeNode(id);
      if (this.selectedWire) this.circuit.removeWire(this.selectedWire);
      this.selection.clear();
      this.selectedWire = null;
      this.refresh();
      this.commit();
    }

    deleteNodes(ids) {
      for (const id of ids) { this.circuit.removeNode(id); this.selection.delete(id); }
      this.refresh();
      this.commit();
    }

    deleteWire(id) {
      this.circuit.removeWire(id);
      this.refresh();
      this.commit();
    }

    copy() {
      if (!this.selection.size) return false;
      this.clipboard = this.circuit.extract(this.selection);
      this.pasteCount = 0;
      return true;
    }

    cut() {
      if (this.copy()) this.deleteSelection();
    }

    paste() {
      if (!this.clipboard) return;
      this.pasteCount++;
      if (this.pointerWorld) {
        this.placeAsset(this.clipboard, this.pointerWorld.x, this.pointerWorld.y, true);
      } else {
        const c = this.viewCenterWorld();
        this.placeAsset(this.clipboard, c.x + this.pasteCount * 20, c.y + this.pasteCount * 20, true);
      }
    }

    duplicate(ids = this.selection) {
      if (!ids.size) return;
      const b = this.circuit.bounds(ids);
      this.placeAsset(this.circuit.extract(ids), b.x + 30, b.y + 30, false);
    }

    /** 配線の途中に中継点を挿入 */
    insertJunction(wireId, wx, wy) {
      const w = this.circuit.wires.get(wireId);
      if (!w) return;
      let x = wx - 10, y = wy - 10;
      if (this.snap) { x = snapTo(x); y = snapTo(y); }
      const j = this.circuit.addNode({ type: 'normal', x, y });
      const from = { ...w.from }, to = { ...w.to };
      this.circuit.removeWire(wireId);
      this.circuit.connect(from, { node: j.id, pin: 'IN' });
      this.circuit.connect({ node: j.id, pin: 'OUT' }, to);
      this.select([j.id]);
      this.refresh();
      this.commit();
    }

    nudge(dx, dy) {
      if (!this.selection.size) return;
      for (const id of this.selection) {
        const n = this.circuit.nodes.get(id);
        this.circuit.moveNode(id, n.x + dx, n.y + dy);
      }
      this.render();
      this.commit();
    }

    toggleSwitch(id) {
      const n = this.circuit.nodes.get(id);
      if (!n || n.type !== 'positive') return;
      n.on = !n.on;
      this.refresh();
      this.onChange('state');
    }

    async rename(id) {
      const n = this.circuit.nodes.get(id);
      if (!n) return;
      if (n.type === 'clock') {
        const v = await ui.prompt('クロックの周期（ミリ秒）', String(n.period), {
          type: 'number', hint: '100〜60000。1周期のうち半分が ON になります。',
        });
        if (v == null) return;
        n.period = LS.clampPeriod(v);
      } else if (TYPES[n.type].labeled) {
        const v = await ui.prompt('ラベル', n.label || '', { hint: `最大${LS.LABEL_MAX}文字。真理値表の見出しにも使われます。` });
        if (v == null) return;
        n.label = v.trim().slice(0, LS.LABEL_MAX);
      } else {
        return;
      }
      this.render();
      this.commit();
    }

    undo() { const d = this.history.undo(); if (d) this._restore(d); }
    redo() { const d = this.history.redo(); if (d) this._restore(d); }

    /** 履歴から復元。スイッチの ON/OFF と回路の内部状態は今のものを引き継ぐ */
    _restore(data) {
      const ons = new Map([...this.circuit.nodes.values()].map((n) => [n.id, n.on]));
      const prevOut = new Map(this.circuit.out);
      this.circuit.load(data);
      for (const n of this.circuit.nodes.values()) {
        if (ons.has(n.id) && ons.get(n.id) !== undefined) n.on = ons.get(n.id);
        if (prevOut.has(n.id)) this.circuit.out.set(n.id, prevOut.get(n.id));
      }
      this.selection = new Set([...this.selection].filter((id) => this.circuit.nodes.has(id)));
      this.cancelInteraction();
      this.refresh();
      this.onChange('edit');
    }

    /** 回路データを丸ごと読み込む。undoable=false なら履歴もリセット（起動時の復元用） */
    loadData(data, { undoable = false } = {}) {
      this.circuit.load(data);
      if (undoable) this.history.push(this.circuit.toJSON());
      else this.history.reset(this.circuit.toJSON());
      this.selection.clear();
      this.selectedWire = null;
      this.cancelInteraction();
      this.refresh();
      this.onChange('load');
    }

    clearAll() {
      this.circuit.clear();
      this.selection.clear();
      this.selectedWire = null;
      this.cancelInteraction();
      this.refresh();
      this.commit();
    }

    setWireStyle(style) { this.wireStyle = style; this.render(); }

    cancelInteraction() {
      this.pending = null;
      this.target = null;
      if (this.mode && this.mode.type === 'move') this._revertMove();
      this.mode = null;
      this.marquee.setAttribute('display', 'none');
      this.dropZone && this.dropZone.classList.remove('drop-target');
      this.svg.classList.remove('panning');
      this.closeMenu();
      this.requestRender();
    }

    hint() {
      if (this.pending) return '接続先のピンをクリック（Esc でキャンセル）';
      if (!this.mode) return '';
      switch (this.mode.type) {
        case 'wire': return this.mode.moved ? 'ピンの上で離すと接続（何もない所で離すとキャンセル）' : '';
        case 'move': return this.mode.moved ? (this.mode.overDrop ? '離すとアセットとして登録' : '') : '';
        case 'marquee': return '範囲内の部品を選択';
        default: return '';
      }
    }

    // =====================================================================
    // マウス操作
    // =====================================================================

    _hitTest(target) {
      const pinEl = target.closest('[data-pin]');
      const nodeEl = target.closest('.node');
      const wireEl = target.closest('.wire');
      if (pinEl && nodeEl) return { kind: 'pin', ref: { node: nodeEl.dataset.id, pin: pinEl.dataset.pin }, id: nodeEl.dataset.id };
      if (nodeEl) return { kind: 'node', id: nodeEl.dataset.id };
      if (wireEl) return { kind: 'wire', id: wireEl.dataset.id };
      return { kind: 'empty' };
    }

    /** 配線ドラッグ中：カーソル近くの接続可能なピンを探す */
    _findTarget(start, world) {
      const startDir = this.circuit.pinDir(start);
      const want = startDir === 'out' ? 'in' : 'out';
      const maxD = SNAP_PX / this.view.scale;
      let best = null, bestD = maxD;
      for (const n of this.circuit.nodes.values()) {
        const def = TYPES[n.type];
        if (world.x < n.x - maxD || world.x > n.x + def.w + maxD || world.y < n.y - maxD || world.y > n.y + def.h + maxD) continue;
        for (const pin of want === 'in' ? def.inputs : def.outputs) {
          const p = pinPosition(n.type, pin);
          const d = Math.hypot(n.x + p.x - world.x, n.y + p.y - world.y);
          if (d < bestD) { bestD = d; best = { node: n.id, pin }; }
        }
      }
      return best;
    }

    _connect(a, b) {
      if (sameRef(a, b)) return false;
      const w = this.circuit.connect(a, b);
      if (!w) {
        ui.toast('出力ピン（右側）と入力ピン（左側）をつないでください', 'warn');
        return false;
      }
      this.refresh();
      this.commit();
      return true;
    }

    _bindPointer() {
      const s = this.svg;
      s.addEventListener('pointerdown', (e) => this._onDown(e));
      s.addEventListener('pointermove', (e) => this._onMove(e));
      s.addEventListener('pointerup', (e) => this._onUp(e));
      s.addEventListener('pointercancel', () => this.cancelInteraction());
      s.addEventListener('pointerleave', () => {
        if (!this.mode) { this.pointerWorld = null; this.requestRender(); }
      });
      s.addEventListener('contextmenu', (e) => this._onContextMenu(e));
      s.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.closeMenu();
        // トラックパッド（ピンチ = ctrl+wheel）も同じ扱い
        const k = e.deltaMode === 1 ? 0.05 : 0.0015;
        this.zoomAt(e.clientX, e.clientY, Math.exp(Math.max(-0.5, Math.min(0.5, -e.deltaY * k))));
      }, { passive: false });
    }

    _onDown(e) {
      this.closeMenu();
      if (ui.isOpen()) return;
      const world = this.toWorld(e.clientX, e.clientY);
      this.pointerWorld = world;
      const hit = this._hitTest(e.target);
      const client = { x: e.clientX, y: e.clientY };

      if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
        e.preventDefault();
        this._startMode(e, { type: 'pan', client, last: client, moved: false, clickClears: false });
        return;
      }
      if (e.button !== 0) return;

      // ダブルクリック（ポインタキャプチャを使うので自前で判定）
      const now = performance.now();
      const ld = this.lastDown;
      const hitKey = hit.kind + ':' + (hit.id || '') + ':' + (hit.ref ? hit.ref.pin : '');
      if (now - ld.t < DBL_MS && Math.hypot(client.x - ld.x, client.y - ld.y) < 6 && ld.key === hitKey) {
        this.lastDown = { t: 0 };
        this._onDoubleClick(hit, world);
        return;
      }
      this.lastDown = { t: now, x: client.x, y: client.y, key: hitKey };

      // クリック→クリックで配線中
      if (this.pending) {
        const start = this.pending;
        this.pending = null;
        if (hit.kind === 'pin') {
          if (!sameRef(start, hit.ref)) this._connect(start, hit.ref);
          this.requestRender();
          return;
        }
        this.requestRender();
      }

      const additive = e.ctrlKey || e.metaKey || e.shiftKey;

      if (hit.kind === 'pin') {
        // 接続済みの入力ピンからドラッグすると、その配線を付け替えられる
        const existing = this.circuit.pinDir(hit.ref) === 'in' ? this.circuit.wireInto(hit.ref) : null;
        this._startMode(e, { type: 'wire', start: hit.ref, client, moved: false, detach: existing ? existing.id : null });
        return;
      }

      if (hit.kind === 'node') {
        const wasSelected = this.selection.has(hit.id);
        if (!wasSelected) {
          if (!additive) this.selection.clear();
          this.selection.add(hit.id);
        }
        this.selectedWire = null;
        const orig = new Map();
        for (const id of this.selection) {
          const n = this.circuit.nodes.get(id);
          orig.set(id, { x: n.x, y: n.y });
        }
        this._startMode(e, { type: 'move', id: hit.id, client, moved: false, additive, wasSelected, orig, overDrop: false });
        this.requestRender();
        return;
      }

      if (hit.kind === 'wire') {
        if (!additive) this.selection.clear();
        this.selectedWire = hit.id;
        this.requestRender();
        return;
      }

      // 何もない所
      if (additive) {
        const r = this.svg.getBoundingClientRect();
        this._startMode(e, { type: 'marquee', client, origin: { x: client.x - r.left, y: client.y - r.top }, base: new Set(this.selection) });
      } else {
        this._startMode(e, { type: 'pan', client, last: client, moved: false, clickClears: true });
      }
    }

    _startMode(e, mode) {
      this.mode = mode;
      try { this.svg.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      if (mode.type === 'pan') this.svg.classList.add('panning');
    }

    _onMove(e) {
      const world = this.toWorld(e.clientX, e.clientY);
      this.pointerWorld = world;
      const m = this.mode;
      if (!m) {
        if (this.pending) {
          this.target = this._findTarget(this.pending, world);
          this.requestRender();
        }
        return;
      }
      const dist = Math.hypot(e.clientX - m.client.x, e.clientY - m.client.y);

      switch (m.type) {
        case 'pan': {
          if (dist > DRAG_PX) m.moved = true;
          this.view.x += e.clientX - m.last.x;
          this.view.y += e.clientY - m.last.y;
          m.last = { x: e.clientX, y: e.clientY };
          this._applyView();
          break;
        }
        case 'move': {
          if (!m.moved && dist < DRAG_PX) return;
          m.moved = true;
          let dx = (e.clientX - m.client.x) / this.view.scale;
          let dy = (e.clientY - m.client.y) / this.view.scale;
          if (this.snap) {
            const o = m.orig.get(m.id);
            dx = snapTo(o.x + dx) - o.x;
            dy = snapTo(o.y + dy) - o.y;
          }
          for (const [id, o] of m.orig) this.circuit.moveNode(id, o.x + dx, o.y + dy);
          m.overDrop = this._overDropZone(e.clientX, e.clientY);
          this.dropZone && this.dropZone.classList.toggle('drop-target', m.overDrop);
          this.requestRender();
          break;
        }
        case 'wire': {
          if (!m.moved && dist < DRAG_PX) return;
          if (!m.moved) {
            m.moved = true;
            if (m.detach) {
              const w = this.circuit.wires.get(m.detach);
              m.start = { ...w.from };
              this.circuit.removeWire(m.detach);
              this.circuit.simulate();
            }
          }
          this.target = this._findTarget(m.start, world);
          this.requestRender();
          break;
        }
        case 'marquee': {
          const r = this.svg.getBoundingClientRect();
          const x2 = e.clientX - r.left, y2 = e.clientY - r.top;
          const x = Math.min(m.origin.x, x2), y = Math.min(m.origin.y, y2);
          const w = Math.abs(x2 - m.origin.x), h = Math.abs(y2 - m.origin.y);
          Object.entries({ x, y, width: w, height: h }).forEach(([k, v]) => this.marquee.setAttribute(k, v));
          this.marquee.setAttribute('display', '');
          const a = this.toWorld(r.left + x, r.top + y), b = this.toWorld(r.left + x + w, r.top + y + h);
          const sel = new Set(m.base);
          for (const n of this.circuit.nodes.values()) {
            const d = TYPES[n.type];
            if (n.x < b.x && n.x + d.w > a.x && n.y < b.y && n.y + d.h > a.y) sel.add(n.id);
          }
          this.selection = sel;
          this.requestRender();
          break;
        }
      }
    }

    _onUp(e) {
      const m = this.mode;
      if (!m) return;
      this.mode = null;
      try { this.svg.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }

      switch (m.type) {
        case 'pan':
          this.svg.classList.remove('panning');
          if (!m.moved && m.clickClears) this.clearSelection();
          if (m.moved) this.onChange('view');
          break;

        case 'move':
          if (m.moved) {
            this.dropZone && this.dropZone.classList.remove('drop-target');
            if (m.overDrop) {
              // パネルへのドロップ = アセット登録。部品は元の位置に戻す
              this._revertMove(m);
              this.render();
              this.onSaveAsset([...this.selection]);
            } else {
              this.render();
              this.commit();
            }
          } else if (m.additive && m.wasSelected) {
            this.selection.delete(m.id);
          } else if (!m.additive) {
            if (m.wasSelected && this.selection.size > 1) this.selection = new Set([m.id]);
            this.toggleSwitch(m.id);
          }
          this.requestRender();
          break;

        case 'wire':
          if (m.moved) {
            const target = this.target;
            this.target = null;
            if (target) {
              if (!this._connect(m.start, target)) this.refresh();
            } else if (m.detach) {
              this.refresh(); // 付け替え途中で離した = 配線を外す
              this.commit();
            }
          } else {
            this.pending = m.start;
          }
          this.requestRender();
          break;

        case 'marquee':
          this.marquee.setAttribute('display', 'none');
          this.requestRender();
          break;
      }
      this.onRender(this);
    }

    _revertMove(m = this.mode) {
      if (!m || !m.orig) return;
      for (const [id, o] of m.orig) this.circuit.moveNode(id, o.x, o.y);
    }

    _overDropZone(x, y) {
      if (!this.dropZone || this.dropZone.classList.contains('collapsed')) return false;
      const r = this.dropZone.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    _onDoubleClick(hit, world) {
      if (hit.kind === 'node') {
        const n = this.circuit.nodes.get(hit.id);
        // 1回目のクリックで切り替わったスイッチを元に戻してから名前変更
        if (n && n.type === 'positive') this.toggleSwitch(n.id);
        this.rename(hit.id);
      } else if (hit.kind === 'wire') {
        this.insertJunction(hit.id, world.x, world.y);
      } else if (hit.kind === 'empty') {
        this.addNodeAt('normal', world.x, world.y);
      }
    }

    // =====================================================================
    // 右クリックメニュー
    // =====================================================================

    _onContextMenu(e) {
      e.preventDefault();
      if (ui.isOpen()) return;
      this.cancelInteraction();
      const hit = this._hitTest(e.target);
      const world = this.toWorld(e.clientX, e.clientY);
      const items = [];
      if (hit.kind === 'node' || hit.kind === 'pin') {
        const id = hit.id;
        if (!this.selection.has(id)) this.select([id]);
        const ids = new Set(this.selection);
        const n = this.circuit.nodes.get(id);
        if (TYPES[n.type].labeled) items.push({ label: 'ラベルを変更', action: () => this.rename(id) });
        if (n.type === 'clock') items.push({ label: '周期を変更', action: () => this.rename(id) });
        items.push({ label: '複製', key: 'Ctrl+D', action: () => this.duplicate(ids) });
        items.push({ label: 'アセットとして登録', action: () => this.onSaveAsset([...ids]) });
        items.push({ sep: true });
        items.push({ label: ids.size > 1 ? `削除（${ids.size}個）` : '削除', key: 'Del', danger: true, action: () => this.deleteNodes(ids) });
      } else if (hit.kind === 'wire') {
        this.selectedWire = hit.id;
        items.push({ label: '中継点を挿入', action: () => this.insertJunction(hit.id, world.x, world.y) });
        items.push({ sep: true });
        items.push({ label: '配線を削除', key: 'Del', danger: true, action: () => this.deleteWire(hit.id) });
      } else {
        items.push({ label: 'ここに中継点を追加', action: () => this.addNodeAt('normal', world.x, world.y) });
        items.push({ label: '貼り付け', key: 'Ctrl+V', disabled: !this.clipboard, action: () => { this.pointerWorld = world; this.paste(); } });
        items.push({ sep: true });
        items.push({ label: '全体を表示', action: () => this.fitView() });
      }
      this.requestRender();
      this.openMenu(items, e.clientX, e.clientY);
    }

    openMenu(items, x, y) {
      this.closeMenu();
      const menu = document.createElement('div');
      menu.className = 'ctx-menu';
      menu.setAttribute('role', 'menu');
      for (const it of items) {
        if (it.sep) { menu.append(Object.assign(document.createElement('hr'))); continue; }
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.className = it.danger ? 'danger' : '';
        b.disabled = !!it.disabled;
        b.innerHTML = `<span></span><kbd></kbd>`;
        b.firstChild.textContent = it.label;
        b.lastChild.textContent = it.key || '';
        b.addEventListener('click', () => { this.closeMenu(); it.action(); });
        menu.append(b);
      }
      document.body.append(menu);
      const r = menu.getBoundingClientRect();
      menu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
      menu.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
      this.menu = menu;
      const first = menu.querySelector('button:not(:disabled)');
      if (first) first.focus({ preventScroll: true });
    }

    closeMenu() {
      if (this.menu) { this.menu.remove(); this.menu = null; }
    }

    // =====================================================================
    // キーボード
    // =====================================================================

    _bindKeys() {
      window.addEventListener('pointerdown', (e) => {
        if (this.menu && !this.menu.contains(e.target)) this.closeMenu();
      }, true);
      window.addEventListener('blur', () => { this.spaceDown = false; this.svg.classList.remove('space'); });
      window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') { this.spaceDown = false; this.svg.classList.remove('space'); }
      });
      window.addEventListener('keydown', (e) => {
        if (ui.isOpen()) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (this.menu) {
          if (e.key === 'Escape') { this.closeMenu(); e.preventDefault(); }
          return;
        }
        const mod = e.ctrlKey || e.metaKey;
        const k = e.key.toLowerCase();
        if (e.code === 'Space') {
          if (t && t.tagName === 'BUTTON') return;
          this.spaceDown = true; this.svg.classList.add('space'); e.preventDefault(); return;
        }
        if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
        if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); return; }
        if (mod && k === 'a') { e.preventDefault(); this.selectAll(); return; }
        if (mod && k === 'c') { if (this.copy()) { e.preventDefault(); ui.toast(`${this.clipboard.nodes.length}個の部品をコピーしました`); } return; }
        if (mod && k === 'x') { e.preventDefault(); this.cut(); return; }
        if (mod && k === 'v') { e.preventDefault(); this.paste(); return; }
        if (mod && k === 'd') { e.preventDefault(); this.duplicate(); return; }
        if (mod) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelection(); return; }
        if (e.key === 'Escape') {
          if (this.pending || this.mode) this.cancelInteraction();
          else this.clearSelection();
          return;
        }
        const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (arrows[e.key] && this.selection.size) {
          e.preventDefault();
          const step = e.shiftKey ? GRID * 5 : GRID;
          this.nudge(arrows[e.key][0] * step, arrows[e.key][1] * step);
        }
      });
    }

    // =====================================================================
    // ツールバー・アセットパネルからのドラッグ＆ドロップ
    // =====================================================================

    _bindDrop() {
      this.svg.addEventListener('dragover', (e) => {
        if (![...e.dataTransfer.types].includes(DND_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });
      this.svg.addEventListener('drop', (e) => {
        const raw = e.dataTransfer.getData(DND_TYPE);
        if (!raw) return;
        e.preventDefault();
        let data;
        try { data = JSON.parse(raw); } catch (_) { return; }
        this.onDropData(data, this.toWorld(e.clientX, e.clientY));
      });
    }
  }

  LS.Editor = Editor;
})(window);
