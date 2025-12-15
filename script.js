// script.js

// --- 冒頭のCSS注入 ---
(function injectSelectionStyles(){
    const style = document.createElement('style');
    style.textContent = `
    #selectionRect {
      position: fixed;
      pointer-events: none;
      border: 1px dashed #00aaff;
      background: rgba(0,170,255,0.08);
      z-index: 9999;
    }`;
    document.head.appendChild(style);
})();

const canvas = document.getElementById("connectionCanvas");
const ctx = canvas.getContext("2d");

let nodes = [];
let connections = [];
let lastPinStates = new Map();
let activeNode = null;
let offsetX, offsetY;
let connectingFromPin = null;

let translateX = 0;
let translateY = 0;
let scale = 1;
let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;

let isSelecting = false;
let selectionStartX = 0;
let selectionStartY = 0;
let selectionRectEl = null;
let selectedNodes = new Set();

let isGroupDragging = false;
let groupStartMouseLogical = { x: 0, y: 0 };
let groupOriginalPositions = new Map();

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    drawConnections();
}

function applyTransformToNodes() {
    nodes.forEach(node => {
        const logicalX = parseFloat(node.style.left || 0);
        const logicalY = parseFloat(node.style.top || 0);
        const screenPos = worldToScreen(logicalX, logicalY);
        const deltaX = screenPos.x - logicalX;
        const deltaY = screenPos.y - logicalY;
        node.style.transformOrigin = "0 0";
        node.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scale})`;
    });
}

function drawConnections() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    connections.forEach(conn => {
        const fromPin = conn.from;
        const toPin = conn.to;
        if (!fromPin || !toPin) return;

        // === 1. ノードのロジック座標 ===
        const fromNode = fromPin.closest('.node');
        const toNode   = toPin.closest('.node');
        if (!fromNode || !toNode) return;

        const n1X = parseFloat(fromNode.style.left || 0);
        const n1Y = parseFloat(fromNode.style.top  || 0);
        const n2X = parseFloat(toNode.style.left  || 0);
        const n2Y = parseFloat(toNode.style.top   || 0);

        // === 2. ピンのノード内部での相対位置を取得 ===
        const n1pinOffX = parseFloat(fromPin.style.left  || 0) + fromPin.offsetWidth/2;
        const n1pinOffY = parseFloat(fromPin.style.top   || 0) + fromPin.offsetHeight/2;
        const n2pinOffX = parseFloat(toPin.style.left    || 0) + toPin.offsetWidth/2;
        const n2pinOffY = parseFloat(toPin.style.top     || 0) + toPin.offsetHeight/2;

        // === 3. ピンのワールド座標 ===
        const fromWorld = { x: n1X + n1pinOffX, y: n1Y + n1pinOffY };
        const toWorld   = { x: n2X + n2pinOffX, y: n2Y + n2pinOffY };

        // === 4. スクリーン座標に変換 ===
        const fromPos = worldToScreen(fromWorld.x, fromWorld.y);
        const toPos   = worldToScreen(toWorld.x,   toWorld.y);

        // === 5. 描画 ===
        const isHigh = lastPinStates.get(fromPin) === true;
        ctx.strokeStyle = isHigh ? "#ffff00" : "#00ffff";
        ctx.lineWidth = isHigh ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(fromPos.x, fromPos.y);
        ctx.lineTo(toPos.x, toPos.y);
        ctx.stroke();
    });
}

const NODE_TEMPLATES = {
  normal: { pins: [{name: 'IN', dir: 'in'}, {name: 'OUT', dir: 'out'}] },
  and:    { pins: [{name:'A', dir:'in'}, {name:'B', dir:'in'}, {name:'OUT', dir:'out'}] },
  or:     { pins: [{name:'A', dir:'in'}, {name:'B', dir:'in'}, {name:'OUT', dir:'out'}] },
  not:    { pins: [{name:'IN', dir:'in'}, {name:'OUT', dir:'out'}] },
  xor:    { pins: [{name:'A', dir:'in'}, {name:'B', dir:'in'}, {name:'OUT', dir:'out'}] },
  positive: { pins: [{name:'OUT', dir:'out'}] },
  negative: { pins: [{name:'IN', dir:'in'}] }
};

function createNode(x, y, id = null, type = "normal", isAbsolute = true) {
    const node = document.createElement("div");
    node.className = "node";
    node.dataset.type = type;
    node.style.position = "absolute";

    if (isAbsolute) {
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
    } else {
        node.style.left = `${(x - translateX) / scale}px`;
        node.style.top = `${(y - translateY) / scale}px`;
    }

    node.dataset.id = id || `node_${Date.now()}_${Math.random()}`;

    // ラベル
    const label = document.createElement("span");
    label.className = "node-label";
    node.appendChild(label);

    if (type === "positive") {
        node.dataset.isOn = "false";
        label.textContent = "OFF";
    } else if (type === "negative") {
        label.textContent = "OUT";
    } else if (type === "normal") {
        label.textContent = "";
    } else {
        label.textContent = type.toUpperCase();
    }

    document.getElementById("nodesContainer").appendChild(node);

    // ピン
    const tpl = NODE_TEMPLATES[type] || NODE_TEMPLATES['normal'];
    const pinsContainer = document.createElement('div');
    pinsContainer.className = 'pinsContainer';
    node.appendChild(pinsContainer);

    const nodeWidth = node.offsetWidth;
    const nodeHeight = node.offsetHeight;
    
    let inCount = tpl.pins.filter(p => p.dir === 'in').length;
    let outCount = tpl.pins.filter(p => p.dir === 'out').length;
    let in_idx = 0;
    let out_idx = 0;

    tpl.pins.forEach((p) => {
        const pin = document.createElement('div');
        pin.className = `pin ${p.dir}`;
        pin.dataset.pinName = p.name;
        pin.dataset.pinDir = p.dir;
        pin.title = p.name;
        pinsContainer.appendChild(pin);

        const pw = 10, ph = 10;
        if (p.dir === 'in') {
            const spacing = nodeHeight / (inCount + 1);
            const top = spacing * (in_idx + 1) - (ph / 2);
            pin.style.left = `-${pw/2}px`;
            pin.style.top = `${top}px`;
            in_idx++;
        } else {
            const spacing = nodeHeight / (outCount + 1);
            const top = spacing * (out_idx + 1) - (ph / 2);
            pin.style.left = `${nodeWidth - pw/2}px`;
            pin.style.top = `${top}px`;
            out_idx++;
        }
    });

    // --- イベントリスナー ---
    if (type === "positive") {
        node.classList.add("source");

        // --- ★ここから修正ブロック ---

        // クリック判定用の変数を定義
        let mouseDownX = 0;
        let mouseDownY = 0;

        // 見た目を更新する関数
        const updateVisual = () => {
            const isOn = node.dataset.isOn === "true";
            
            // ON/OFFに応じたスタイル適用
            node.style.backgroundColor = isOn ? "#ffeb3b" : "#444";
            node.style.color = isOn ? "#000" : "#fff";
            node.style.boxShadow = isOn ? "0 0 10px #ffeb3b" : "none";
        };

        // 初期化：datasetが空ならOFFにする
        if (!node.dataset.isOn) {
            node.dataset.isOn = "false";
        }
        updateVisual();

        // 外部（履歴機能など）からの更新通知を受け取る
        node.addEventListener("updateVisual", updateVisual);

        // マウスを押した位置を記録（クリック判定用）
        node.addEventListener("mousedown", (e) => {
            mouseDownX = e.clientX;
            mouseDownY = e.clientY;
        });

        // クリックイベント（ドラッグでない場合のみ反応）
        node.addEventListener("click", (e) => {
            // マウスを押した位置と離した位置の距離を計算
            const moveDist = Math.hypot(e.clientX - mouseDownX, e.clientY - mouseDownY);
            
            // ほとんど動いていなければクリックとみなす
            if (moveDist < 5) {
                // トグル処理
                const current = node.dataset.isOn === "true";
                node.dataset.isOn = (!current).toString();
                
                // 見た目を更新
                updateVisual();

                // 回路の再計算（シミュレーション関数があれば呼ぶ）
                if (typeof simulateElectricFlow === "function") {
                    simulateElectricFlow(connections, nodes);
                } else if (typeof drawConnections === "function") {
                    drawConnections();
                }
            }
        });
    }

    node.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        if (e.target.classList && e.target.classList.contains('pin')) {
            const pin = e.target;
            if (connectingFromPin === null) {
                connectingFromPin = pin;
                pin.style.background = "#ffff00";
            } else {
                if (connectingFromPin !== pin) {
                    const fromDir = connectingFromPin.dataset.pinDir;
                    const toDir = pin.dataset.pinDir;
                    if ((fromDir === 'out' && toDir === 'in') || (fromDir === 'in' && toDir === 'out')) {
                        if (fromDir === 'out' && toDir === 'in') connections.push({ from: connectingFromPin, to: pin });
                        if (fromDir === 'in' && toDir === 'out') connections.push({ to: connectingFromPin, from: pin });
                    }
                }
                connectingFromPin.style.background = ""; 
                connectingFromPin.style.removeProperty('background');
                connectingFromPin = null;
                drawConnections();
            }
            return;
        }

        if (!selectedNodes.has(node)) {
            if (!e.ctrlKey) clearSelection();
            selectedNodes.add(node);
            node.classList.add('selected');
        }
        
        activeNode = node;
        isGroupDragging = true;
        groupStartMouseLogical = { 
            x: (e.clientX - translateX) / scale,
            y: (e.clientY - translateY) / scale 
        };
        groupOriginalPositions.clear();
        selectedNodes.forEach(n => {
            groupOriginalPositions.set(n, {
                x: parseFloat(n.style.left || 0),
                y: parseFloat(n.style.top || 0)
            });
        });
        node.style.cursor = "grabbing";
    });

    node.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const targets = selectedNodes.has(node) ? Array.from(selectedNodes) : [node];
        targets.forEach(delNode => {
            connections = connections.filter(c => 
                c.from.closest('.node') !== delNode && c.to.closest('.node') !== delNode
            );
            delNode.remove();
            nodes = nodes.filter(n => n !== delNode);
            selectedNodes.delete(delNode);
        });
        drawConnections();
    });

    nodes.push(node);
    applyTransformToNodes();
    return node;
}

function clearSelection() {
    selectedNodes.forEach(n => n.classList.remove('selected'));
    selectedNodes.clear();
}

function rectsIntersect(ax, ay, aw, ah, bx, by, bw, bh) {
    return !(bx > ax + aw || bx + bw < ax || by > ay + ah || by + bh < ay);
}

function simulateElectricFlow(connections, nodes) {
    let pinStates = new Map();
    const MAX_ITERATIONS = 50;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        const nextPinStates = new Map();
        let isStable = true;

        const isInputHigh = (pinElement) => {
            if (!pinElement) return false;
            const drivingConn = connections.find(c => 
                c.to === pinElement && pinStates.get(c.from) === true
            );
            return !!drivingConn;
        };

        nodes.forEach(node => {
            const type = node.dataset.type;
            const getPin = (name) => node.querySelector(`.pin[data-pin-name="${name}"]`);
            let outputVal = false;

            switch (type) {
                case 'positive':
                    outputVal = (node.dataset.isOn === "true");
                    break;
                case 'normal':
                    outputVal = isInputHigh(getPin('IN'));
                    break;
                case 'not':
                    outputVal = !isInputHigh(getPin('IN'));
                    break;
                case 'and':
                    outputVal = isInputHigh(getPin('A')) && isInputHigh(getPin('B'));
                    break;
                case 'or':
                    outputVal = isInputHigh(getPin('A')) || isInputHigh(getPin('B'));
                    break;
                case 'xor':
                    outputVal = isInputHigh(getPin('A')) !== isInputHigh(getPin('B'));
                    break;
            }

            const outPin = getPin('OUT');
            if (outPin) {
                const currentVal = pinStates.get(outPin) || false;
                if (currentVal !== outputVal) isStable = false;
                nextPinStates.set(outPin, outputVal);
            }
        });
        pinStates = nextPinStates;
        if (isStable) break;
    }

    lastPinStates = pinStates;

    nodes.forEach(node => {
        const type = node.dataset.type;
        let isPowered = false;

        if (type === 'negative') {
            const inPin = node.querySelector(`.pin[data-pin-name="IN"]`);
            const drivingConn = connections.find(c => c.to === inPin && pinStates.get(c.from) === true);
            isPowered = !!drivingConn;
        } else {
            const outPin = node.querySelector(`.pin[data-pin-name="OUT"]`);
            if (outPin && pinStates.get(outPin) === true) isPowered = true;
        }
        if (type === 'negative') {
            node.dataset.isOn = isPowered.toString();
        }

        if (type === 'normal') {
            const inPin = node.querySelector(`.pin[data-pin-name="IN"]`);
            const drivingConn = connections.find(c => c.to === inPin && pinStates.get(c.from) === true);
            isPowered = !!drivingConn;
        } else {
            const outPin = node.querySelector(`.pin[data-pin-name="OUT"]`);
            if (outPin && pinStates.get(outPin) === true) isPowered = true;
        }
        if (type === 'normal') {
            node.dataset.isOn = isPowered.toString();
        }
    });

    drawConnections();
}

// --- Assetドロップ連携用 ---
const assetBoxEl = document.getElementById('assetBox');
const assetDropHoverClass = 'asset-drop-hover';

// 安全確認
const canSaveAsset = typeof saveNodesAsAsset === 'function';
if (!assetBoxEl) {
  console.warn('assetBox 要素が見つかりません。id="assetBox" の要素を確認して下さい。');
}

function isPointerOverAssetBox(clientX, clientY) {
  if (!assetBoxEl) return false;
  const rect = assetBoxEl.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function updateAssetBoxHover(clientX, clientY) {
  if (!assetBoxEl) return;
  if (isPointerOverAssetBox(clientX, clientY)) {
    if (!assetBoxEl.classList.contains(assetDropHoverClass)) {
      assetBoxEl.classList.add(assetDropHoverClass);
    }
  } else {
    assetBoxEl.classList.remove(assetDropHoverClass);
  }
}

function collectSelectedNodeDataWithConnections() {
    if (!selectedNodes || selectedNodes.size === 0) return { nodes: [], connections: [] };
    const nodeElems = Array.from(selectedNodes);
    const nodesData = nodeElems.map(n => ({
        x: parseFloat(n.style.left || 0),
        y: parseFloat(n.style.top || 0),
        type: n.dataset.type || 'normal'
    }));
    const nodeIndexMap = new Map();
    nodeElems.forEach((el, i) => nodeIndexMap.set(el, i));
    const connectionsData = [];
    connections.forEach(conn => {
        const fromNode = conn.from.closest('.node');
        const toNode = conn.to.closest('.node');
        if (nodeIndexMap.has(fromNode) && nodeIndexMap.has(toNode)) {
             connectionsData.push({
                from: nodeIndexMap.get(fromNode),
                fromPin: conn.from.dataset.pinName,
                to: nodeIndexMap.get(toNode),
                toPin: conn.to.dataset.pinName
             });
        }
    });
    return { nodes: nodesData, connections: connectionsData };
}

function handleDropToAssetBox(clientX, clientY) {
  if (!assetBoxEl || !canSaveAsset) return false;
  if (!selectedNodes || selectedNodes.size === 0) return false;

  const over = isPointerOverAssetBox(clientX, clientY);
  if (!over) {
    assetBoxEl.classList.remove(assetDropHoverClass);
    return false;
  }

  const data = collectSelectedNodeDataWithConnections();
  if (!data.nodes.length) {
    return false;
  }

  const name = window.prompt('Asset名を入力（キャンセルで自動名）:', '');
  saveNodesAsAsset(name, data.nodes, data.connections);

  assetBoxEl.classList.remove(assetDropHoverClass);
  return true;
}

// --- メインイベントリスナー (ここに集約) ---

document.addEventListener("mousedown", (e) => {
    // UI (toolbar, assetBox) 上でのクリックはパン移動のトリガーにしない
    if (e.target.closest('.toolbar') || e.target.closest('#assetBox')) {
        return;
    }
    
    // パン開始
    if (!activeNode && !e.ctrlKey && e.button === 0 && !e.target.closest('.button-container')) {
        isPanning = true;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        document.body.style.cursor = "grabbing";
        e.preventDefault();
        return;
    }
    // 矩形選択開始
    if (e.ctrlKey && e.button === 0 && !e.target.closest('.node')) {
        isSelecting = true;
        selectionStartX = e.clientX;
        selectionStartY = e.clientY;
        selectionRectEl = document.createElement('div');
        selectionRectEl.id = 'selectionRect';
        document.body.appendChild(selectionRectEl);
        clearSelection();
        e.preventDefault();
        return;
    }
});

document.addEventListener("mousemove", (e) => {
    if (isGroupDragging) {
        const currentMouseLogical = {
            x: (e.clientX - translateX) / scale,
            y: (e.clientY - translateY) / scale
        };
        const dx = currentMouseLogical.x - groupStartMouseLogical.x;
        const dy = currentMouseLogical.y - groupStartMouseLogical.y;
        groupOriginalPositions.forEach((pos, n) => {
            n.style.left = `${pos.x + dx}px`;
            n.style.top = `${pos.y + dy}px`;
        });
        
        applyTransformToNodes();
        drawConnections();
        updateAssetBoxHover(e.clientX, e.clientY);
        return;
    }

    if (activeNode && !isGroupDragging) {
        // 単体ドラッグ (createNode内のイベントで処理されるが、念のため)
        const newLogicalX = (e.clientX - offsetX - translateX) / scale;
        const newLogicalY = (e.clientY - offsetY - translateY) / scale;
        activeNode.style.left = `${newLogicalX}px`;
        activeNode.style.top = `${newLogicalY}px`;
        applyTransformToNodes();
        drawConnections();
        return;
    }

    if (isPanning) {
        translateX += e.clientX - lastPanX;
        translateY += e.clientY - lastPanY;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        resizeCanvas();
        applyTransformToNodes();
        drawConnections();
        return;
    }

    if (isSelecting && selectionRectEl) {
        const x1 = selectionStartX; const y1 = selectionStartY;
        const x2 = e.clientX; const y2 = e.clientY;
        const left = Math.min(x1, x2); const top = Math.min(y1, y2);
        const w = Math.abs(x2 - x1); const h = Math.abs(y2 - y1);
        selectionRectEl.style.left = left+'px'; selectionRectEl.style.top = top+'px';
        selectionRectEl.style.width = w+'px'; selectionRectEl.style.height = h+'px';
        
        const wl = (left - translateX)/scale; const wt = (top - translateY)/scale;
        const ww = w/scale; const wh = h/scale;
        
        nodes.forEach(n => {
            const nx = parseFloat(n.style.left||0);
            const ny = parseFloat(n.style.top||0);
            if (rectsIntersect(wl, wt, ww, wh, nx, ny, n.offsetWidth, n.offsetHeight)) {
                if (!selectedNodes.has(n)) { selectedNodes.add(n); n.classList.add('selected'); }
            } else {
                if (selectedNodes.has(n)) { selectedNodes.delete(n); n.classList.remove('selected'); }
            }
        });
    }
});

document.addEventListener("mouseup", (e) => {
    if (activeNode) activeNode.style.cursor = "grab";
    
    // グループドラッグ終了時のアセットボックスへのドロップ判定
    if (isGroupDragging) {
        handleDropToAssetBox(e.clientX, e.clientY);
    }

    activeNode = null;
    isGroupDragging = false;
    isPanning = false;
    document.body.style.cursor = "";
    if (isSelecting) {
        if(selectionRectEl) selectionRectEl.remove();
        selectionRectEl = null;
        isSelecting = false;
    }
    groupOriginalPositions.clear();
});

// ここが修正の肝: 重複していた wheel イベントを1つにし、条件分岐も統合
document.addEventListener("wheel", (e) => {
    // アセットリストやアセットボックス上でのスクロールはズームしない
    if (e.target.closest('#assetList') || e.target.closest('#assetBox')) return;
    
    e.preventDefault();
    const s = 1.1;
    const oldScale = scale;
    scale *= e.deltaY < 0 ? s : 1/s;
    
    const mx = e.clientX; 
    const my = e.clientY;
    
    translateX = mx - ((mx - translateX)/oldScale)*scale;
    translateY = my - ((my - translateY)/oldScale)*scale;
    
    applyTransformToNodes();
    resizeCanvas();
    drawConnections(); // 念のため再描画
}, { passive: false });

document.addEventListener("dblclick", (e) => {
    if (e.target.closest('.node') || e.target.closest('.toolbar') || e.target.closest('#assetBox')) {
        return;
    }
    createNode(e.clientX, e.clientY, null, "normal", false);
});

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ボタンイベント
document.getElementById("addPositivePower").addEventListener("click", () => createNode((window.innerWidth/2-translateX)/scale, (window.innerHeight/2-translateY)/scale, null, "positive"));
document.getElementById("addNegativePower").addEventListener("click", () => createNode((window.innerWidth/2-translateX)/scale, (window.innerHeight/2-translateY)/scale, null, "negative"));
document.getElementById("addAndGate").addEventListener("click", () => createNode((window.innerWidth/2-translateX)/scale, (window.innerHeight/2-translateY)/scale, null, "and"));
document.getElementById("addOrGate").addEventListener("click", () => createNode((window.innerWidth/2-translateX)/scale, (window.innerHeight/2-translateY)/scale, null, "or"));
document.getElementById("addNotGate").addEventListener("click", () => createNode((window.innerWidth/2-translateX)/scale, (window.innerHeight/2-translateY)/scale, null, "not"));
document.getElementById("addXorGate").addEventListener("click", () => createNode((window.innerWidth/2-translateX)/scale, (window.innerHeight/2-translateY)/scale, null, "xor"));

document.getElementById("exportBtn").addEventListener("click", () => {
    exportGraph(nodes, connections);
});
document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importInput").click();
});
document.getElementById("importInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      importGraph(file, createNode, drawConnections, nodes, connections);
    }
});
document.getElementById("saveBtn").addEventListener("click", () => {
    saveGraph(nodes, connections);
});
document.getElementById("loadBtn").addEventListener("click", () => {
    const data = localStorage.getItem("nodeGraphData");
    if (data) {
        importGraph(new Blob([data], { type: "application/json" }), createNode, drawConnections, nodes, connections);
    }
});

function worldToScreen(x, y) {
    return {
        x: translateX + x * scale,
        y: translateY + y * scale
    };
}
function screenToWorld(screenX, screenY) {
    return {
        x: (screenX - translateX) / scale,
        y: (screenY - translateY) / scale
    };
}

// script.js の末尾に追加

// --- 履歴操作（ショートカット） ---
document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
    }
});

// --- 操作検知による自動保存 ---

// 操作完了時（マウスボタンを離した時）に保存を試みる
// これにより、ドラッグ移動、結線、アセットドロップ、ボタンクリックによる生成などを一括カバーできます。
document.addEventListener("mouseup", () => {
    // setTimeoutを使う理由: 
    // アセットドロップ時などの処理（createNodeのループ）が完了し、
    // DOMが完全に更新された後に保存するため。
    setTimeout(saveState, 10);
});

// 削除操作（右クリックメニュー）時にも保存
document.addEventListener("contextmenu", () => {
    setTimeout(saveState, 10); 
});

// もしキーボード操作（Delキー等）で削除を実装している場合は以下も有効にしてください
/*
document.addEventListener("keyup", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
        setTimeout(saveState, 10);
    }
});
*/