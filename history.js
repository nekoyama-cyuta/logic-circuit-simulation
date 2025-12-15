// history.js

const historyState = {
    stack: [],
    index: -1,
    isRestoring: false,
    lastSavedJson: "" // 直前の保存データを保持して比較に使う
};

// 保存を実行する（差分がある場合のみ）
function saveState() {
    // Undo/Redoによる復元中は保存しない
    if (historyState.isRestoring) return;

    // 現在の状態をJSON化
    const currentJson = serializeGraph();

    // 直前の状態と全く同じなら保存しない（無駄な保存を回避）
    if (currentJson === historyState.lastSavedJson) {
        return;
    }

    // 未来の履歴（Redo分）を削除して新しい履歴を追加
    if (historyState.index < historyState.stack.length - 1) {
        historyState.stack.length = historyState.index + 1;
    }

    historyState.stack.push(currentJson);
    historyState.index++;
    historyState.lastSavedJson = currentJson;

    // 履歴スタックの上限（例:50回分）
    if (historyState.stack.length > 50) {
        historyState.stack.shift();
        historyState.index--;
    }
}

// グラフの状態をJSON文字列化
function serializeGraph() {
    const nodesData = nodes.map(n => ({
        id: n.dataset.id,
        x: parseFloat(n.style.left || 0),
        y: parseFloat(n.style.top || 0),
        type: n.dataset.type || "normal",
        isOn: n.dataset.isOn // スイッチの状態
    }));

    const connectionsData = connections.map(c => {
        const fromNode = c.from.closest('.node');
        const toNode = c.to.closest('.node');
        if (!fromNode || !toNode) return null;
        return {
            from: `${fromNode.dataset.id}:${c.from.dataset.pinName}`,
            to: `${toNode.dataset.id}:${c.to.dataset.pinName}`
        };
    }).filter(Boolean);

    // 順番が違っても同じとみなすためにソートしても良いですが、
    // ここでは単純な文字列化のみ行います
    return JSON.stringify({ nodes: nodesData, connections: connectionsData });
}

// Undo (Ctrl+Z)
function undo() {
    if (historyState.index <= 0) return;
    historyState.index--;
    restoreState(historyState.stack[historyState.index]);
}

// Redo (Ctrl+Y)
function redo() {
    if (historyState.index >= historyState.stack.length - 1) return;
    historyState.index++;
    restoreState(historyState.stack[historyState.index]);
}

// 復元処理
function restoreState(jsonString) {
    if (!jsonString) return;
    
    historyState.isRestoring = true;
    try {
        const data = JSON.parse(jsonString);
        
        // 1. ノードと接続を復元（この時点ではスイッチはOFFの初期状態）
        loadGraphFromData(data, createNode, drawConnections, nodes, connections);
        
        // 2. ★追加: スイッチの状態を個別に復元
        if (data.nodes) {
            data.nodes.forEach(nodeData => {
                // typeがpositiveで、かつONとして保存されていた場合
                if (nodeData.type === 'positive' && nodeData.isOn === "true") {
                    // IDで復元されたノードを探す
                    const node = nodes.find(n => n.dataset.id === nodeData.id);
                    if (node) {
                        // 状態を書き戻す
                        node.dataset.isOn = "true";
                        // script.js で追加したイベントを発火させて見た目を更新
                        node.dispatchEvent(new Event("updateVisual"));
                    }
                }
            });
        }

        // 3. 最後に回路全体の電気の流れを再計算
        if (typeof simulateElectricFlow === "function") {
            simulateElectricFlow(connections, nodes);
        } else {
            drawConnections();
        }

        historyState.lastSavedJson = jsonString;
    } catch (e) {
        console.error("Undo/Redo Error:", e);
    } finally {
        historyState.isRestoring = false;
    }
}

// 初期化
window.addEventListener('load', () => {
    // 画面ロード完了後の初期状態を保存
    setTimeout(saveState, 200);
});