// assets.js — アセット（回路部品集）の保存とパネル表示
(function (root) {
  'use strict';
  const LS = root.LogicSim;
  const { sanitizeAsset, shapes, ui } = LS;

  const STORAGE_KEY = 'logicsim.assets.v2';
  const LEGACY_KEY = 'assetCircuitsData';
  const DND_TYPE = 'application/x-logicsim';

  function readStorage(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  class AssetLibrary {
    constructor(starter = []) {
      this.starter = starter;
      this.items = [];
      this.load();
    }

    load() {
      const raw = readStorage(STORAGE_KEY) ?? readStorage(LEGACY_KEY);
      let list = null;
      if (raw) {
        try { list = JSON.parse(raw); } catch (e) { list = null; }
      }
      if (!Array.isArray(list)) list = this.starter;
      this.items = list.map(sanitizeAsset).filter(Boolean);
      this.save();
    }

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
        return true;
      } catch (e) {
        ui.toast('アセットを保存できませんでした（ブラウザの保存領域を確認してください）', 'error');
        return false;
      }
    }

    add(asset) {
      const a = sanitizeAsset(asset);
      if (!a) return null;
      this.items.push(a);
      this.save();
      return a;
    }

    remove(index) {
      this.items.splice(index, 1);
      this.save();
    }

    rename(index, name) {
      if (!this.items[index] || !name.trim()) return;
      this.items[index].name = name.trim();
      this.save();
    }

    /** 読み込んだ配列を追加する。追加できた件数を返す */
    importItems(list) {
      if (!Array.isArray(list)) return 0;
      const ok = list.map(sanitizeAsset).filter(Boolean);
      this.items.push(...ok);
      this.save();
      return ok.length;
    }

    /** 標準アセットのうち、同名のものが無いものを追加する */
    restoreStarter() {
      const names = new Set(this.items.map((a) => a.name));
      const missing = this.starter.filter((a) => !names.has(a.name));
      return this.importItems(missing);
    }

    toJSON() { return this.items; }
  }

  class AssetPanel {
    constructor({ library, listEl, previewEl, onPlace, getWireStyle }) {
      this.lib = library;
      this.listEl = listEl;
      this.previewEl = previewEl;
      this.onPlace = onPlace;
      this.getWireStyle = getWireStyle;
    }

    render() {
      const { h } = ui;
      this.listEl.replaceChildren();
      if (!this.lib.items.length) {
        this.listEl.append(h('div', { class: 'asset-empty' }, 'アセットはまだありません。部品を選択して、このパネルへドラッグすると登録できます。'));
        return;
      }
      this.lib.items.forEach((asset, index) => {
        const item = h('div', {
          class: 'asset-item', draggable: 'true', title: 'ドラッグで配置 / ダブルクリックで中央に配置',
        },
        h('span', { class: 'asset-name' }, asset.name),
        h('span', { class: 'asset-info' }, `${asset.nodes.length}個`),
        h('button', {
          class: 'icon-btn', type: 'button', title: '名前を変更', 'aria-label': '名前を変更',
          onclick: async (e) => {
            e.stopPropagation();
            const name = await ui.prompt('アセット名を変更', asset.name);
            if (name && name.trim()) { this.lib.rename(index, name); this.render(); }
          },
        }, '✎'),
        h('button', {
          class: 'icon-btn danger', type: 'button', title: '削除', 'aria-label': '削除',
          onclick: async (e) => {
            e.stopPropagation();
            this.hidePreview();
            if (await ui.confirm(`アセット「${asset.name}」を削除しますか？`, { okLabel: '削除', danger: true })) {
              this.lib.remove(index);
              this.render();
            }
          },
        }, '🗑'));

        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: 'asset', index }));
          e.dataTransfer.effectAllowed = 'copy';
          this.hidePreview();
        });
        item.addEventListener('dblclick', (e) => {
          if (e.target.closest('button')) return;
          this.onPlace(asset);
        });
        item.addEventListener('mouseenter', () => this.showPreview(asset, item));
        item.addEventListener('mouseleave', () => this.hidePreview());
        this.listEl.append(item);
      });
    }

    showPreview(asset, item) {
      const el = this.previewEl;
      el.innerHTML = shapes.previewSVG(asset, this.getWireStyle());
      const cap = document.createElement('div');
      cap.className = 'preview-caption';
      cap.textContent = asset.name;
      el.prepend(cap);
      const r = item.getBoundingClientRect();
      el.style.display = 'block';
      const top = Math.min(Math.max(8, r.top - 40), window.innerHeight - el.offsetHeight - 8);
      el.style.left = `${r.right + 12}px`;
      el.style.top = `${top}px`;
    }

    hidePreview() { this.previewEl.style.display = 'none'; }
  }

  Object.assign(LS, { AssetLibrary, AssetPanel, DND_TYPE });
})(window);
