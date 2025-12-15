// save.js

function saveGraph(nodes, connections) {
  const data = {
    nodes: nodes.map(n => ({
      id: n.dataset.id,
      x: parseFloat(n.style.left),
      y: parseFloat(n.style.top),
      type: n.dataset.type || "normal",
    })),
    connections: connections.map(c => ({
      // 【修正】 dataset.id ではなく dataset.pinId を使う
      from: c.from.dataset.pinId,
      to: c.to.dataset.pinId,
    }))
  };
  localStorage.setItem("nodeGraphData", JSON.stringify(data));
  alert("保存しました！");
}

// JSONファイルとして保存
function exportGraph(nodes, connections) {
  const data = {
    nodes: nodes.map(n => ({
      id: n.dataset.id,
      x: parseFloat(n.style.left),
      y: parseFloat(n.style.top),
      type: n.dataset.type || "normal",
    })),
    connections: connections.map(c => ({
      // 【修正】 dataset.id ではなく dataset.pinId を使う
      from: c.from.dataset.pinId,
      to: c.to.dataset.pinId,
    }))
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nodeGraph.json";
  a.click();
  URL.revokeObjectURL(url);
}