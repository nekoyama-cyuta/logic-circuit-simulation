// assets.js

// アセットデータの保存場所
let assetCircuits = [];

// ノードタイプごとの色定義（プレビュー描画用）
const NODE_TYPE_COLOR = {
  positive: '#ff4444',
  negative: '#4444ff',
  and: '#ffa500',
  or: '#32cd32',
  not: '#ff69b4',
  xor: '#9370DB',
  normal: '#ffffff'
};

/* =========================================
   1. アセット保存機能
   ========================================= */

/**
 * 選択中のノード群をアセットとして保存配列に追加する
 */
function saveNodesAsAsset(name, nodes, connections = []) {
  if (!Array.isArray(nodes) || nodes.length === 0) return;

  const filteredNodes = nodes.map(n => ({
    x: n.x, y: n.y, type: n.type
  }));

  const filteredConnections = Array.isArray(connections) ? connections.map(c => ({ 
    from: c.from, 
    to: c.to,
    fromPin: c.fromPin, 
    toPin: c.toPin
  })) : [];

  const asset = {
    name: name || `Asset_${Date.now()}`,
    nodes: filteredNodes,
    connections: filteredConnections,
    timestamp: Date.now()
  };

  assetCircuits.push(asset);
  renderAssets(); // リスト更新
}


/* =========================================
   2. アセットロード機能（復元）
   ========================================= */

/**
 * アセットデータを現在のキャンバスに展開（ロード）する
 * @param {Object} asset - アセットオブジェクト
 * @param {Number} dropX - ドロップ位置X (指定がなければ画面中央)
 * @param {Number} dropY - ドロップ位置Y
 */
function loadAsset(asset, dropX, dropY) {
  if (!asset || !asset.nodes) return;

  // 1. ノード配置の基準点を計算（アセット内の左上を基準にする）
  let minX = Infinity, minY = Infinity;
  asset.nodes.forEach(n => {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
  });

  // ドロップ位置が指定されていなければ画面中央あたり
  // ※ script.js のグローバル変数 (translateX, scale等) に依存するため、
  //    安全に window中心座標などを使う
  let startX = dropX;
  let startY = dropY;

  if (startX === undefined || startY === undefined) {
    // 画面中央（簡易計算）
    // script.jsの変数が参照できない場合のフォールバック
    const tx = (typeof translateX !== 'undefined') ? translateX : 0;
    const ty = (typeof translateY !== 'undefined') ? translateY : 0;
    const s  = (typeof scale !== 'undefined') ? scale : 1;
    startX = (window.innerWidth / 2 - tx) / s;
    startY = (window.innerHeight / 2 - ty) / s;
  }

  // アセット内の相対位置を維持して配置
  const createdNodes = [];
  
  // createNode が script.js にある前提
  if (typeof createNode !== 'function') {
    console.error("createNode function is missing.");
    return;
  }

  asset.nodes.forEach(n => {
    // アセット内の相対座標 + 配置基準点
    const x = (n.x - minX) + startX;
    const y = (n.y - minY) + startY;
    
    // createNode(x, y, id, type, isAbsolute)
    const newNode = createNode(x, y, null, n.type, true);
    createdNodes.push(newNode);
  });

  // 2. 接続の復元
  if (asset.connections && typeof connections !== 'undefined') {
    asset.connections.forEach(c => {
      const fromNode = createdNodes[c.from];
      const toNode = createdNodes[c.to];

      if (fromNode && toNode) {
        // ピンを探すヘルパー (script.jsにあるか不明なのでここで簡易実装)
        const findPin = (node, name, dir) => {
            let p = node.querySelector(`.pin[data-pin-name="${name}"]`);
            if (!p) p = node.querySelector(`.pin[data-pin-dir="${dir}"]`);
            return p;
        };

        const fromPin = findPin(fromNode, c.fromPin, 'out');
        const toPin = findPin(toNode, c.toPin, 'in');

        if (fromPin && toPin) {
          connections.push({ from: fromPin, to: toPin });
        }
      }
    });
    
    // 再描画
    if (typeof drawConnections === 'function') drawConnections();
  }
}


/* =========================================
   3. プレビュー表示機能（復元）
   ========================================= */

let previewTooltip = null;

function showPreview(asset, e) {
  if (!previewTooltip) {
    previewTooltip = document.createElement('div');
    previewTooltip.id = 'assetPreviewTooltip';
    previewTooltip.style.position = 'fixed';
    previewTooltip.style.background = 'rgba(30, 30, 30, 0.95)';
    previewTooltip.style.border = '1px solid #666';
    previewTooltip.style.borderRadius = '4px';
    previewTooltip.style.padding = '5px';
    previewTooltip.style.zIndex = '10000';
    previewTooltip.style.pointerEvents = 'none'; // マウスイベントを邪魔しない
    previewTooltip.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
    document.body.appendChild(previewTooltip);
  }

  // キャンバス作成
  previewTooltip.innerHTML = '';
  const cvs = document.createElement('canvas');
  cvs.width = 150;
  cvs.height = 100;
  previewTooltip.appendChild(cvs);

  const ctx = cvs.getContext('2d');
  
  // アセットのバウンディングボックス計算
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  asset.nodes.forEach(n => {
    if(n.x < minX) minX = n.x;
    if(n.x > maxX) maxX = n.x;
    if(n.y < minY) minY = n.y;
    if(n.y > maxY) maxY = n.y;
  });
  
  // マージン
  const w = maxX - minX + 60; // ノード幅分余裕を見る
  const h = maxY - minY + 50;
  
  // 縮小率計算
  const scaleX = cvs.width / w;
  const scaleY = cvs.height / h;
  const s = Math.min(scaleX, scaleY, 1.0) * 0.8; // 余白持たせる

  // 中央寄せオフセット
  const contentW = w * s;
  const contentH = h * s;
  const offX = (cvs.width - contentW) / 2;
  const offY = (cvs.height - contentH) / 2;

  // 描画
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  
  // 接続線 (簡易)
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  if(asset.connections) {
    ctx.beginPath();
    asset.connections.forEach(c => {
      const n1 = asset.nodes[c.from];
      const n2 = asset.nodes[c.to];
      if(n1 && n2) {
        const x1 = offX + (n1.x - minX) * s + 10; // +10は簡易的なノード中心
        const y1 = offY + (n1.y - minY) * s + 10;
        const x2 = offX + (n2.x - minX) * s + 10;
        const y2 = offY + (n2.y - minY) * s + 10;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
    });
    ctx.stroke();
  }

  // ノード
  asset.nodes.forEach(n => {
    const x = offX + (n.x - minX) * s;
    const y = offY + (n.y - minY) * s;
    const size = 20 * s; // 簡易サイズ
    
    ctx.fillStyle = NODE_TYPE_COLOR[n.type] || '#fff';
    // 簡易的な四角形描画
    ctx.fillRect(x, y, Math.max(size, 4), Math.max(size*0.8, 4));
  });

  // 位置合わせ (マウスの右側へ)
  movePreview(e);
  previewTooltip.style.display = 'block';
}

function movePreview(e) {
  if (!previewTooltip) return;
  const offset = 15;
  // 画面外にはみ出さないような簡易チェック
  let left = e.clientX + offset;
  let top = e.clientY + offset;
  
  if (left + 160 > window.innerWidth) left = e.clientX - 165;
  if (top + 110 > window.innerHeight) top = e.clientY - 115;

  previewTooltip.style.left = left + 'px';
  previewTooltip.style.top = top + 'px';
}

function hidePreview() {
  if (previewTooltip) {
    previewTooltip.style.display = 'none';
  }
}


/* =========================================
   4. リスト描画機能（前回の改善適用済み）
   ========================================= */

function renderAssets() {
  const listEl = document.getElementById('assetList');
  if (!listEl) return;

  listEl.innerHTML = '';

  assetCircuits.forEach((asset, index) => {
    const item = document.createElement('div');
    item.className = 'asset-item';
    item.draggable = true;

    // --- イベントリスナー ---
    
    // 1. ドラッグ開始
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify(asset));
      e.dataTransfer.effectAllowed = 'copy';
      // ドラッグ中はプレビュー消す
      hidePreview();
    });

    // 2. ダブルクリックでロード（機能復元）
    item.addEventListener('dblclick', (e) => {
      // 画面中央付近にロード
      loadAsset(asset); 
    });

    // 3. プレビュー表示（機能復元）
    item.addEventListener('mouseenter', (e) => showPreview(asset, e));
    item.addEventListener('mousemove', (e) => movePreview(e));
    item.addEventListener('mouseleave', () => hidePreview());


    // --- UI構築 ---

    // 名前エリア
    const nameSpan = document.createElement('span');
    nameSpan.className = 'asset-name';
    nameSpan.textContent = asset.name;
    nameSpan.title = asset.name; // ホバーで全名表示

    // 情報エリア
    const infoSpan = document.createElement('span');
    infoSpan.className = 'asset-info';
    infoSpan.textContent = `N:${asset.nodes.length}`; // "Nodes: 5" 等

    // 削除ボタン
    const delBtn = document.createElement('button');
    delBtn.className = 'asset-delete-btn';
    delBtn.innerHTML = '🗑'; // ゴミ箱アイコン
    delBtn.title = '削除';
    delBtn.onclick = (e) => {
      e.stopPropagation(); // 選択やロードの発火防止
      if (confirm(`アセット "${asset.name}" を削除しますか？`)) {
        assetCircuits.splice(index, 1);
        renderAssets();
        hidePreview();
      }
    };

    item.appendChild(nameSpan);
    item.appendChild(infoSpan);
    item.appendChild(delBtn);

    listEl.appendChild(item);
  });
}

// 初期化
document.addEventListener('DOMContentLoaded', renderAssets);