// saveAssets.js

// ローカルストレージのキー
const ASSET_STORAGE_KEY = "assetCircuitsData";

/**
 * localStorage に現在の assetCircuits を保存する
 */
function saveAssetsToLocal() {
  try {
    localStorage.setItem(ASSET_STORAGE_KEY, JSON.stringify(assetCircuits));
    // 任意で UI に通知したければここで通知
    // alert('アセットをローカルに保存しました');
  } catch (e) {
    console.error('saveAssetsToLocal error', e);
    alert('アセットの保存に失敗しました（容量オーバーなど）。コンソールを確認して。');
  }
}

/**
 * localStorage からアセットを読み込み、現在の assetCircuits を置き換える
 * load.js と同じく「ロード」操作
 */
function loadAssetsFromLocal() {
  const raw = localStorage.getItem(ASSET_STORAGE_KEY);
  if (!raw) {
    alert('保存されたアセットがありません。');
    return;
  }
  try {
    const data = JSON.parse(raw);
    loadAssetsFromData(data);
  } catch (e) {
    console.error('loadAssetsFromLocal parse error', e);
    alert('保存データの読み込みに失敗しました（壊れている可能性があります）。');
  }
}

/**
 * ファイル（JSON）を受け取ってアセットをインポートする
 * - file: File オブジェクト
 * - replace: true なら既存 assetCircuits を上書き、false なら追加する
 */
function importAssetsFromFile(file, replace = true) {
  if (!file) {
    alert('ファイルが指定されていません');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      alert('JSONファイルの読み込みに失敗しました。');
      return;
    }
    // 簡易バリデーション：配列かつ要素が objects か
    if (!Array.isArray(data)) {
      alert('不正なアセットファイルです（配列が必要）。');
      return;
    }
    if (replace) {
      loadAssetsFromData(data);
    } else {
      // 追加する場合は既存の assetCircuits に push して render
      data.forEach(a => assetCircuits.push(a));
      renderAssets();
      saveAssetsToLocal();
      alert('アセットを追加インポートしました。');
    }
  };
  reader.readAsText(file);
}

/**
 * assetCircuits データを JSON ファイルとしてダウンロード（エクスポート）
 * - filename のデフォルトは assets_TIMESTAMP.json
 */
function exportAssetsToFile(filename) {
  try {
    const dataStr = JSON.stringify(assetCircuits, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `assets_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('exportAssetsToFile error', e);
    alert('アセットのエクスポートに失敗しました。');
  }
}

/**
 * 共通処理：読み込んだデータを現在の assetCircuits にセットして UI を更新する
 * load.js の loadGraphFromData に対応する関数
 */
function loadAssetsFromData(data) {
  // 防御： data は配列であること
  if (!Array.isArray(data)) {
    console.warn('loadAssetsFromData: data が配列ではありません');
    alert('インポートデータが不正です');
    return;
  }

  // 必要ならここでデータの最小限バリデーションをする
  // 例: nodes は配列、各 node は x,y,type を持つ、connections は配列など
  const ok = data.every(a => a && Array.isArray(a.nodes));
  if (!ok) {
    if (!confirm('読み込んだデータのフォーマットが完全でない可能性があります。続行してもいいですか？')) {
      return;
    }
  }

  // 既存をクリアして置き換える（上書き）
  assetCircuits.length = 0;
  data.forEach(a => assetCircuits.push(a));

  // UI の再描画
  if (typeof renderAssets === 'function') renderAssets();

  // ローカルにも保存（任意）
  saveAssetsToLocal();

  alert('アセットをロードしました。');
}

/* -------------------------
   HTML ボタンとの紐付け例
   使う場合は HTML に対応要素を置いてください：
   <button id="saveAssetsBtn">アセットを保存</button>
   <button id="loadAssetsBtn">アセットをロード</button>
   <button id="exportAssetsBtn">エクスポート</button>
   <button id="importAssetsBtn">インポート</button>
   <input id="importAssetsInput" type="file" accept=".json" style="display:none" />
-------------------------*/
document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('saveAssetsBtn');
  const loadBtn = document.getElementById('loadAssetsBtn');
  const exportBtn = document.getElementById('exportAssetsBtn');
  const importBtn = document.getElementById('importAssetsBtn');
  const importInput = document.getElementById('importAssetsInput');

  if (saveBtn) saveBtn.addEventListener('click', () => saveAssetsToLocal());
  if (loadBtn) loadBtn.addEventListener('click', () => loadAssetsFromLocal());
  if (exportBtn) exportBtn.addEventListener('click', () => exportAssetsToFile());
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) importAssetsFromFile(file, /*replace=*/true);
      importInput.value = ''; // 次回のためにクリア
    });
  }

  loadAssetsFromLocal();
});