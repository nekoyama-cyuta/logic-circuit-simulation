// script.js の冒頭付近

(function injectSelectionStyles(){
    const style = document.createElement('style');
    style.textContent = `
    .node.selected {
      outline: 3px solid #ffd700;
      box-shadow: 0 0 10px 3px rgba(255,215,0,0.6);
    }
    /* 追加: ラベル用スタイル */
    .node-label {
      pointer-events: none; /* クリックを透過させてノード本体で受け取る */
      user-select: none;
      font-weight: bold;
      font-size: 14px;
    }
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
let offsetX, offsetY; // 単体ドラッグで使うオフセット（スクリーン座標ベース）
let connectingFromPin = null; // ピン単位で接続するためのグローバル


// パンとズームのための変数
let translateX = 0;
let translateY = 0;
let scale = 1;
let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;

// --- マルチ選択用変数 ---
let isSelecting = false;
let selectionStartX = 0;
let selectionStartY = 0;
let selectionRectEl = null;
let selectedNodes = new Set();

// --- グループドラッグ用変数 ---
let isGroupDragging = false;
let groupStartMouseLogical = { x: 0, y: 0 };
let groupOriginalPositions = new Map(); // node -> {x,y}

(function injectSelectionStyles(){
    const style = document.createElement('style');
    style.textContent = `
    .node.selected {
      outline: 3px solid #ffd700;
      box-shadow: 0 0 10px 3px rgba(255,215,0,0.6);
    }
    #selectionRect {
      position: fixed;
      pointer-events: none;
      border: 1px dashed #00aaff;
      background: rgba(0,170,255,0.08);
      z-index: 9999;
    }`;
    document.head.appendChild(style);
})();

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    drawConnections();
}

function applyTransformToNodes() {
    // worldToScreen関数は既存のものを使用します
    nodes.forEach(node => {
        // 1. 現在のワールド座標（論理的な位置）を取得
        const logicalX = parseFloat(node.style.left || 0);
        const logicalY = parseFloat(node.style.top || 0);

        // 2. 画面上の目標座標（スクリーン座標）を計算
        // 式: Screen = Translate + World * Scale
        const screenPos = worldToScreen(logicalX, logicalY);

        // 3. 差分を計算して適用
        // ノードはCSSのleft/topですでに logicalX, logicalY に配置されています。
        // そのため、見た目を screenPos に移動させるための差分（delta）を計算します。
        const deltaX = screenPos.x - logicalX;
        const deltaY = screenPos.y - logicalY;

        // 4. 個別に変形を適用（GPUアクセラレーションが効くため高速です）
        node.style.transformOrigin = "0 0"; // 左上基準で拡大縮小
        node.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scale})`;
    });
}

// ノード同士の線を描画する
function drawConnections() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    connections.forEach(conn => {
        const fromPin = conn.from;
        const toPin = conn.to;
        if (!fromPin || !toPin) return;

        const fromNode = fromPin.closest('.node');
        const toNode = toPin.closest('.node');
        if (!fromNode || !toNode) return;

        const node1LogicalX = parseFloat(fromNode.style.left || 0);
        const node1LogicalY = parseFloat(fromNode.style.top || 0);
        const node2LogicalX = parseFloat(toNode.style.left || 0);
        const node2LogicalY = parseFloat(toNode.style.top || 0);

        const nodeWidth1 = fromNode.offsetWidth;
        const nodeHeight1 = fromNode.offsetHeight;
        const nodeWidth2 = toNode.offsetWidth;
        const nodeHeight2 = toNode.offsetHeight;

        const fromPinLogicalY = parseFloat(fromPin.style.top || 0);
        const toPinLogicalY = parseFloat(toPin.style.top || 0);

        let fromPos = worldToScreen(node1LogicalX + nodeWidth1, node1LogicalY + nodeHeight1 + fromPinLogicalY);
        let toPos   = worldToScreen(node2LogicalX,            node2LogicalY + nodeHeight2 + toPinLogicalY);

        // ▼ 変更箇所: 元ピンがHighになっているかチェック
        const isHigh = lastPinStates.get(fromPin) === true;

        // Highなら黄色、そうでなければ水色
        ctx.strokeStyle = isHigh ? "yellow" : "#00ffff";
        
        // 光っているときは線を少し太くするなどの演出もお好みで
        ctx.lineWidth = isHigh ? 3 : 2;
        
        ctx.beginPath();
        ctx.moveTo(fromPos.x, fromPos.y);
        ctx.lineTo(toPos.x, toPos.y);
        ctx.stroke();
    });
}

const NODE_TEMPLATES = {
  normal: { pins: [{name: 'IN', dir: 'in'}, {name: 'OUT', dir: 'out'}] }, // 任意
  and:    { pins: [{name:'A', dir:'in'}, {name:'B', dir:'in'}, {name:'OUT', dir:'out'}] },
  or:     { pins: [{name:'A', dir:'in'}, {name:'B', dir:'in'}, {name:'OUT', dir:'out'}] },
  not:    { pins: [{name:'IN', dir:'in'}, {name:'OUT', dir:'out'}] },
  xor:    { pins: [{name:'A', dir:'in'}, {name:'B', dir:'in'}, {name:'OUT', dir:'out'}] },
  positive: { pins: [{name:'OUT', dir:'out'}] }, // 電源（出力端子）
  negative: { pins: [{name:'IN', dir:'in'}] }    // 出力装置（入力端子）
};
function createNode(x, y, id = null, type = "normal", isAbsolute = true) {
    const node = document.createElement("div");
    node.className = "node";
    node.style.position = "absolute";

    if (isAbsolute) {
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
    } else {
        node.style.left = `${(x - translateX) / scale}px`;
        node.style.top = `${(y - translateY) / scale}px`;
    }

    node.dataset.id = id || `node_${Date.now()}_${Math.random()}`;
    node.dataset.type = type;

    // --- ラベル用要素の作成 (テキスト更新でピンを消さないため) ---
    const label = document.createElement("span");
    label.className = "node-label";
    node.appendChild(label);

    // 初期設定
    if (type === "positive") {
        // スイッチ初期状態はOFFとする（好みでtrueにしても可）
        node.dataset.isOn = "false";
        node.style.backgroundColor = "#550000"; // OFF時は暗い赤
        label.textContent = "SW: OFF";
        label.style.color = "#fff";
    } else if (type === "negative") {
        node.style.backgroundColor = "#000055";
        label.textContent = "OUT";
        label.style.color = "#fff";
    } else if (type === "and") {
        node.style.backgroundColor = "#ffa500";
        label.textContent = "AND";
    } else if (type === "or") {
        node.style.backgroundColor = "#90ee90";
        label.textContent = "OR";
    } else if (type === "not") {
        node.style.backgroundColor = "#ff69b4";
        label.textContent = "NOT";
    } else if (type === "xor") {
        node.style.backgroundColor = "#9370DB";
        label.textContent = "XOR";
    } else {
        label.textContent = "";
    }

    // 一旦 DOM に追加してから幅を測る
    document.getElementById("nodesContainer").appendChild(node);

    // ピン作成（テンプレート参照）
    const tpl = NODE_TEMPLATES[type] || NODE_TEMPLATES['normal'];
    const pinsContainer = document.createElement('div');
    pinsContainer.className = 'pinsContainer';
    node.appendChild(pinsContainer);

    // 先にピンを作る
    const pinEls = [];
    tpl.pins.forEach((p, idx) => {
        const pin = document.createElement('div');
        pin.className = `pin ${p.dir}`;
        pin.dataset.pinName = p.name;
        pin.dataset.pinDir = p.dir;
        pin.dataset.pinId = `${node.dataset.id}:${p.name}`;
        pin.title = p.name;
        pin.style.left = `0px`;
        pin.style.top = `0px`;
        pinsContainer.appendChild(pin);
        pinEls.push(pin);
    });

    // ピン位置計算
    const nodeWidth = node.offsetWidth || 100;
    const nodeHeight = node.offsetHeight || 40;
    const pinWidth = (pinEls[0] && pinEls[0].offsetWidth) || 12;
    const pinHeight = (pinEls[0] && pinEls[0].offsetHeight) || 12;
    const inCount = tpl.pins.filter(p => p.dir === 'in').length;
    const outCount = tpl.pins.filter(p => p.dir === 'out').length;

    let in_idx = 0;
    let out_idx = 0;
    
    const styles = window.getComputedStyle(node);
    const paddingLeft = parseFloat(styles.paddingLeft) || 0;

    pinEls.forEach((pin, idx) => {
        const p = tpl.pins[idx];
        if (p.dir === 'in') {
            const spacing = (nodeHeight) / Math.max(1, inCount + 1);
            const top = spacing * (in_idx + 1); 
            const left = -Math.ceil(pinWidth / 2) - paddingLeft;
            pin.style.left = `${left}px`;
            pin.style.top = `${-top}px`;
            in_idx++;
        } else {
            const spacing = nodeHeight / Math.max(1, outCount + 1);
            const top = spacing * (out_idx + 1) - (pinHeight / 2);
            const left = nodeWidth - Math.floor(pinWidth / 2) - paddingLeft;
            pin.style.left = `${left}px`;
            pin.style.top = `${-top}px`;
            out_idx++;
        }
    });

    // --- イベントリスナー ---

    // Positiveノード専用: クリックでON/OFF切り替え
    if (type === "positive") {
        let mouseDownPos = { x: 0, y: 0 };
        
        // ドラッグかクリックか判定するために開始位置を記録
        node.addEventListener("mousedown", (e) => {
            mouseDownPos = { x: e.clientX, y: e.clientY };
        });

        node.addEventListener("click", (e) => {
            if (e.target.closest('.toolbar') || e.target.closest('#assetBox') || e.target.classList.contains('pin')) {
                return;
            }//ピンとかは無視

            // マウスがほとんど動いていなければ「クリック」とみなす
            const moveDist = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
            if (moveDist < 5) {
                const currentState = node.dataset.isOn === "true";
                const newState = !currentState;
                node.dataset.isOn = newState.toString();

                // 見た目の更新
                const lbl = node.querySelector('.node-label');
                if (newState) {
                    node.style.backgroundColor = "red"; // ON
                    node.style.boxShadow = "0 0 15px 5px rgba(255, 0, 0, 0.8)"; // 発光
                    if(lbl) lbl.textContent = "SW: ON";
                } else {
                    node.style.backgroundColor = "#550000"; // OFF
                    node.style.boxShadow = "";
                    if(lbl) lbl.textContent = "SW: OFF";
                }
                
                // (オプション) クリック時に即座に再計算したい場合はここで呼ぶ
                simulateElectricFlow(connections, nodes);
            }
        });
    }

    // 共通: mousedown (ピン接続 or ノード選択/ドラッグ)
    node.addEventListener("mousedown", (e) => {
        e.stopPropagation();

        if (e.target.classList && e.target.classList.contains('pin')) {
            const pin = e.target;
            if (connectingFromPin === null) {
                connectingFromPin = pin;
                pin.style.outline = "2px solid yellow";
            } else {
                if (connectingFromPin !== pin) {
                    const fromDir = connectingFromPin.dataset.pinDir;
                    const toDir = pin.dataset.pinDir;
                    if (fromDir === 'out' && toDir === 'in') {
                        connections.push({ from: connectingFromPin, to: pin });
                    } else if (fromDir === 'in' && toDir === 'out') {
                        connections.push({ from: pin, to: connectingFromPin });
                    }
                }
                connectingFromPin.style.outline = "";
                connectingFromPin = null;
                drawConnections();
            }
            return;
        }

        if (!selectedNodes.has(node)) {
            clearSelection();
            selectedNodes.add(node);
            node.classList.add('selected');
            activeNode = node;
            offsetX = e.clientX - node.getBoundingClientRect().left;
            offsetY = e.clientY - node.getBoundingClientRect().top;
            node.style.cursor = "grabbing";
            isGroupDragging = false;
        } else {
            isGroupDragging = true;
            activeNode = node;
            groupStartMouseLogical.x = (e.clientX - translateX) / scale;
            groupStartMouseLogical.y = (e.clientY - translateY) / scale;
            groupOriginalPositions.clear();
            selectedNodes.forEach(n => {
                groupOriginalPositions.set(n, {
                    x: parseFloat(n.style.left || 0),
                    y: parseFloat(n.style.top || 0)
                });
            });
            node.style.cursor = "grabbing";
        }
    });

    // 右クリック削除
    node.addEventListener("contextmenu", (e) => {
        if(selectedNodes.size == 1){
            e.preventDefault();
            connections = connections.filter(conn => {
                const fNode = conn.from.closest('.node');
                const tNode = conn.to.closest('.node');
                return fNode !== node && tNode !== node;
            });
            nodes = nodes.filter(n => n !== node);
            node.remove();
        } else if(selectedNodes.size > 1){
            selected_e = nodes.filter(n => selectedNodes.has(n));
            selected_e.forEach(node => {
                node.remove();
                connections = connections.filter(conn => {
                    const fNode = conn.from.closest('.node');
                    const tNode = conn.to.closest('.node');
                    return fNode !== node && tNode !== node;
                });
            });
        } else
            return;

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
    // 1. ピンの信号状態を保持
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
                    // 【変更点】単純な true ではなく、スイッチの状態(isOn)を見る
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
                case 'negative':
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

    // 3. 描画への反映
    const poweredNodeIds = new Set();

    nodes.forEach(node => {
        const type = node.dataset.type;
        let isPowered = false;

        if (type === 'negative') {
            const inPin = node.querySelector(`.pin[data-pin-name="IN"]`);
            const drivingConn = connections.find(c => c.to === inPin && pinStates.get(c.from) === true);
            isPowered = !!drivingConn;
        } else {
            const outPin = node.querySelector(`.pin[data-pin-name="OUT"]`);
            // Positiveもここで判定される（出力がONなら光る）
            if (outPin && pinStates.get(outPin) === true) {
                isPowered = true;
            }
        }

        if (isPowered) {
            poweredNodeIds.add(node.dataset.id);
            if (type === 'positive') {
                // スイッチONの見た目は click イベント側でも制御しているが、
                // シミュレーション実行時に確実に光らせる
                node.style.boxShadow = "0 0 15px 5px rgba(255, 50, 50, 0.8)";
                node.style.backgroundColor = "red";
            } else if (type === 'negative') {
                node.style.boxShadow = "0 0 15px 5px rgba(50, 50, 255, 0.8)";
                node.style.backgroundColor = "blue";
            } else {
                 node.style.boxShadow = "0 0 10px 2px rgba(255, 255, 0, 0.6)";
            }
        } else {
            // OFFの場合
            if (type === 'positive') {
                node.style.boxShadow = "";
                node.style.backgroundColor = "#550000";
            } else if (type === 'negative') {
                node.style.boxShadow = "";
                node.style.backgroundColor = "#000055";
            } else {
                node.style.boxShadow = "";
            }
        }
    });

    // 今回の計算結果をグローバル変数に保存
    lastPinStates = pinStates;

    // ワイヤーを再描画 (引数なしで呼び出す)
    drawConnections();
}

// --- イベントリスナー ---
document.addEventListener("mousedown", (e) => {
    //UI (toolbar, assetBox) 上でのクリックはパン移動のトリガーにしない
    if (e.target.closest('.toolbar') || e.target.closest('#assetBox')) {
        return;
    }

    // 既存のパン判定（ノード上ではない、Ctrl押してない、左ボタン）
    if (!activeNode && !e.ctrlKey && e.button === 0 && !e.target.closest('.button-container')) {
        isPanning = true;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = 'none';
        e.preventDefault();
        return;
    }

    // Ctrl + 空白領域 で選択矩形開始
    if (e.ctrlKey && e.button === 0 && !e.target.closest('.node') && !e.target.closest('.button-container')) {
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
        // グループドラッグ：マウスの現在ワールド座標と開始ワールド座標の差を計算して全選択ノードに適用
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
        // 単体ドラッグ処理（既存）
        const newLogicalX = (e.clientX - offsetX - translateX) / scale;
        const newLogicalY = (e.clientY - offsetY - translateY) / scale;
        activeNode.style.left = `${newLogicalX}px`;
        activeNode.style.top = `${newLogicalY}px`;
        applyTransformToNodes();
        drawConnections();
        return;
    }

    if (isPanning) {
        const dx = e.clientX - lastPanX;
        const dy = e.clientY - lastPanY;
        translateX += dx;
        translateY += dy;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        resizeCanvas();
        applyTransformToNodes();
        drawConnections();
        return;
    }

    if (isSelecting && selectionRectEl) {
        const x1 = selectionStartX;
        const y1 = selectionStartY;
        const x2 = e.clientX;
        const y2 = e.clientY;
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        selectionRectEl.style.left = `${left}px`;
        selectionRectEl.style.top = `${top}px`;
        selectionRectEl.style.width = `${width}px`;
        selectionRectEl.style.height = `${height}px`;

        const worldLeft = (left - translateX) / scale;
        const worldTop = (top - translateY) / scale;
        const worldWidth = width / scale;
        const worldHeight = height / scale;

        nodes.forEach(n => {
            const nx = parseFloat(n.style.left || 0);
            const ny = parseFloat(n.style.top || 0);
            const nw = n.offsetWidth;
            const nh = n.offsetHeight;
            if (rectsIntersect(worldLeft, worldTop, worldWidth, worldHeight, nx, ny, nw, nh)) {
                if (!selectedNodes.has(n)) {
                    selectedNodes.add(n);
                    n.classList.add('selected');
                }
            } else {
                if (selectedNodes.has(n)) {
                    selectedNodes.delete(n);
                    n.classList.remove('selected');
                }
            }
        });
        return;
    }
});

document.addEventListener("mouseup", (e) => {
    // ドラッグ終了処理
    if (activeNode) activeNode.style.cursor = "grab";
    activeNode = null;
    isPanning = false;
    document.body.style.cursor = "default";
    document.body.style.userSelect = '';

    // 選択矩形の終了
    if (isSelecting) {
        if (selectionRectEl && selectionRectEl.parentNode) selectionRectEl.remove();
        selectionRectEl = null;
        isSelecting = false;
    }

    // グループドラッグ終了
    if (isGroupDragging) {
        // ドロップ先がassetBoxなら保存処理を実行
        handleDropToAssetBox(e.clientX, e.clientY);
        isGroupDragging = false;
        groupOriginalPositions.clear();
    }
});

document.addEventListener("wheel", (e) => {
  // 1. アセットリスト上でのホイール操作の場合
  //    -> e.preventDefault() せずリターンすることで、ブラウザ標準のスクロールバー操作を有効にする
  if (e.target.closest('#assetList')) {
      return;
  }

  // 2. その他のUI (ツールバーやアセットボックスのリスト以外) 上の場合
  //    -> ズーム処理は行わず、何もしないで終了
  if (e.target.closest('.toolbar') || e.target.closest('#assetBox')) {
      return;
  }

  // 3. キャンバス上での操作 -> ズーム実行
  e.preventDefault();
  const scaleAmount = 1.1;
  const mouseX = e.clientX, mouseY = e.clientY;
  const oldScale = scale;
  scale *= e.deltaY < 0 ? scaleAmount : 1 / scaleAmount;
  translateX = mouseX - ((mouseX - translateX) / oldScale) * scale;
  translateY = mouseY - ((mouseY - translateY) / oldScale) * scale;
  applyTransformToNodes();
  resizeCanvas();
  drawConnections();
}, { passive: false });


// dblclick は既に修正済みのロジックが含まれていればそのままでOK
document.addEventListener("dblclick", (e) => {
    if (e.target.closest('.node') || e.target.closest('.toolbar') || e.target.closest('#assetBox')) {
        return;
    }
    createNode(e.clientX, e.clientY, null, "normal", false);
});

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ボタン群（既存）
document.getElementById("addPositivePower").addEventListener("click", () => {
    createNode((window.innerWidth/2-translateX) / scale, (window.innerHeight/2-translateY) / scale, null, "positive");
});
document.getElementById("addNegativePower").addEventListener("click", () => {
    createNode((window.innerWidth/2-translateX) / scale, (window.innerHeight/2-translateY) / scale, null, "negative");
});
// document.getElementById("simulateBtn").addEventListener("click", () => {
//     simulateElectricFlow(connections, nodes);
// });
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
document.getElementById("addAndGate").addEventListener("click", () => {
    createNode((window.innerWidth/2-translateX) / scale, (window.innerHeight/2-translateY) / scale, null, "and");
});
document.getElementById("addOrGate").addEventListener("click", () => {
    createNode((window.innerWidth/2-translateX) / scale, (window.innerHeight/2-translateY) / scale, null, "or");
});
document.getElementById("addNotGate").addEventListener("click", () => {
    createNode((window.innerWidth/2-translateX) / scale, (window.innerHeight/2-translateY) / scale, null, "not");
});
document.getElementById("addXorGate").addEventListener("click", () => {
    createNode((window.innerWidth/2-translateX) / scale, (window.innerHeight/2-translateY) / scale, null, "xor");
});














// --- Assetドロップ連携用 ---
const assetBoxEl = document.getElementById('assetBox');
const assetDropHoverClass = 'asset-drop-hover';

// 安全確認：asset.js が読み込まれてるか簡易チェック（関数存在チェック）
const canSaveAsset = typeof saveNodesAsAsset === 'function';
if (!assetBoxEl) {
  console.warn('assetBox 要素が見つかりません。id="assetBox" の要素を確認して下さい。');
}
if (!canSaveAsset) {
  console.warn('saveNodesAsAsset が見つかりません。asset.js を読み込んでください。');
}

// 補助関数：マウス位置が assetBox 上か判定
function isPointerOverAssetBox(clientX, clientY) {
  if (!assetBoxEl) return false;
  const rect = assetBoxEl.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

// 補助：選択ノード群を asset に適した形に変換
function collectSelectedNodeData() {
  // nodes の left/top はワールド座標（style.left/style.top）で保存している前提
  return Array.from(selectedNodes).map(n => ({
    x: parseFloat(n.style.left || 0),
    y: parseFloat(n.style.top || 0),
    type: n.dataset.type || 'normal'
  }));
}

// グループドラッグ中に assetBox に被っていたらホバークラス付与
// 既存の mousemove の isGroupDragging 分岐内で以下を呼ぶか、ここでグローバルに扱う
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




// --- script.js に追加／置換する部分 ---

// 選択ノード群を asset に適した形に変換（ノード配列と接続配列を返す）
// script.js
function collectSelectedNodeDataWithConnections() {
  if (!selectedNodes || selectedNodes.size === 0) return { nodes: [], connections: [] };

  const nodeElems = Array.from(selectedNodes);
  // ノード情報の収集
  const nodesData = nodeElems.map(n => ({
    x: parseFloat(n.style.left || 0),
    y: parseFloat(n.style.top || 0),
    type: n.dataset.type || 'normal'
  }));

  // ノード要素 -> インデックスのマップ
  const nodeIndexMap = new Map();
  nodeElems.forEach((el, i) => nodeIndexMap.set(el, i));

  const connectionsData = [];

  // 接続情報の収集
  connections.forEach(conn => {
    const fromNode = conn.from.closest('.node');
    const toNode = conn.to.closest('.node');

    // 接続の両端が、今回選択されたノード群に含まれている場合のみ保存
    if (nodeIndexMap.has(fromNode) && nodeIndexMap.has(toNode)) {
      // ピン名を取得 (dataset.pinName が無い場合の対策も含む)
      const fromPinName = conn.from.dataset.pinName || conn.from.getAttribute('title');
      const toPinName = conn.to.dataset.pinName || conn.to.getAttribute('title');

      connectionsData.push({
        from: nodeIndexMap.get(fromNode),
        fromPin: fromPinName, // ピン名を明示的に保存
        to: nodeIndexMap.get(toNode),
        toPin: toPinName      // ピン名を明示的に保存
      });
    }
  });

  return { nodes: nodesData, connections: connectionsData };
}

// ドロップ処理（mouse up 時に呼ばれる）を修正して、connections 情報も渡す
function handleDropToAssetBox(clientX, clientY) {
  if (!assetBoxEl || !canSaveAsset) return false;
  if (!selectedNodes || selectedNodes.size === 0) return false;

  const over = isPointerOverAssetBox(clientX, clientY);
  console.log('handleDropToAssetBox check:', {clientX, clientY, over});
  if (!over) {
    assetBoxEl.classList.remove(assetDropHoverClass);
    return false;
  }

  // ノードと接続情報を収集
  const data = collectSelectedNodeDataWithConnections();
  if (!data.nodes.length) {
    console.warn('ドロップ時に保存するノードがありません。');
    return false;
  }

  const name = window.prompt('Asset名を入力（キャンセルで自動名）:', '');
  // saveNodesAsAsset の新しいシグネチャ: (name, nodesArray, connectionsArray)
  saveNodesAsAsset(name, data.nodes, data.connections);

  assetBoxEl.classList.remove(assetDropHoverClass);
  console.log(`Saved asset: ${data.nodes.length} nodes, ${data.connections.length} connections`);
  return true;
}

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