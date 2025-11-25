// assetCircuits は既存の配列
let assetCircuits = [];

// ノードを描く（円）
  const NODE_TYPE_COLOR = {
    positive: 'red',
    negative: 'blue',
    and: '#ffa500',
    or: '#90ee90',
    not: '#ff69b4',
    xor: '#9370DB',
    normal: '#ffffff'
  };

/**
 * ノード群をAssetとして保存する関数はそのまま使う
 * nodes には {x,y,type} の配列を渡す前提
 */
// assets.js 内の関数

function saveNodesAsAsset(name, nodes, connections = []) {
  if (!Array.isArray(nodes)) return;

  const filteredNodes = nodes.map(n => ({
    x: n.x, y: n.y, type: n.type
  }));

  // 【重要】fromPin, toPin を確実にプロパティとして残す
  const filteredConnections = Array.isArray(connections) ? connections.map(c => ({ 
    from: c.from, 
    to: c.to,
    fromPin: c.fromPin, 
    toPin: c.toPin
  })) : [];

  const asset = {
    name: name || `Asset_${Date.now()}`,
    nodes: filteredNodes,
    connections: filteredConnections
  };

  assetCircuits.push(asset);
  if (typeof renderAssets === 'function') renderAssets();
  if (typeof saveAssetsToLocal === 'function') saveAssetsToLocal();
}


// プレビュー描画（キャンバスにノードと接続を縮尺して描く）
function drawAssetPreview(canvas, asset) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (!asset || !Array.isArray(asset.nodes) || asset.nodes.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.font = '12px sans-serif';
    ctx.fillText('empty', 8, 16);
    return;
  }

  // ノード群のバウンディングボックスを計算
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  asset.nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  });
  const padding = 8;
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);

  // 縮尺（preview に収める）
  const scaleX = (W - padding * 2) / worldW;
  const scaleY = (H - padding * 2) / worldH;
  let s = Math.min(scaleX, scaleY, 1);
  s = Math.max(s, 0.06); // 最低倍率

  const worldCenterX = minX + worldW / 2;
  const worldCenterY = minY + worldH / 2;
  const canvasCenterX = W / 2;
  const canvasCenterY = H / 2;
  const wxToCx = (wx) => canvasCenterX + (wx - worldCenterX) * s;
  const wyToCy = (wy) => canvasCenterY + (wy - worldCenterY) * s;

  // 背景
  ctx.fillStyle = '#041016';
  ctx.fillRect(0, 0, W, H);

  // まず接続（線）を描く（connections が存在すれば）
  // --- 接続復元ロジックの強化版 ---
  if (Array.isArray(asset.connections) && asset.connections.length > 0) {
    if (typeof connections === 'undefined') {
      console.warn('connections配列が見つかりません');
    } else {
      asset.connections.forEach(c => {
        const fromNode = createdNodes[c.from];
        const toNode = createdNodes[c.to];

        if (fromNode && toNode) {
          // ▼▼▼ ピン探索ロジック（名前で見つからなければ方向で探す） ▼▼▼
          const findPin = (node, pinName, dirFallback) => {
             // 1. 名前で厳密に探す
             if (pinName) {
               const p = node.querySelector(`.pin[data-pin-name="${pinName}"]`);
               if (p) return p;
             }
             // 2. なければ方向(in/out)で探す（救済措置: AND回路のAピンなどをIN扱い等で拾う）
             return node.querySelector(`.pin[data-pin-dir="${dirFallback}"]`);
          };

          // 出力側ピンを探す (名前がなければ OUT 扱い)
          const fromPin = findPin(fromNode, c.fromPin, 'out');
          // 入力側ピンを探す (名前がなければ IN 扱い)
          const toPin = findPin(toNode, c.toPin, 'in');

          if (fromPin && toPin) {
            connections.push({ from: fromPin, to: toPin });
          } else {
            console.warn('Asset load: ピンが見つかりませんでした', c);
          }
        }
      });
      
      // 最後に再描画
      if (typeof drawConnections === 'function') drawConnections();
    }
  }

  asset.nodes.forEach(n => {
    const cx = wxToCx(n.x);
    const cy = wyToCy(n.y);
    const baseSize = 12;
    const size = Math.max(4, baseSize * s);
    const col = NODE_TYPE_COLOR[n.type] || NODE_TYPE_COLOR.normal;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // 枠
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}

// --- asset.js 追加コード ---
// assetCircuits は既に定義されている前提

// 指定インデックスのアセットを削除
function deleteAsset(index) {
  if (!Number.isInteger(index) || index < 0 || index >= assetCircuits.length) {
    console.warn('deleteAsset: 無効な index', index);
    return;
  }
  const asset = assetCircuits[index];
  const ok = window.confirm(`アセット "${asset.name || 'Unnamed'}" を削除しますか？`);
  if (!ok) return;
  assetCircuits.splice(index, 1);
  renderAssets();
}

// 全アセットを削除（確認あり）
function clearAllAssets() {
  if (assetCircuits.length === 0) return;
  const ok = window.confirm(`全 ${assetCircuits.length} 個のアセットを本当に削除しますか？ この操作は取り消せません。`);
  if (!ok) return;
  assetCircuits.length = 0;
  renderAssets();
}

// renderAssets を既存のプレビュー対応版のまま、削除ボタンを付ける
function renderAssets() {
  const list = document.getElementById("assetList");
  if (!list) {
    console.warn('renderAssets: #assetList が見つかりません。');
    return;
  }
  list.innerHTML = "";

  // optional: コントロール行（全部消すボタン）
  const controls = document.createElement('div');
  controls.id = 'asset-controls';
  const clearBtn = document.createElement('button');
  clearBtn.id = 'clearAllAssetsBtn';
  clearBtn.innerText = '全削除';
  clearBtn.onclick = (e) => { e.stopPropagation(); clearAllAssets(); };
  controls.appendChild(clearBtn);
  list.appendChild(controls);

  assetCircuits.forEach((asset, index) => {
    const item = document.createElement("div");
    item.className = "asset-item";
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.gap = '10px';
    item.style.padding = '6px';

    // プレビューキャンバス
    const preview = document.createElement("canvas");
    preview.className = "asset-preview";
    const previewW = 160;
    const previewH = 80;
    preview.width = previewW;
    preview.height = previewH;
    preview.style.width = previewW + 'px';
    preview.style.height = previewH + 'px';

    // テキスト部分
    const meta = document.createElement("div");
    meta.style.display = "flex";
    meta.style.flexDirection = "column";
    meta.style.justifyContent = "center";
    meta.style.minWidth = "140px";

    const title = document.createElement("div");
    title.className = "asset-title";
    title.innerText = asset.name || `Asset_${index}`;

    const nodeCount = Array.isArray(asset.nodes) ? asset.nodes.length : 0;
    const connCount = Array.isArray(asset.connections) ? asset.connections.length : 0;
    const desc = document.createElement("div");
    desc.className = "asset-desc";
    desc.innerText = `ノード: ${nodeCount} / 接続: ${connCount}`;

    meta.appendChild(title);
    meta.appendChild(desc);

    item.appendChild(preview);
    item.appendChild(meta);

    // 削除ボタン（クリック時にロードイベントとバッティングしないよう stopPropagation）
    const delBtn = document.createElement('button');
    delBtn.className = 'asset-delete-btn';
    delBtn.title = '削除';
    delBtn.innerHTML = '🗑'; // アイコン代わり。必要ならSVGに差し替え
    delBtn.onclick = (e) => { e.stopPropagation(); deleteAsset(index); };

    item.appendChild(delBtn);

    // クリックでロード（キャンバス中央に展開）
    item.addEventListener("click", () => {
      loadAsset(index);
    });

    list.appendChild(item);

    // プレビューを描画
    try {
      drawAssetPreview(preview, asset);
    } catch (err) {
      console.error('drawAssetPreview error', err);
    }
  });
}


/**
 * asset を preview canvas に描画する関数
 * - asset.nodes: [{x,y,type}]
 */
function drawAssetPreview(canvas, asset) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (!asset.nodes || asset.nodes.length === 0) {
    // 空の場合は淡いテキスト
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.font = '12px sans-serif';
    ctx.fillText('empty', 8, 16);
    return;
  }
  
  // ノード群のバウンディングボックスを計算
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  asset.nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  });
  // 幅・高さが0の時はサイズを与える（単体ノード対応）
  const padding = 8; // preview 内余白
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);

  // scale は preview に収めるための縮尺（最大1）
  const scaleX = (W - padding * 2) / worldW;
  const scaleY = (H - padding * 2) / worldH;
  let s = Math.min(scaleX, scaleY, 1);
  // 小さすぎると見えないので最小倍率を設定（任意）
  s = Math.max(s, 0.08);

  // 中心に合わせるオフセット（world -> canvas）
  const worldCenterX = minX + worldW / 2;
  const worldCenterY = minY + worldH / 2;
  const canvasCenterX = W / 2;
  const canvasCenterY = H / 2;

  // 描画用関数：world -> canvas
  function wxToCx(wx) { return canvasCenterX + (wx - worldCenterX) * s; }
  function wyToCy(wy) { return canvasCenterY + (wy - worldCenterY) * s; }
  
  // 背景（微妙なグリッドなどを入れても良いがシンプルに）
  ctx.fillStyle = '#041016';
  ctx.fillRect(0, 0, W, H);

  // ノードを描画
  asset.nodes.forEach(n => {
    const cx = wxToCx(n.x);
    const cy = wyToCy(n.y);
    // ノードサイズは縮尺に応じて調整
    const baseSize = 12;
    const size = Math.max(4, baseSize * s);
    
    // 色をタイプから決める（fallback 白）
    const col = NODE_TYPE_COLOR[n.type] || NODE_TYPE_COLOR.normal;
    ctx.fillStyle = col;
    // 円で描画
    ctx.beginPath();
    ctx.arc(cx, cy, size/2, 0, Math.PI * 2);
    ctx.fill();
    
    // 小さな枠
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // optional: 軸や枠を描く
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.strokeRect(0.5, 0.5, W-1, H-1);
}

/**
 * Assetを読み込む処理
 * 保存したノード群をキャンバス上に復元し、接続も復元する
 */
function loadAsset(index) {
  const asset = assetCircuits[index];
  if (!asset) {
    console.warn('loadAsset: 指定された asset が存在しません。');
    return;
  }
  if (!Array.isArray(asset.nodes) || asset.nodes.length === 0) {
    console.warn('loadAsset: asset のノードが空です。');
    return;
  }

  // asset の中心（world座標）
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  asset.nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  });
  const assetCenterX = minX + (maxX - minX) / 2;
  const assetCenterY = minY + (maxY - minY) / 2;

  // 画面中央の world 座標（script.js の translateX/translateY/scale を参照）
  const screenCenterX = window.innerWidth / 2;
  const screenCenterY = window.innerHeight / 2;
  const globalTranslateX = (typeof translateX !== 'undefined') ? translateX : 0;
  const globalTranslateY = (typeof translateY !== 'undefined') ? translateY : 0;
  const globalScale = (typeof scale !== 'undefined') ? scale : 1;

  const targetWorldCenterX = (screenCenterX - globalTranslateX) / globalScale;
  const targetWorldCenterY = (screenCenterY - globalTranslateY) / globalScale;
  const shiftX = targetWorldCenterX - assetCenterX;
  const shiftY = targetWorldCenterY - assetCenterY;

  // ノードを作成してマッピング（asset のノードインデックス -> 実 DOM 要素）
  const createdNodes = [];
  asset.nodes.forEach((n) => {
    if (typeof createNode === 'function') {
      // createNode(worldX, worldY, id=null, type, isAbsolute=true)
      const created = createNode(n.x + shiftX, n.y + shiftY, null, n.type, true);
      createdNodes.push(created);
    } else {
      console.warn('loadAsset: createNode が見つかりません。script.js を確認してください。');
    }
  });

  // 接続を復元
  if (Array.isArray(asset.connections) && asset.connections.length > 0) {
    if (typeof connections === 'undefined') {
      console.warn('loadAsset: グローバル connections 配列が見つかりません。接続を復元できません。');
    } else {
      asset.connections.forEach(c => {
        // 配列インデックスからノード要素を取得
        const fromNode = createdNodes[c.from];
        const toNode = createdNodes[c.to];

        if (fromNode && toNode) {
          // 【修正】保存されたピン名を使ってピン要素を特定する
          // 古いデータ等で pin名がない場合は、とりあえず "OUT"/"IN" などをフォールバックにする
          const fromPinName = c.fromPin || 'OUT';
          const toPinName = c.toPin || 'IN';

          const fromPin = fromNode.querySelector(`.pin[data-pin-name="${fromPinName}"]`);
          const toPin = toNode.querySelector(`.pin[data-pin-name="${toPinName}"]`);

          if (fromPin && toPin) {
            connections.push({ from: fromPin, to: toPin });
          }
        }
      });
      
      // 最後に描画更新
      if (typeof drawConnections === 'function') {
        drawConnections();
      }
    }
  }
}