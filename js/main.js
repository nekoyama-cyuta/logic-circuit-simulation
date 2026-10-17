// main.js — 画面の組み立て（ツールバー・アセットパネル・自動保存・クロック・真理値表）
(function (root) {
  'use strict';
  const LS = root.LogicSim;
  const { TYPES, PALETTE, Circuit, History, Editor, AssetLibrary, AssetPanel, DND_TYPE, shapes, ui, truthTable, FORMAT } = LS;
  const { h } = ui;

  const KEY_CIRCUIT = 'logicsim.circuit.v2';
  const KEY_VIEW = 'logicsim.view.v2';
  const KEY_SETTINGS = 'logicsim.settings.v2';

  const $ = (sel) => document.querySelector(sel);

  function readJSON(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  // ---------------------------------------------------------------------
  // 初期化
  // ---------------------------------------------------------------------

  const settings = Object.assign({ snap: true, wireStyle: 'curve', panelCollapsed: false, clockRunning: true }, readJSON(KEY_SETTINGS) || {});
  const saveSettings = () => writeJSON(KEY_SETTINGS, settings);

  const circuit = new Circuit();
  const history = new History();
  const library = new AssetLibrary(root.LogicSimStarterAssets || []);
  const assetPanelEl = $('#assetPanel');

  let saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 400);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    if (!writeJSON(KEY_CIRCUIT, circuit.toJSON())) ui.toast('自動保存に失敗しました', 'error');
    writeJSON(KEY_VIEW, editor.view);
  }

  const editor = new Editor({
    svg: $('#board'),
    circuit,
    history,
    dropZone: assetPanelEl,
    onRender: updateStatus,
    onChange: (kind) => {
      scheduleSave();
      if (kind !== 'view') updateToolbar();
    },
    onSaveAsset: saveSelectionAsAsset,
    onDropData: (data, world) => {
      if (data.kind === 'type' && TYPES[data.type]) editor.addNodeAt(data.type, world.x, world.y);
      if (data.kind === 'asset' && library.items[data.index]) editor.placeAsset(library.items[data.index], world.x, world.y, true);
    },
  });
  editor.snap = settings.snap;
  editor.wireStyle = settings.wireStyle;

  const panel = new AssetPanel({
    library,
    listEl: $('#assetList'),
    previewEl: $('#assetPreview'),
    getWireStyle: () => editor.wireStyle,
    onPlace: (asset) => {
      const c = editor.viewCenterWorld();
      editor.placeAsset(asset, c.x, c.y, true);
    },
  });

  // ---------------------------------------------------------------------
  // ツールバー
  // ---------------------------------------------------------------------

  function buildPalette() {
    const host = $('#palette');
    PALETTE.forEach((group, gi) => {
      if (gi) host.append(h('span', { class: 'palette-sep', 'aria-hidden': 'true' }));
      for (const type of group) {
        const def = TYPES[type];
        const btn = h('button', {
          type: 'button', class: 'part-btn', draggable: 'true',
          title: `${def.name}を追加（クリックで中央に / ドラッグで好きな位置に）`,
          'aria-label': `${def.name}を追加`,
        });
        btn.innerHTML = shapes.iconSVG(type);
        btn.append(h('span', { class: 'part-name' }, def.labeled || type === 'clock' || type === 'normal' ? def.name : def.short));
        btn.addEventListener('click', () => {
          const c = editor.viewCenterWorld();
          editor.addNodeAt(type, c.x, c.y);
        });
        btn.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: 'type', type }));
          e.dataTransfer.effectAllowed = 'copy';
        });
        host.append(btn);
      }
    });
  }

  const actions = {
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    delete: () => editor.deleteSelection(),
    new: async () => {
      if (circuit.nodes.size && !(await ui.confirm('キャンバスの回路をすべて消去します。よろしいですか？（元に戻すで復元できます）', { okLabel: '消去', danger: true }))) return;
      editor.clearAll();
    },
    open: () => openFile('circuit'),
    save: () => {
      if (!circuit.nodes.size) { ui.toast('保存する回路がありません', 'warn'); return; }
      downloadJSON(circuit.toJSON(), `circuit_${stamp()}.json`);
    },
    truth: showTruthTable,
    clock: () => {
      settings.clockRunning = !settings.clockRunning;
      saveSettings();
      updateToolbar();
    },
    'zoom-in': () => editor.zoomBy(1.25),
    'zoom-out': () => editor.zoomBy(1 / 1.25),
    'zoom-reset': () => editor.resetZoom(),
    fit: () => editor.fitView(),
    help: showHelp,
    'asset-add': () => saveSelectionAsAsset([...editor.selection]),
    'asset-export': () => {
      if (!library.items.length) { ui.toast('書き出すアセットがありません', 'warn'); return; }
      downloadJSON(library.toJSON(), `assets_${stamp()}.json`);
    },
    'asset-import': () => openFile('assets'),
    'asset-starter': () => {
      const n = library.restoreStarter();
      panel.render();
      ui.toast(n ? `標準アセットを${n}件追加しました` : '標準アセットはすべて登録済みです');
    },
    'panel-toggle': () => {
      settings.panelCollapsed = !settings.panelCollapsed;
      saveSettings();
      applyPanelState();
    },
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    const fn = actions[b.dataset.action];
    if (fn) fn();
  });

  $('#wireStyle').value = settings.wireStyle;
  $('#wireStyle').addEventListener('change', (e) => {
    settings.wireStyle = e.target.value;
    saveSettings();
    editor.setWireStyle(settings.wireStyle);
  });
  $('#snapToggle').checked = settings.snap;
  $('#snapToggle').addEventListener('change', (e) => {
    settings.snap = e.target.checked;
    editor.snap = settings.snap;
    saveSettings();
  });

  function updateToolbar() {
    $('[data-action="undo"]').disabled = !history.canUndo();
    $('[data-action="redo"]').disabled = !history.canRedo();
    const hasClock = [...circuit.nodes.values()].some((n) => n.type === 'clock');
    const clockBtn = $('[data-action="clock"]');
    clockBtn.hidden = !hasClock;
    clockBtn.textContent = settings.clockRunning ? '⏸ クロック停止' : '▶ クロック再開';
    clockBtn.setAttribute('aria-pressed', String(!settings.clockRunning));
  }

  // Editor のコンストラクタ内からも呼ばれるので、editor 変数ではなく引数を使う
  function updateStatus(ed) {
    $('#zoomLabel').textContent = `${Math.round(ed.view.scale * 100)}%`;
    $('#statusCounts').textContent = `部品 ${circuit.nodes.size} ・ 配線 ${circuit.wires.size}`
      + (ed.selection.size ? ` ・ 選択 ${ed.selection.size}` : '');
    const st = $('#statusSim');
    st.textContent = circuit.stable ? '● 安定' : '⚠ 発振中（値が定まらないループがあります）';
    st.className = circuit.stable ? 'ok' : 'warn';
    $('#statusHint').textContent = ed.hint();
    $('[data-action="delete"]').disabled = !ed.selection.size && !ed.selectedWire;
    $('#emptyHint').hidden = circuit.nodes.size > 0;
  }

  function applyPanelState() {
    assetPanelEl.classList.toggle('collapsed', settings.panelCollapsed);
    const b = $('[data-action="panel-toggle"]');
    b.textContent = settings.panelCollapsed ? '▸' : '▾';
    b.setAttribute('aria-expanded', String(!settings.panelCollapsed));
    panel.hidePreview();
  }

  // ---------------------------------------------------------------------
  // アセット
  // ---------------------------------------------------------------------

  async function saveSelectionAsAsset(ids) {
    if (!ids.length) {
      ui.toast('先に部品を選択してください（Ctrl+ドラッグで範囲選択）', 'warn');
      return;
    }
    const name = await ui.prompt('アセット名', '', { placeholder: `アセット ${library.items.length + 1}`, hint: `${ids.length}個の部品と、その間の配線を登録します。` });
    if (name == null) return;
    const asset = circuit.extract(ids);
    asset.name = name.trim() || `アセット ${library.items.length + 1}`;
    if (library.add(asset)) {
      panel.render();
      ui.toast(`「${asset.name}」を登録しました`);
      if (settings.panelCollapsed) actions['panel-toggle']();
    }
  }

  // ---------------------------------------------------------------------
  // ファイル
  // ---------------------------------------------------------------------

  const fileInput = $('#fileInput');
  let fileMode = 'circuit';

  function openFile(mode) {
    fileMode = mode;
    fileInput.value = '';
    fileInput.click();
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      ui.toast('JSON ファイルとして読み込めませんでした', 'error');
      return;
    }
    // アセット一覧（配列）か回路（オブジェクト）かは中身で判定する
    if (Array.isArray(data)) {
      const n = library.importItems(data);
      panel.render();
      ui.toast(n ? `アセットを${n}件読み込みました` : '読み込めるアセットがありませんでした', n ? 'info' : 'warn');
      return;
    }
    if (data && Array.isArray(data.nodes)) {
      if (fileMode === 'assets') {
        const a = LS.sanitizeAsset({ ...data, name: data.name || file.name.replace(/\.json$/i, '') });
        if (a && library.add(a)) { panel.render(); ui.toast(`「${a.name}」をアセットに追加しました`); }
        return;
      }
      if (circuit.nodes.size && !(await ui.confirm(`「${file.name}」を開きます。今の回路は置き換えられます（元に戻すで戻せます）。`, { okLabel: '開く' }))) return;
      editor.loadData(data, { undoable: true });
      editor.fitView();
      ui.toast(`「${file.name}」を開きました（部品 ${circuit.nodes.size}・配線 ${circuit.wires.size}）`);
      return;
    }
    ui.toast('回路データの形式ではありません', 'error');
  });

  // ---------------------------------------------------------------------
  // 真理値表・ヘルプ
  // ---------------------------------------------------------------------

  function showTruthTable() {
    const t = truthTable(circuit);
    let body;
    if (!t.inputs.length || !t.outputs.length) {
      body = h('p', {}, '入力スイッチと出力ランプを1つ以上配置すると、真理値表を作れます。');
    } else if (t.tooMany) {
      body = h('p', {}, `入力スイッチが ${t.inputs.length} 個あります。真理値表は10個まで対応しています。`);
    } else {
      const bit = (v) => h('td', { class: v ? 'b1' : 'b0' }, v ? '1' : '0');
      const table = h('table', { class: 'truth' },
        h('thead', {}, h('tr', {},
          t.inputs.map((n) => h('th', { class: 'in' }, n)),
          t.outputs.map((n, i) => h('th', { class: 'out' + (i === 0 ? ' first' : '') }, n)))),
        h('tbody', {}, t.rows.map((r) => h('tr', {},
          r.inputs.map(bit),
          r.outputs.map((v, i) => {
            const td = r.stable ? bit(v) : h('td', { class: 'unstable' }, '?');
            if (i === 0) td.classList.add('first');
            return td;
          })))));
      const unstable = t.rows.some((r) => !r.stable);
      body = h('div', {},
        h('p', { class: 'muted' }, '入力は上にあるスイッチから順に並べています（上下の位置で並べ替え）。各行は回路の状態をリセットして計算します。'),
        h('div', { class: 'truth-wrap' }, table),
        unstable ? h('p', { class: 'warn' }, '? は値が定まらない（発振する）組み合わせです。') : null);
    }
    ui.open({ title: '真理値表', body, wide: true });
  }

  function showHelp() {
    const rows = [
      ['部品を追加', 'ツールバーのボタンをクリック、またはキャンバスへドラッグ'],
      ['配線', 'ピンからピンへドラッグ（クリック→クリックでも可）。出力（右）→入力（左）'],
      ['配線の付け替え', '接続済みの入力ピンからドラッグ。何もない所で離すと外れます'],
      ['中継点', '何もない所 / 配線をダブルクリック'],
      ['スイッチ', 'クリックで ON / OFF。ダブルクリックでラベル変更'],
      ['移動', '部品をドラッグ。矢印キーで微調整（Shift で大きく）'],
      ['範囲選択', 'Ctrl または Shift を押しながらドラッグ'],
      ['画面の移動', '何もない所をドラッグ / 中ボタン / Space+ドラッグ'],
      ['拡大・縮小', 'マウスホイール'],
      ['メニュー', '右クリック（削除・複製・アセット登録など）'],
      ['削除', 'Delete / Backspace'],
      ['元に戻す / やり直し', 'Ctrl+Z / Ctrl+Y（Ctrl+Shift+Z）'],
      ['コピー / 貼り付け / 複製', 'Ctrl+C / Ctrl+V / Ctrl+D、全選択 Ctrl+A'],
      ['アセット登録', '選択した部品をアセットパネルへドラッグ'],
      ['アセット配置', 'パネルからキャンバスへドラッグ / ダブルクリック'],
    ];
    const body = h('div', {},
      h('table', { class: 'help' }, h('tbody', {}, rows.map(([a, b]) => h('tr', {}, h('th', {}, a), h('td', {}, b))))),
      h('p', { class: 'muted' }, '回路とアセットはブラウザに自動保存されます。別の PC へ持っていくときは「保存」でファイルに書き出してください。'));
    ui.open({ title: '操作方法', body, wide: true });
  }

  // ---------------------------------------------------------------------
  // クロック
  // ---------------------------------------------------------------------

  const clockPhase = new Map();
  setInterval(() => {
    if (!settings.clockRunning) return;
    const now = performance.now();
    let changed = false;
    for (const n of circuit.nodes.values()) {
      if (n.type !== 'clock') continue;
      const last = clockPhase.get(n.id);
      if (last == null) { clockPhase.set(n.id, now); continue; }
      if (now - last >= n.period / 2) {
        n.on = !n.on;
        clockPhase.set(n.id, now);
        changed = true;
      }
    }
    if (changed) {
      circuit.simulate();
      editor.requestRender();
    }
  }, 20);

  // ---------------------------------------------------------------------
  // 起動
  // ---------------------------------------------------------------------

  buildPalette();
  panel.render();
  applyPanelState();

  const saved = readJSON(KEY_CIRCUIT);
  if (saved && (saved.format === FORMAT || Array.isArray(saved.nodes))) {
    editor.loadData(saved);
  } else {
    history.reset(circuit.toJSON());
    editor.refresh();
  }
  const view = readJSON(KEY_VIEW);
  if (view && Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.scale)) editor.setView(view);
  else if (circuit.nodes.size) editor.fitView();
  else editor.setView({ x: 0, y: 0, scale: 1 });
  updateToolbar();
  updateStatus(editor);

  window.addEventListener('beforeunload', flushSave);
  window.addEventListener('pagehide', flushSave);

  // デバッグ・動作確認用
  root.LogicSim.app = { editor, circuit, history, library, panel, settings };
})(window);
