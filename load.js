// load.js

function loadGraph(createNode, drawConnections, nodesRef, connectionsRef) {
    const raw = localStorage.getItem("nodeGraphData");
    if (!raw) {
      alert("保存データがありません");
      return;
    }
    try {
        const data = JSON.parse(raw);
        loadGraphFromData(data, createNode, drawConnections, nodesRef, connectionsRef);
    } catch(e) {
        console.error(e);
        alert("データの読み込みに失敗しました");
    }
  }
  
function importGraph(file, createNode, drawConnections, nodesRef, connectionsRef) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      loadGraphFromData(data, createNode, drawConnections, nodesRef, connectionsRef);
    } catch (e) {
      console.error(e);
      alert("JSONファイルの読み込みに失敗しました。");
    }
  };
  reader.readAsText(file);
}
  
function loadGraphFromData(data, createNode, drawConnections, nodesRef, connectionsRef) {
  // 既存ノードと接続を削除
  nodesRef.forEach(n => n.remove());
  nodesRef.length = 0;
  connectionsRef.length = 0;

  const idToNode = new Map();

  // 1. ノードを再生成
  if (Array.isArray(data.nodes)) {
      data.nodes.forEach(n => {
        // createNode(x, y, id, type)
        const node = createNode(n.x, n.y, n.id, n.type || "normal");
        idToNode.set(n.id, node);
      });
  }

  // 2. 接続を復元
  if (Array.isArray(data.connections)) {
    data.connections.forEach(c => {
      // ID解析ヘルパー
      const parseInfo = (str) => {
        if (!str || typeof str !== 'string') return { nodeId: null, pinName: null };
        
        // "nodeID:pinName" 形式かチェック
        if (str.includes(':')) {
            const parts = str.split(':');
            const pinName = parts.pop();
            const nodeId = parts.join(':');
            return { nodeId, pinName };
        } else {
            // 古い形式（IDのみ）の場合
            return { nodeId: str, pinName: null };
        }
      };

      const fromInfo = parseInfo(c.from);
      const toInfo = parseInfo(c.to);

      const fromNode = idToNode.get(fromInfo.nodeId);
      const toNode = idToNode.get(toInfo.nodeId);

      if (fromNode && toNode) {
          // ピンを探す関数
          const findPin = (node, pinName, dirFallback) => {
              // 1. 名前で完全一致検索
              if (pinName) {
                  const p = node.querySelector(`.pin[data-pin-name="${pinName}"]`);
                  if (p) return p;
              }
              // 2. 名前で見つからない、または名前がない場合、方向(in/out)で最初に見つかったものを返す（救済措置）
              return node.querySelector(`.pin[data-pin-dir="${dirFallback}"]`);
          };

          const fromPin = findPin(fromNode, fromInfo.pinName, 'out');
          const toPin = findPin(toNode, toInfo.pinName, 'in');

          if (fromPin && toPin) {
            connectionsRef.push({ from: fromPin, to: toPin });
          } else {
              console.warn("Connection skipped: pin not found", c);
          }
      }
    });
  }

  // 再描画
  drawConnections();
}