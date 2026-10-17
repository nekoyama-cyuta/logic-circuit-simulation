// ui.js — ダイアログ（alert/prompt/confirm の代わり）とトースト通知
(function (root) {
  'use strict';

  const dialog = document.getElementById('dialog');
  let toastTimer = null;

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : String(c));
    return el;
  }

  /**
   * 汎用モーダル。buttons: [{ label, value, primary }]
   * 戻り値は押されたボタンの value（Esc / 背景クリックは null）
   */
  function open({ title, body, buttons = [{ label: '閉じる', value: true, primary: true }], wide = false, danger = false, onOpen }) {
    return new Promise((resolve) => {
      dialog.className = [wide && 'wide', danger && 'danger'].filter(Boolean).join(' ');
      dialog.replaceChildren();
      const form = h('form', { method: 'dialog' });
      if (title) form.append(h('h2', {}, title));
      const content = h('div', { class: 'dialog-body' });
      if (body) content.append(body);
      form.append(content);
      const bar = h('div', { class: 'dialog-buttons' });
      for (const b of buttons) {
        bar.append(h('button', { type: 'submit', value: String(b.value), class: b.primary ? 'primary' : '' }, b.label));
      }
      form.append(bar);
      dialog.append(form);

      const finish = () => {
        dialog.removeEventListener('close', finish);
        const rv = dialog.returnValue;
        const hit = buttons.find((b) => String(b.value) === rv);
        resolve(hit ? hit.value : null);
      };
      dialog.returnValue = '';
      dialog.addEventListener('close', finish);
      dialog.showModal();
      if (onOpen) onOpen(form);
    });
  }

  // 背景クリックで閉じる
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close('');
  });

  async function prompt(title, value = '', { placeholder = '', type = 'text', hint = '' } = {}) {
    const input = h('input', { type, value, placeholder, class: 'dialog-input', autocomplete: 'off' });
    const body = h('div', {}, input, hint ? h('p', { class: 'muted' }, hint) : null);
    let typed = value;
    input.addEventListener('input', () => { typed = input.value; });
    // Enter は OK（フォームの既定ボタンは先頭の「キャンセル」なので自前で処理）
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); dialog.close('true'); }
    });
    const ok = await open({
      title, body,
      buttons: [{ label: 'キャンセル', value: false }, { label: 'OK', value: true, primary: true }],
      onOpen: () => { input.focus(); input.select(); },
    });
    return ok ? typed : null;
  }

  async function confirm(message, { okLabel = 'OK', danger = false } = {}) {
    const ok = await open({
      title: '確認',
      body: h('p', {}, message),
      buttons: [{ label: 'キャンセル', value: false }, { label: okLabel, value: true, primary: true }],
      danger,
    });
    return ok === true;
  }

  function isOpen() { return dialog.open; }

  function toast(message, kind = 'info') {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 2600);
  }

  root.LogicSim.ui = { h, open, prompt, confirm, isOpen, toast };
})(window);
