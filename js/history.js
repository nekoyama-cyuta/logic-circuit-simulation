// history.js — 元に戻す / やり直し（スナップショット方式）
//
// スイッチの ON/OFF は「操作」であって「編集」ではないので、履歴の差分判定から除外する。
// 復元時も、現在存在するスイッチの ON/OFF はそのまま維持する。
(function (root) {
  'use strict';

  function structureKey(data) {
    return JSON.stringify({
      nodes: data.nodes.map(({ on, ...rest }) => rest),
      wires: data.wires,
    });
  }

  class History {
    constructor(limit = 200) {
      this.limit = limit;
      this.reset(null);
    }

    reset(data) {
      this.stack = data ? [{ key: structureKey(data), json: JSON.stringify(data) }] : [];
      this.index = this.stack.length - 1;
    }

    /** 変更があれば記録する。記録したら true */
    push(data) {
      const key = structureKey(data);
      if (this.index >= 0 && this.stack[this.index].key === key) return false;
      this.stack.length = this.index + 1;
      this.stack.push({ key, json: JSON.stringify(data) });
      if (this.stack.length > this.limit) this.stack.shift();
      this.index = this.stack.length - 1;
      return true;
    }

    canUndo() { return this.index > 0; }
    canRedo() { return this.index < this.stack.length - 1; }

    undo() {
      if (!this.canUndo()) return null;
      return JSON.parse(this.stack[--this.index].json);
    }

    redo() {
      if (!this.canRedo()) return null;
      return JSON.parse(this.stack[++this.index].json);
    }
  }

  root.LogicSim.History = History;
})(window);
