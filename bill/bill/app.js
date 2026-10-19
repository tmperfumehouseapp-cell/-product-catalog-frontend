/* Order Ledger: all browser code in one file. Plain JavaScript, no libraries.
 * Pages build their screens with App.el() and never put server text into innerHTML,
 * so customer names, notes and references can never run as code. */
/* Order Ledger: shared browser code. Plain JavaScript, no libraries.
 * Pages build their screens with App.el() and never put server text into innerHTML,
 * so customer names, notes and references can never run as code. */
(function () {
  'use strict';

  const App = (window.App = {});
  App.csrf = '';
  App.user = null;
  App.env = 'test';
  App.today = '';
  App.appName = 'Order Ledger';

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                        */
  /* ------------------------------------------------------------------ */

  function appendKid(node, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) {
      kid.forEach((k) => appendKid(node, k));
    } else if (kid.nodeType) {
      node.appendChild(kid);
    } else {
      node.appendChild(document.createTextNode(String(kid)));
    }
  }

  /** el('div', {class: 'x', onclick: fn, text: 'hi'}, child, child) */
  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    let value;
    let hasValue = false;
    let checked = false;
    let hasChecked = false;
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const v = attrs[key];
        if (v === null || v === undefined || v === false) continue;
        if (key === 'class') node.className = v;
        else if (key === 'text') node.textContent = v;
        else if (key === 'value') { value = v; hasValue = true; }
        else if (key === 'checked') { checked = !!v; hasChecked = true; }
        else if (key === 'style') Object.assign(node.style, v);
        else if (key === 'dataset') Object.assign(node.dataset, v);
        else if (key.startsWith('on') && typeof v === 'function') node.addEventListener(key.slice(2), v);
        else node.setAttribute(key, v === true ? '' : String(v));
      }
    }
    kids.forEach((k) => appendKid(node, k));
    if (hasValue) node.value = value;
    if (hasChecked) node.checked = checked;
    return node;
  }
  App.el = el;

  App.clear = function (node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  };

  App.mount = function (node, ...kids) {
    App.clear(node);
    kids.forEach((k) => appendKid(node, k));
    return node;
  };

  App.debounce = function (fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  const store = {
    get(k) { try { return window.localStorage.getItem('ledger_' + k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem('ledger_' + k, v); } catch (e) { /* storage is optional */ } },
  };
  App.store = store;

  /* ------------------------------------------------------------------ */
  /* Server calls                                                       */
  /* ------------------------------------------------------------------ */

  function apiError(message, status) {
    const e = new Error(message);
    e.status = status;
    return e;
  }

  /** App.api('api/x.php', {params: {...}})  for GET,  App.api('api/x.php', {body: {...}})  for POST. */
  /* ---- the only setting: where api.php lives (on Hostinger). The page itself can be anywhere:
     Live Server on your computer, this same site, or a subdomain. Nothing else to change. ---- */
  App.API_URL = 'https://fourpirates.tmfragrance.com/visitor/product-api/bill/api.php';
  App.API_DIR = App.API_URL.replace(/[^/]+$/, '');

  App.api = async function (url, opts) {
    opts = opts || {};
    const init = { method: opts.body ? 'POST' : 'GET', credentials: 'omit', headers: { Accept: 'application/json' } };
    const sid = store.get('sid');
    if (sid) init.headers['X-Ledger-Session'] = sid;
    if (opts.body) {
      init.headers['Content-Type'] = 'application/json';
      init.headers['X-CSRF-Token'] = App.csrf;
      init.body = JSON.stringify(opts.body);
    }
    const m = /^api\/(\w+)\.php$/.exec(url);
    const base = m ? App.API_URL + '?r=' + m[1] : url;
    let query = '';
    if (opts.params) {
      const usp = new URLSearchParams();
      Object.keys(opts.params).forEach((k) => {
        const v = opts.params[k];
        if (v !== '' && v !== null && v !== undefined && v !== false) usp.set(k, String(v));
      });
      query = usp.toString() ? (m ? '&' : '?') + usp.toString() : '';
    }

    let res;
    try {
      res = await fetch(base + query, init);
    } catch (e) {
      throw apiError('Cannot reach the server. Check your internet connection.', 0);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* handled below */ }
    if (!json && /^\s*<\?php/.test(text)) throw apiError('The server is showing the code of api.php instead of running it. PHP is not working at ' + App.API_URL, 0);
    if (!json) throw apiError('The server sent an unexpected reply (' + res.status + ').', res.status);
    if (!res.ok || !json.ok) throw apiError(json.error || 'Request failed.', res.status);
    if (json.data && typeof json.data === 'object' && typeof json.data.sid === 'string' && json.data.sid) store.set('sid', json.data.sid);
    return json.data;
  };

  /* ------------------------------------------------------------------ */
  /* Money, dates, labels                                               */
  /* ------------------------------------------------------------------ */

  /** 8425000 paise -> "₹84,250" (Indian digit grouping). */
  App.inr = function (paise) {
    let n = Math.round(Number(paise) || 0);
    const neg = n < 0;
    n = Math.abs(n);
    const rupees = Math.floor(n / 100);
    const rem = n % 100;
    let s = String(rupees);
    if (s.length > 3) {
      const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
      s = rest + ',' + s.slice(-3);
    }
    if (rem) s += '.' + String(rem).padStart(2, '0');
    return (neg ? '-' : '') + '₹' + s;
  };

  /** "1,234.50" or "₹1234.5" -> 123450. Empty -> 0. Anything else -> null. */
  App.toPaise = function (text) {
    const t = String(text === null || text === undefined ? '' : text).replace(/[₹,\s]/g, '');
    if (t === '') return 0;
    const m = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/.exec(t);
    if (!m) return null;
    const p = parseInt(m[2], 10) * 100 + (m[3] ? parseInt(m[3].padEnd(2, '0'), 10) : 0);
    return m[1] ? -p : p;
  };

  /** 123450 -> "1234.50", 120000 -> "1200". For filling input boxes. */
  App.fromPaise = function (paise) {
    const n = Math.round(Number(paise) || 0);
    return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2);
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** '2026-10-11' -> '11 Oct 2026'. */
  App.fmtDate = function (iso, withYear) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    return parseInt(m[3], 10) + ' ' + MONTHS[parseInt(m[2], 10) - 1] + (withYear === false ? '' : ' ' + m[1]);
  };

  /** '2026-10-11 14:05:00' -> '11 Oct, 2:05 PM'. */
  App.fmtDateTime = function (iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(iso || '');
    if (!m) return '';
    let h = parseInt(m[4], 10);
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return parseInt(m[3], 10) + ' ' + MONTHS[parseInt(m[2], 10) - 1] + ', ' + h + ':' + m[5] + ' ' + ap;
  };

  /** Adds days to an ISO date string without time-zone surprises. */
  App.addDays = function (iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  };

  App.plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

  App.LABELS = {
    plan: { prepaid: 'UPI', advance: 'Partial paid', cod: 'COD', credit: 'On credit' },
    purpose: { prepaid: 'UPI', advance: 'Partial paid', balance: 'Balance', cod: 'COD', on_account: 'On account', refund: 'Refund' },
    method: { upi: 'UPI', bank_transfer: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', card: 'Card', wallet: 'Wallet', other: 'Other' },
    ship: { pending: 'Pending', packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered', returned: 'Returned' },
    accountType: { bank: 'Bank', upi: 'UPI', cash: 'Cash', wallet: 'Wallet', other: 'Other' },
  };
  App.SELF_COURIER = 'Self delivery';
  App.COURIERS = ['Delhivery', 'DTDC', 'India Post', 'Blue Dart', 'Xpressbees', 'Ecom Express', 'Shiprocket', 'Self delivery'];

  App.chip = (text, kind) => el('span', { class: 'chip chip-' + (kind || 'muted'), text });

  /** Paid / Partial / Unpaid / Cancelled chip for an order row. */
  App.payChip = function (o) {
    if (o.status === 'cancelled') return App.chip('Cancelled', 'muted');
    if (o.paid_paise >= o.total_paise) return App.chip('Paid', 'ok');
    if (o.paid_paise > 0) return App.chip('Partial', 'warn');
    return App.chip('Unpaid', 'bad');
  };

  App.shipChip = function (status) {
    if (!status) return el('span', { class: 'muted', text: '' });
    const kind = { pending: 'muted', packed: 'info', dispatched: 'info', delivered: 'ok', returned: 'bad' }[status] || 'muted';
    return App.chip(App.LABELS.ship[status] || status, kind);
  };

  /** Customer balance: positive = owes you, negative = you hold their credit. */
  /** Profit as "₹120" with the percentage under it. null profit -> a dash (purchase price not entered). */
  App.profitCell = function (paise, pct) {
    if (paise === null || paise === undefined) return App.el('span', { class: 'muted', text: '–' });
    const cls = paise < 0 ? 'pf pf-neg' : 'pf pf-pos';
    return App.el('span', { class: cls }, App.el('span', { class: 'pf-amt', text: App.inr(paise) }),
      pct === null || pct === undefined ? null : App.el('span', { class: 'pf-pct', text: pct + '%' }));
  };

  App.balanceText = function (paise) {
    if (paise > 0) return el('span', { class: 'mono owe', text: App.inr(paise) });
    if (paise < 0) return el('span', { class: 'mono credit', text: App.inr(-paise) + ' credit' });
    return el('span', { class: 'mono muted', text: '₹0' });
  };

  App.link = (href, text, cls) => el('a', { href, class: cls || null, text });

  /** For a search box: turns "+91 98765 43210" into digits so phone search works. */
  App.phoneQuery = function (q) {
    const t = q.trim();
    if (/^[\d\s+\-()]+$/.test(t)) {
      const digits = t.replace(/\D/g, '');
      if (digits.length >= 5) return digits.length > 10 && digits.startsWith('91') ? digits.slice(-10) : digits;
    }
    return t;
  };

  App.waLink = function (phone, text) {
    const digits = String(phone || '').replace(/\D/g, '');
    const full = digits.length === 10 ? '91' + digits : digits;
    return 'https://wa.me/' + full + '?text=' + encodeURIComponent(text);
  };

  App.exportUrl = function (type, from, to) {
    const usp = new URLSearchParams({ type });
    if (from) usp.set('from', from);
    if (to) usp.set('to', to);
    const sid = store.get('sid');
    if (sid) usp.set('sid', sid);
    return App.API_URL + '?r=export&' + usp.toString();
  };

  
  /* ------------------------------------------------------------------ */
  /* Toasts and dialogs                                                 */
  /* ------------------------------------------------------------------ */

  let toastBox = null;
  App.toast = function (message, kind) {
    if (!toastBox) {
      toastBox = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastBox);
    }
    const t = el('div', { class: 'toast toast-' + (kind || 'ok'), text: message });
    toastBox.appendChild(t);
    setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3800);
  };

  /** App.modal({title, body, buttons: [{label, kind, onClick(close)}], wide}) */
  App.modal = function (opts) {
    const dlg = el('dialog', { class: 'modal' + (opts.wide ? ' modal-wide' : '') });
    const close = () => { if (dlg.open) dlg.close(); };
    const buttons = (opts.buttons || []).map((b) => el('button', {
      type: 'button', class: 'btn' + (b.kind ? ' btn-' + b.kind : ''), text: b.label,
      onclick: (e) => b.onClick(close, e.currentTarget),
    }));
    dlg.appendChild(el('div', { class: 'modal-box' },
      el('div', { class: 'modal-head' },
        el('h2', { text: opts.title }),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '×', onclick: close })),
      el('div', { class: 'modal-body' }, opts.body),
      buttons.length ? el('div', { class: 'modal-foot' }, buttons) : null));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    dlg.addEventListener('close', () => { dlg.remove(); if (opts.onClose) opts.onClose(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    return { close, dialog: dlg };
  };

  /** Yes/No question. Resolves true or false. */
  App.confirm = function (message, okLabel, danger) {
    return new Promise((resolve) => {
      let answered = false;
      App.modal({
        title: 'Please confirm',
        body: el('p', { text: message }),
        buttons: [
          { label: 'Cancel', onClick: (close) => close() },
          { label: okLabel || 'Yes', kind: danger ? 'danger' : 'primary', onClick: (close) => { answered = true; close(); resolve(true); } },
        ],
        onClose: () => { if (!answered) resolve(false); },
      });
    });
  };

  /** Asks for a line of text. Resolves the text, or null if cancelled. */
  App.askText = function (opts) {
    return new Promise((resolve) => {
      let done = false;
      const input = el('input', { class: 'input', type: 'text', maxlength: opts.maxlength || 200, placeholder: opts.placeholder || '', value: opts.value || '' });
      const err = el('div', { class: 'form-error', role: 'alert' });
      const submit = (close) => {
        const v = input.value.trim();
        if (opts.required && v === '') { err.textContent = 'This is required.'; return; }
        done = true; close(); resolve(v);
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); modal.dialog.querySelector('.btn-' + (opts.danger ? 'danger' : 'primary')).click(); } });
      const modal = App.modal({
        title: opts.title,
        body: el('div', null, opts.message ? el('p', { class: 'muted', text: opts.message }) : null,
          el('label', { class: 'field' }, el('span', { text: opts.label }), input), err),
        buttons: [
          { label: 'Cancel', onClick: (close) => close() },
          { label: opts.okLabel || 'Save', kind: opts.danger ? 'danger' : 'primary', onClick: submit },
        ],
        onClose: () => { if (!done) resolve(null); },
      });
      input.focus();
    });
  };

  /* ------------------------------------------------------------------ */
  /* Small form and table helpers                                       */
  /* ------------------------------------------------------------------ */

  /** <label class="field"><span>Label</span> control [hint] </label> */
  App.field = (label, control, hint) =>
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), control,
      hint ? el('span', { class: 'field-hint', text: hint }) : null);

  App.input = (attrs) => el('input', Object.assign({ class: 'input', type: 'text' }, attrs || {}));

  App.moneyInput = (paise, attrs) =>
    el('input', Object.assign({ class: 'input mono', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: paise ? App.fromPaise(paise) : '' }, attrs || {}));

  /** options: [[value, label], ...]  */
  /** "Dior Sauvage · OG box": item name with its type, for the order page, invoice and WhatsApp. */
  App.itemLabel = (i) => i.name + (i.item_type_name ? ' · ' + i.item_type_name : '');

  App.select = (options, value, attrs) =>
    el('select', Object.assign({ class: 'input', value }, attrs || {}),
      options.map((o) => el('option', { value: o[0], text: o[1] })));

  /** Buttons that behave like radio choices. Returns {el, get, set}. */
  App.segmented = function (options, value, onChange, label) {
    let current = value;
    const wrap = el('div', { class: 'segmented', role: 'group', 'aria-label': label || 'Choose one' });
    const paint = () => {
      App.clear(wrap);
      options.forEach(([val, text]) => wrap.appendChild(el('button', {
        type: 'button', class: 'seg' + (val === current ? ' seg-on' : ''), text, 'aria-pressed': val === current ? 'true' : 'false',
        onclick: () => { current = val; paint(); if (onChange) onChange(val); },
      })));
    };
    paint();
    return { el: wrap, get: () => current, set: (v) => { current = v; paint(); } };
  };

  /** columns: [{label, render(row), class, th}] -> scrollable table. */
  App.table = function (columns, rows, emptyText) {
    const head = el('tr', null, columns.map((c) => el('th', { class: c.class || null, scope: 'col', text: c.label })));
    const body = rows.length
      ? rows.map((r) => el('tr', { class: r._class || null }, columns.map((c) => el('td', { class: c.class || null }, c.render(r)))))
      : [el('tr', null, el('td', { colspan: columns.length, class: 'empty', text: emptyText || 'Nothing to show.' }))];
    return el('div', { class: 'table-wrap' }, el('table', { class: 'tbl' }, el('thead', null, head), el('tbody', null, body)));
  };

  App.pager = function (state, onPage) {
    const pages = Math.max(1, Math.ceil(state.total / state.per));
    const from = state.total === 0 ? 0 : (state.page - 1) * state.per + 1;
    const to = Math.min(state.total, state.page * state.per);
    return el('div', { class: 'pager' },
      el('span', { class: 'muted', text: from + ' to ' + to + ' of ' + state.total }),
      el('div', { class: 'pager-btns' },
        el('button', { type: 'button', class: 'btn btn-small', text: 'Previous', disabled: state.page <= 1, onclick: () => onPage(state.page - 1) }),
        el('button', { type: 'button', class: 'btn btn-small', text: 'Next', disabled: state.page >= pages, onclick: () => onPage(state.page + 1) })));
  };

  App.datalist = function (id, values) {
    return el('datalist', { id }, values.map((v) => el('option', { value: v })));
  };

  /* ------------------------------------------------------------------ */
  /* Accounts (bank, UPI, cash)                                         */
  /* ------------------------------------------------------------------ */

  let accountCache = null;
  App.accounts = async function (force) {
    if (!accountCache || force) accountCache = (await App.api('api/accounts.php')).rows;
    return accountCache;
  };

  /* ------------------------------------------------------------------ */
  /* Customer search box                                                */
  /* ------------------------------------------------------------------ */

  /** Returns {el, input, focus}. Calls opts.onSelect(customer) when one is chosen. */
  App.customerPicker = function (opts) {
    const input = el('input', {
      type: 'search', class: 'input', placeholder: opts.placeholder || 'Search name or phone number', autocomplete: 'off',
      role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list',
    });
    const list = el('div', { class: 'picker-list', role: 'listbox', hidden: true });
    const wrap = el('div', { class: 'picker' }, input, list);
    let items = [];
    let active = -1;
    let seq = 0;

    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const choose = (c) => { close(); input.value = ''; opts.onSelect(c); };
    const paint = () => {
      App.clear(list);
      if (!items.length) {
        list.appendChild(el('div', { class: 'picker-empty', text: 'No customer found. Fill in the details to add a new one.' }));
      }
      items.forEach((c, i) => list.appendChild(el('button', {
        type: 'button', role: 'option', class: 'picker-item' + (i === active ? ' picker-active' : ''),
        onmousedown: (e) => { e.preventDefault(); choose(c); },
      },
      el('span', { class: 'item-name', text: c.name }),
      el('span', { class: 'item-meta', text: c.phone + (c.city ? ' · ' + c.city : '') + (c.bal > 0 ? ' · owes ' + App.inr(c.bal) : '') }))));
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    const search = App.debounce(async () => {
      const q = App.phoneQuery(input.value);
      if (q.length < 2) { close(); return; }
      const mine = ++seq;
      try {
        const d = await App.api('api/customers.php', { params: { q, per: 8 } });
        if (mine !== seq) return;
        items = d.rows;
        active = items.length ? 0 : -1;
        paint();
      } catch (e) { close(); }
    }, 250);

    input.addEventListener('input', search);
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
      else if (e.key === 'Enter' && items[active]) { e.preventDefault(); choose(items[active]); }
      else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
    return { el: wrap, input, focus: () => input.focus() };
  };

  /* ------------------------------------------------------------------ */
  /* Record payment / refund (used on several pages)                    */
  /* ------------------------------------------------------------------ */

  /**
   * App.paymentModal({customer: {id, name, phone}, order: {id, order_no, balance_paise}, refund: bool, onSaved})
   * Without an order, a payment is applied to the customer's oldest unpaid orders first.
   */
  App.paymentModal = async function (opts) {
    opts = opts || {};
    let accounts;
    try {
      accounts = (await App.accounts()).filter((a) => a.is_active);
    } catch (e) { App.toast(e.message, 'error'); return; }

    let customer = opts.customer || null;
    let amountTouched = false;
    const err = el('div', { class: 'form-error', role: 'alert' });

    const typeSeg = App.segmented([['received', 'Payment received'], ['refund', 'Refund paid']], opts.refund ? 'refund' : 'received', () => { loadOrders(); }, 'Type');
    const customerBox = el('div', { class: 'field' });
    const orderSelect = App.select([['', 'Choose a customer first']], '', { disabled: true });
    const orderHint = el('span', { class: 'field-hint' });
    const amount = App.moneyInput(0, { placeholder: '0' });
    amount.addEventListener('input', () => { amountTouched = true; });
    const date = App.input({ type: 'date', value: App.today });
    const account = App.input({ list: 'account-list', placeholder: 'Type the account name', maxlength: 60, autocomplete: 'off', value: store.get('account_name') || '' });
    const note = App.input({ placeholder: 'Note (optional)', maxlength: 200 });
    let orderRows = [];

    const paintCustomer = () => {
      App.clear(customerBox);
      customerBox.appendChild(el('span', { class: 'field-label', text: 'Customer' }));
      if (customer) {
        customerBox.appendChild(el('div', { class: 'picked' },
          el('span', null, el('strong', { text: customer.name }), el('span', { class: 'muted', text: '  ' + (customer.phone || '') })),
          opts.customer || opts.order ? null : el('button', { type: 'button', class: 'btn btn-small', text: 'Change', onclick: () => { customer = null; paintCustomer(); loadOrders(); } })));
      } else {
        const picker = App.customerPicker({ onSelect: (c) => { customer = c; paintCustomer(); loadOrders(); } });
        customerBox.appendChild(picker.el);
        setTimeout(() => picker.focus(), 30);
      }
    };

    const loadOrders = async () => {
      const refund = typeSeg.get() === 'refund';
      if (opts.order) {
        App.mount(orderSelect, el('option', { value: String(opts.order.id), text: opts.order.order_no + (refund ? '' : ' (balance ' + App.inr(opts.order.balance_paise) + ')') }));
        orderSelect.disabled = true;
        if (!refund && !amountTouched) amount.value = App.fromPaise(opts.order.balance_paise);
        return;
      }
      if (!customer) {
        App.mount(orderSelect, el('option', { value: '', text: 'Choose a customer first' }));
        orderSelect.disabled = true;
        orderHint.textContent = '';
        return;
      }
      try {
        const d = await App.api('api/orders.php', { params: { customer_id: customer.id, status: 'active', per: 100 } });
        orderRows = d.rows.filter((o) => (refund ? o.paid_paise > 0 : o.total_paise - o.paid_paise > 0));
      } catch (e) { orderRows = []; }
      const first = refund ? ['', 'Not linked to an order'] : ['', 'Oldest unpaid orders first (automatic)'];
      App.mount(orderSelect, [el('option', { value: first[0], text: first[1] })].concat(orderRows.map((o) =>
        el('option', { value: String(o.id), text: o.order_no + ' · ' + App.fmtDate(o.order_date, false) + ' · ' + (refund ? 'paid ' + App.inr(o.paid_paise) : 'balance ' + App.inr(o.total_paise - o.paid_paise)) }))));
      orderSelect.disabled = false;
      orderHint.textContent = refund ? '' : 'Money beyond the unpaid orders is kept as a credit on the customer.';
    };
    orderSelect.addEventListener('change', () => {
      const o = orderRows.find((r) => String(r.id) === orderSelect.value);
      if (o && typeSeg.get() === 'received' && !amountTouched) amount.value = App.fromPaise(o.total_paise - o.paid_paise);
    });

    const body = el('div', { class: 'form-grid' },
      opts.order ? null : el('div', { class: 'span-2' }, typeSeg.el),
      customerBox,
      el('div', { class: 'span-2' }, App.field('Apply to', orderSelect, null), orderHint),
      App.field('Amount (₹)', amount),
      App.field('Date', date),
      el('div', { class: 'span-2' }, App.field('Account', account), App.datalist('account-list', accounts.map((a) => a.name))),
      el('div', { class: 'span-2' }, App.field('Note', note)),
      el('div', { class: 'span-2' }, err));

    paintCustomer();
    loadOrders();

    App.modal({
      title: opts.order ? (opts.refund ? 'Record refund for ' : 'Record payment for ') + opts.order.order_no : 'Record payment',
      body,
      buttons: [
        { label: 'Cancel', onClick: (close) => close() },
        {
          label: 'Save payment', kind: 'primary',
          onClick: async (close, btn) => {
            err.textContent = '';
            if (!customer) { err.textContent = 'Choose a customer.'; return; }
            const paise = App.toPaise(amount.value);
            if (!paise || paise <= 0) { err.textContent = 'Enter an amount greater than zero.'; return; }
            if (!account.value.trim()) { err.textContent = 'Type the account name.'; return; }
            btn.disabled = true;
            try {
              const r = await App.api('api/payments.php', {
                body: {
                  action: 'add', customer_id: customer.id, order_id: orderSelect.value || null, type: typeSeg.get(),
                  amount_paise: paise, account_name: account.value.trim(), received_on: date.value, note: note.value,
                },
              });
              store.set('account_name', account.value.trim());
              let msg = (typeSeg.get() === 'refund' ? 'Refund' : 'Payment') + ' of ' + App.inr(paise) + ' saved.';
              if (typeSeg.get() === 'received' && r.applied.length > 1) msg += ' Applied to ' + r.applied.map((a) => a.order_no).join(', ') + '.';
              if (r.on_account_paise > 0) msg += ' ' + App.inr(r.on_account_paise) + ' kept as credit.';
              App.toast(msg);
              close();
              if (opts.onSaved) opts.onSaved(r);
            } catch (e2) {
              err.textContent = e2.message;
              btn.disabled = false;
            }
          },
        },
      ],
    });
  };

  /* ------------------------------------------------------------------ */
  /* Add / change a tracking ID (used on several pages)                 */
  /* ------------------------------------------------------------------ */

  /** Parcel size (cm) and weight (kg) inputs with quick weight buttons. Returns {el, values()}. */
  App.parcelFields = function (s) {
    s = s || {};
    const num = (v) => (v === null || v === undefined || v === '' ? '' : String(v));
    const dim = (v, label) => App.input({ class: 'input mono', inputmode: 'decimal', autocomplete: 'off', maxlength: 6, placeholder: label, 'aria-label': label + ' in cm', value: num(v) });
    const len = dim(s.length_cm, 'Length');
    const bre = dim(s.breadth_cm, 'Breadth');
    const hei = dim(s.height_cm, 'Height');
    const weight = App.input({ class: 'input mono', inputmode: 'decimal', autocomplete: 'off', maxlength: 6, placeholder: 'Weight in kg', 'aria-label': 'Weight in kg', value: num(s.weight_kg) });
    const chips = [0.5, 1, 1.5, 2, 2.5].map((w) => el('button', {
      type: 'button', class: 'filter-chip', text: w + ' kg',
      onclick: () => { weight.value = String(w); paint(); },
    }));
    const paint = () => {
      const cur = parseFloat(weight.value.replace(',', '.'));
      [0.5, 1, 1.5, 2, 2.5].forEach((w, i) => {
        const on = cur === w;
        chips[i].classList.toggle('filter-on', on);
        chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    };
    weight.addEventListener('input', paint);
    paint();
    const node = el('div', { class: 'parcel span-2' },
      el('div', { class: 'form-grid form-grid-3' }, App.field('Length (cm)', len), App.field('Breadth (cm)', bre), App.field('Height (cm)', hei)),
      el('div', { class: 'weight-row' }, App.field('Weight (kg)', weight), el('div', { class: 'chip-row', role: 'group', 'aria-label': 'Quick weight' }, chips)));
    return {
      el: node,
      values: () => ({ length_cm: len.value.trim(), breadth_cm: bre.value.trim(), height_cm: hei.value.trim(), weight_kg: weight.value.trim() }),
    };
  };

  /** One click: asks Shiprocket for this shipment's AWB and saves it. done() runs after a hit. */
  App.fetchAwb = async function (shipmentId, btn, done) {
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Checking Shiprocket...'; }
    try {
      const r = await App.api('api/shipments.php', { body: { action: 'shiprocket', id: shipmentId } });
      if (r.found) {
        App.toast('Tracking ID ' + r.awb + (r.courier ? ' (' + r.courier + ')' : '') + ' saved. Matched by ' + r.by + '.');
        if (done) done();
        return;
      }
      App.toast('No Shiprocket shipment with a tracking ID found for ' + r.order_no + ' yet.', 'error');
    } catch (e) { App.toast(e.message, 'error'); }
    if (btn) { btn.disabled = false; btn.textContent = label; }
  };

  /* ------------------------------------------------------------------ */
  /* Product photos and the item suggestion list (New order)            */
  /* ------------------------------------------------------------------ */

  /** Address of a photo: uploaded here (uploads/..) or an https link from the catalog. */
  App.imgSrc = (u) => (u && /^uploads\//.test(u) ? App.API_DIR + u : (u && /^https:\/\//i.test(u) ? u : ''));

  /** A small square photo, or the first letters of the name when there is no photo. */
  App.thumb = function (name, url, cls) {
    const box = el('span', { class: 'thumb ' + (cls || '') });
    const src = App.imgSrc(url);
    if (src) {
      const img = el('img', { src, alt: '', loading: 'lazy' });
      img.addEventListener('error', () => { img.remove(); box.textContent = initials(name); });
      box.appendChild(img);
    } else {
      box.textContent = initials(name);
    }
    if (!src) box.style.background = hue(name);
    return box;
  };
  function initials(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase() || '?'; }
  function hue(n) { let h = 0; String(n || '').split('').forEach((c) => { h = (h * 31 + c.charCodeAt(0)) % 360; }); return 'hsl(' + h + ',38%,40%)'; }

  /** Shrinks a phone photo (max 900px, JPEG) so it uploads fast. Returns a data URL. */
  async function shrinkPhoto(file) {
    if (!/^image\//.test(file.type)) throw new Error('Choose a photo (JPG or PNG).');
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('This photo format is not supported. Try a JPG or PNG photo.'); }
    const scale = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    let q = 0.85;
    let out = c.toDataURL('image/jpeg', q);
    while (out.length > 780000 && q > 0.4) { q -= 0.15; out = c.toDataURL('image/jpeg', q); }
    if (out.length > 780000) throw new Error('That photo is too large. Choose a smaller one.');
    return out;
  }

  /** Opens the camera / gallery, uploads the photo. Resolves with its address, or null if cancelled. */
  App.pickPhoto = function () {
    return new Promise((resolve, reject) => {
      const f = el('input', { type: 'file', accept: 'image/*', hidden: true });
      f.addEventListener('cancel', () => { f.remove(); resolve(null); });
      f.addEventListener('change', async () => {
        const file = f.files && f.files[0];
        f.remove();
        if (!file) { resolve(null); return; }
        try {
          const data = await shrinkPhoto(file);
          const r = await App.api('api/upload.php', { body: { data } });
          resolve(r.url);
        } catch (e) { reject(e); }
      });
      document.body.appendChild(f);
      f.click();
    });
  };

  /** City (district) for an Indian pincode from the India Post lookup; '' when unknown or offline. Answers are remembered. */
  const pinCache = {};
  App.cityForPin = async function (code) {
    if (pinCache[code] !== undefined) return pinCache[code];
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    let city = '';
    try {
      // Straight from the browser first (fastest) ...
      const res = await fetch('https://api.postalpincode.in/pincode/' + encodeURIComponent(code), { signal: ctl.signal });
      const d = await res.json();
      const po = Array.isArray(d) && d[0] && d[0].Status === 'Success' && Array.isArray(d[0].PostOffice) ? d[0].PostOffice[0] : null;
      city = po ? String(po.District || po.Division || '').trim() : '';
    } catch (e) {
      // ... and through api.php when the browser is not allowed to call that site.
      try { city = String((await App.api('api/pincode.php', { params: { pin: code } })).city || ''); } catch (e2) { city = ''; }
    } finally { clearTimeout(timer); }
    pinCache[code] = city;
    return city;
  };

  /** Lets a box take digits only, at most `max` of them (letters, spaces, + and - are dropped as you type or paste). */
  App.digitsOnly = function (input, max) {
    input.addEventListener('input', () => {
      let d = input.value.replace(/\D+/g, '');
      // Pasted with the country code or a leading 0 (+91 98765 43210, 098765 43210): keep the 10-digit number.
      if (d.length > max && d.startsWith('91')) d = d.slice(2);
      else if (d.length > max && d.startsWith('0')) d = d.slice(1);
      d = d.slice(0, max);
      if (d !== input.value) input.value = d;
    });
  };

  /** Type a 6-digit pincode in `pin` and the city box fills in. A city typed by hand is left alone. */
  App.autoCity = function (pin, city) {
    let auto = false;
    let seq = 0;
    city.addEventListener('input', () => { auto = false; });
    pin.addEventListener('input', async () => {
      const code = pin.value.trim();
      if (!/^\d{6}$/.test(code)) return;
      const mine = ++seq;
      const place = await App.cityForPin(code);
      if (mine !== seq || !place) return;
      if (city.value.trim() === '' || auto) { city.value = place; auto = true; }
    });
  };

  /** Catalog products matching a word (your catalog's own product search). */
  async function searchCatalog(q) {
    if (!App.catalogApi) return [];
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const u = new URL(App.catalogApi, App.API_URL);
      u.searchParams.set('search', q);
      u.searchParams.set('page', '1');
      const res = await fetch(u, { credentials: 'omit', signal: ctl.signal });
      const d = await res.json();
      return (Array.isArray(d.products) ? d.products : []).slice(0, 8).map((p) => {
        let img = '';
        try { img = p.image ? new URL(String(p.image), u).href : ''; } catch (e) { img = ''; }
        return { src: 'catalog', catalog_id: parseInt(p.id, 10) || 0, name: String(p.name || '').trim(), category: String(p.category || '').trim(),
          price_paise: Math.round(Number(p.price || 0) * 100), cost_paise: Math.round(Number(p.cost_price || 0) * 100), image: /^https:\/\//i.test(img) ? img : '' };
      }).filter((p) => p.name);
    } catch (e) { return []; } finally { clearTimeout(timer); }
  }

  /** Buying price of one catalog product (products.cost_price, typed on the catalog's Add/Edit product page), in paise; 0 when not set. */

  App.catalogCost = async function (id) {

    if (!App.catalogApi || !(id > 0)) return 0;

    const ctl = new AbortController();

    const timer = setTimeout(() => ctl.abort(), 6000);

    try {

      const u = new URL('get_product.php', new URL(App.catalogApi, App.API_URL));

      u.searchParams.set('id', String(id));

      const d = await (await fetch(u, { credentials: 'omit', signal: ctl.signal })).json();

      return Math.round(Number(d && d.product ? d.product.cost_price || 0 : 0) * 100);

    } catch (e) { return 0; } finally { clearTimeout(timer); }

  };



  /** Products already saved in this ledger (earlier manual additions). */
  async function searchLedger(q) {
    try {
      const d = await App.api('api/products.php', { params: { active: 1, q, per: 6 } });
      return d.rows.map((r) => ({ src: 'ledger', id: r.id, name: r.name, price_paise: r.rate_paise, cost_paise: r.cost_paise || 0, image: r.image || '' }));
    } catch (e) { return []; }
  }

  /**
   * Suggestion list under an item-name box: catalog + ledger products with photos. hooks: {onPick(item)}.
   */
  App.itemSuggest = function (input, hooks) {
    let pop = null;
    let list = [];
    let idx = -1;
    let seq = 0;
    let timer = null;

    const close = () => { if (pop) { pop.remove(); pop = null; } list = []; idx = -1; };
    const place = () => {
      if (!pop) return;
      const rc = input.getBoundingClientRect();
      const w = Math.min(Math.max(rc.width, 300), window.innerWidth - 16);
      pop.style.width = w + 'px';
      pop.style.left = Math.max(8, Math.min(rc.left, window.innerWidth - w - 8)) + 'px';
      pop.style.top = (rc.bottom + 4) + 'px';
      pop.style.maxHeight = Math.max(170, window.innerHeight - rc.bottom - 14) + 'px';
    };
    const pick = (i) => {
      const it = list[i];
      close();
      if (it) hooks.onPick(it);
    };
    const mark = () => {
      if (!pop) return;
      Array.from(pop.children).forEach((c, i) => c.classList.toggle('on', i === idx));
      const cur = pop.children[idx];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    };
    const show = (items) => {
      close();
      list = items;
      if (!list.length) return;
      pop = el('div', { class: 'suggest', role: 'listbox' }, list.map((it, i) => {
        const row = el('div', { class: 'suggest-opt', role: 'option' });
        row.appendChild(App.thumb(it.name, it.image));
        row.appendChild(el('div', { class: 'suggest-txt' }, el('b', { text: it.name }), el('span', { text: it.src === 'catalog' ? 'Catalog' : 'Added earlier' })));
        if (it.price_paise > 0) row.appendChild(el('em', { class: 'mono', text: App.inr(it.price_paise) }));
        row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
        return row;
      }));
      document.body.appendChild(pop);
      place();
      idx = items.length ? 0 : -1;
      mark();
    };

    const run = async (q) => {
      const mine = ++seq;
      const [cat, led] = await Promise.all([searchCatalog(q), searchLedger(q)]);
      if (mine !== seq || document.activeElement !== input || input.value.trim() !== q) return;
      const seen = new Set();
      const merged = cat.concat(led).filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
      show(merged);
    };

    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { seq++; close(); return; }
      timer = setTimeout(() => run(q), 250);
    });
    input.addEventListener('keydown', (e) => {
      if (!pop) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, list.length - 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); mark(); }
      else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); pick(idx); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.addEventListener('blur', () => { seq++; clearTimeout(timer); close(); });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', (e) => { if (pop && !pop.contains(e.target)) place(); }, true);
  };

  /** App.trackingModal({shipment: {id, courier, tracking_id, status}, title, onSaved}) */
  App.trackingModal = function (opts) {
    const s = opts.shipment;
    const err = el('div', { class: 'form-error', role: 'alert' });
    const courier = App.input({ list: 'courier-list', value: s.courier || '', placeholder: 'Courier name', maxlength: 40 });
    const tracking = App.input({ class: 'input mono', value: s.tracking_id || '', placeholder: 'Paste tracking ID / AWB', maxlength: 60, autocapitalize: 'characters' });
    const status = App.select(Object.keys(App.LABELS.ship).map((k) => [k, App.LABELS.ship[k]]), s.status || 'pending');
    const parcel = App.parcelFields(s);
    const modal = App.modal({
      title: opts.title || 'Tracking ID',
      body: el('div', { class: 'form-grid' },
        App.datalist('courier-list', App.COURIERS),
        App.field('Courier', courier),
        App.field('Tracking ID', tracking),
        App.field('Dispatch status', status),
        parcel.el,
        el('div', { class: 'span-2' }, err)),
      buttons: [
        { label: 'Cancel', onClick: (close) => close() },
        {
          label: 'Save', kind: 'primary',
          onClick: async (close, btn) => {
            err.textContent = '';
            btn.disabled = true;
            try {
              await App.api('api/shipments.php', { body: { action: 'update', id: s.id, courier: courier.value, tracking_id: tracking.value, status: status.value, note: s.note || '', ...parcel.values() } });
              App.toast('Tracking saved.');
              close();
              if (opts.onSaved) opts.onSaved();
            } catch (e) { err.textContent = e.message; btn.disabled = false; }
          },
        },
      ],
    });
    tracking.focus();
    return modal;
  };

  /* ------------------------------------------------------------------ */
  /* Add / edit customer (customers page and customer page)             */
  /* ------------------------------------------------------------------ */

  /** Add or edit a customer. opts: {customer?, onSaved(id)} */
  App.customerModal = function (opts) {
    const c = opts.customer || {};
    const err = el('div', { class: 'form-error', role: 'alert' });
    const name = App.input({ value: c.name || '', maxlength: 120 });
    const phone = App.input({ value: c.phone || '', inputmode: 'numeric', placeholder: '10-digit mobile number' });
    App.digitsOnly(phone, 10);
    const city = App.input({ value: c.city || '', maxlength: 60 });
    const pin = App.input({ value: c.pincode || '', maxlength: 10, inputmode: 'numeric' });
    App.autoCity(pin, city);
    const address = App.input({ value: c.address || '', maxlength: 255 });
    const notes = App.input({ value: c.notes || '', maxlength: 255 });
    const opening = App.input({ class: 'input mono', inputmode: 'decimal', value: c.opening_paise ? App.fromPaise(c.opening_paise) : '', placeholder: '0' });
    App.modal({
      title: c.id ? 'Edit customer' : 'New customer',
      body: el('div', { class: 'form-grid' },
        App.field('Name', name), App.field('Phone', phone),
        el('div', { class: 'span-2' }, App.field('Address', address)),
        App.field('City', city), App.field('Pincode', pin),
        el('div', { class: 'span-2' }, App.field('Notes', notes)),
        el('div', { class: 'span-2' }, App.field('Opening balance (₹)', opening, 'Only if they already owed you before you started using this system. Use a minus sign if you hold their money.')),
        el('div', { class: 'span-2' }, err)),
      buttons: [
        { label: 'Cancel', onClick: (close) => close() },
        { label: 'Save', kind: 'primary', onClick: async (close, btn) => {
          err.textContent = '';
          const op = App.toPaise(opening.value);
          if (!/^\d{10}$/.test(phone.value.trim())) { err.textContent = 'Enter the 10-digit mobile number.'; return; }
          if (op === null) { err.textContent = 'Opening balance is not a valid amount.'; return; }
          btn.disabled = true;
          try {
            const r = await App.api('api/customers.php', { body: { action: 'save', id: c.id || null, name: name.value, phone: phone.value, city: city.value, pincode: pin.value, address: address.value, notes: notes.value, opening_paise: op } });
            App.toast('Customer saved.');
            close();
            opts.onSaved(r.id);
          } catch (e) { err.textContent = e.message; btn.disabled = false; }
        } },
      ],
    });
    name.focus();
  };

  /** Asks first, then deletes the customer (with their orders and payments, if any). onDone runs after it is gone. */
  App.deleteCustomer = async function (c, onDone) {
    let n;
    try { n = await App.api('api/customers.php', { body: { action: 'delete_info', id: c.id } }); } catch (e) { App.toast(e.message, 'error'); return; }
    const who = c.name + (c.phone ? ' (' + c.phone + ')' : '');
    const message = n.orders || n.payments
      ? 'Delete ' + who + ' together with ' + App.plural(n.orders, 'order') + ' and ' + App.plural(n.payments, 'payment') + '? They are removed from your sales, revenue and ledger totals. This cannot be undone.'
      : 'Delete ' + who + '? This cannot be undone.';
    const ok = await App.confirm(message, 'Delete customer', true);
    if (!ok) return;
    try {
      await App.api('api/customers.php', { body: { action: 'delete', id: c.id } });
      App.toast('Customer deleted.');
      if (onDone) onDone();
    } catch (e) { App.toast(e.message, 'error'); }
  };

  if (!document.getElementById('page') || document.body.dataset.page === 'skip') return;

  /* ------------------------------------------------------------------ */
  /* Page shell: sign-in check, top bar                                 */
  /* ------------------------------------------------------------------ */

  const NAV = [
    ['#/dashboard', 'Dashboard', 'dashboard'], ['#/orders', 'Orders', 'orders'], ['#/payments', 'Payments', 'payments'],
    ['#/customers', 'Customers', 'customers'], ['#/shipments', 'Shipments', 'shipments'],
    ['#/reports', 'Reports', 'reports'], ['#/salesmen', 'Salesmen', 'salesmen'], ['#/commission', 'Commission', 'commission'],
    ['#/cashbook', 'Cash book', 'cashbook'], ['#/itemtypes', 'Item types', 'itemtypes'],
  ];

  /* The address looks like  index.html#/orders?status=cancelled  so Back, refresh and bookmarks work. */
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const i = h.indexOf('?');
    return { name: (i < 0 ? h : h.slice(0, i)) || 'dashboard', params: new URLSearchParams(i < 0 ? '' : h.slice(i + 1)) };
  }

  /** Keeps the filter state in the address bar without adding history entries. */
  App.getParams = () => parseHash().params;
  App.setParams = function (obj) {
    const usp = new URLSearchParams();
    Object.keys(obj).forEach((k) => {
      if (obj[k] !== '' && obj[k] !== null && obj[k] !== undefined && obj[k] !== false) usp.set(k, String(obj[k]));
    });
    const qs = usp.toString();
    history.replaceState(null, '', '#/' + parseHash().name + (qs ? '?' + qs : ''));
  };

  function renderTopbar(active) {
    const bar = document.getElementById('topbar');
    App.mount(bar, el('div', { class: 'topbar-in' },
      el('div', { class: 'topbar-left' },
        el('a', { class: 'brand', href: '#/dashboard', text: App.appName }),
        el('nav', { class: 'tabs', 'aria-label': 'Main' }, NAV.map(([href, label, key]) =>
          el('a', { href, class: 'tab' + (key === active ? ' tab-active' : ''), 'aria-current': key === active ? 'page' : null, text: label })))),
      el('div', { class: 'topbar-right' },
        App.env === 'test' ? el('span', { class: 'pill pill-test', title: 'api.php is set to the local database.', text: 'Local database' }) : null,
        el('a', { class: 'btn btn-primary', href: '#/order', text: 'New order' }),
        App.backUrl ? el('a', { class: 'btn btn-quiet', href: App.backUrl, text: 'Back to admin' }) : null)));
  }

  /* ---------------- views register themselves; the router shows one at a time ---------------- */
  const views = {};
  App.view = function (name, opts, run) { views[name] = { opts, run }; };

  let routeSeq = 0;
  App.route = async function () {
    if (!App.user) return;
    const host = document.getElementById('page');
    const v = views[parseHash().name] || views.dashboard;
    const mine = ++routeSeq;
    const box = el('div', { class: 'view' });
    App.mount(host, box);
    document.title = (App.env === 'test' ? '[LOCAL] ' : '') + v.opts.title + ' - ' + App.appName;
    renderTopbar(v.opts.nav);
    window.scrollTo(0, 0);
    try {
      await v.run(box);
    } catch (e) {
      if (e.status === 401 || mine !== routeSeq) return;
      App.mount(box, el('section', { class: 'card' },
        el('h2', { text: 'This page could not load' }),
        el('p', { class: 'muted', text: e.message }),
        el('div', null, el('button', { type: 'button', class: 'btn', text: 'Try again', onclick: () => App.route() }))));
    }
  };

  App.start = async function () {
    let me;
    try {
      me = await App.api('api/auth.php');
    } catch (e) {
      App.mount(document.getElementById('topbar'));
      App.mount(document.getElementById('page'), el('section', { class: 'card' },
        el('h2', { text: 'Cannot start' }), el('p', { class: 'muted', text: e.message }),
        el('div', null, el('button', { type: 'button', class: 'btn', text: 'Try again', onclick: () => App.start() }))));
      return;
    }
    App.csrf = me.csrf;
    App.env = me.env;
    App.today = me.today;
    App.appName = me.app_name;
    App.user = me.user;
    App.backUrl = me.back_url || '';
    App.catalogApi = me.catalog_api || '';
    document.title = (App.env === 'test' ? '[LOCAL] ' : '') + App.appName;
    App.route();
  };

  window.addEventListener('hashchange', () => App.route());
}());

/* Dashboard: KPI strip, three work lanes, 7-day chart. */
(function () {
  'use strict';
  const App = window.App;
  const { el, inr } = App;

  function kpi(label, value, sub) {
    return el('div', { class: 'kpi' },
      el('span', { class: 'kpi-label', text: label }),
      el('span', { class: 'kpi-value', text: value }),
      el('span', { class: 'kpi-sub', text: sub }));
  }

  function lane(title, count, kind, rows, emptyText, linkHref, linkText) {
    return el('section', { class: 'card lane' },
      el('div', { class: 'lane-head' },
        el('h2', { text: title }),
        count !== null ? el('span', { class: 'pill pill-' + kind, text: String(count) }) : null),
      rows.length ? rows : el('div', { class: 'empty', text: emptyText }),
      el('a', { class: 'lane-link', href: linkHref, text: linkText }));
  }

  function dueText(due, today) {
    if (!due) return 'No due date';
    if (due < today) return 'Overdue since ' + App.fmtDate(due, false);
    if (due === today) return 'Due today';
    return 'Due ' + App.fmtDate(due, false);
  }

  /** First and last day of the month `offset` months away from `today` (0 = this month). */
  function dashMonthRange(today, offset) {
    const [y, m] = today.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + offset, 1));
    const last = new Date(Date.UTC(y, m + offset, 0));
    const f = (dt) => dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
    return [f(first), f(last)];
  }

  App.view('dashboard', { nav: 'dashboard', title: 'Dashboard' }, async (page) => {
    const p = App.getParams();
    const [mFrom, mTo] = dashMonthRange(App.today, 0);
    // Nothing chosen yet = this month.
    const state = { from: p.get('from') || mFrom, to: p.get('to') || App.today };

    const from = App.input({ type: 'date', value: state.from });
    const to = App.input({ type: 'date', value: state.to });
    const strip = el('div', { class: 'kpi-strip' });
    const lanes = el('div', { class: 'lanes' });
    const chart = el('section', { class: 'card chart-card' });
    const sub = el('p', { class: 'page-sub' });

    const presets = [
      ['Today', () => [App.today, App.today]],
      ['This month', () => dashMonthRange(App.today, 0)],
      ['Last month', () => dashMonthRange(App.today, -1)],
      ['Last 7 days', () => [App.addDays(App.today, -6), App.today]],
      ['This year', () => [App.today.slice(0, 4) + '-01-01', App.today]],
    ];

    const bar = el('div', { class: 'toolbar' },
      el('div', { class: 'filters' }, presets.map(([label, fn]) => el('button', { type: 'button', class: 'filter-chip', text: label, onclick: () => {
        const [a, b] = fn(); from.value = a; to.value = b; apply();
      } }))),
      App.field('From', from), App.field('To', to));

    const apply = () => { if (from.value && to.value) { state.from = from.value; state.to = to.value; load(); } };
    from.addEventListener('change', apply);
    to.addEventListener('change', apply);

    let seq = 0;
    async function load() {
      App.setParams(state);
      const mine = ++seq;
      let d;
      try { d = await App.api('api/dashboard.php', { params: state }); } catch (e) { App.mount(lanes, el('p', { class: 'alert alert-error', text: e.message })); return; }
      if (mine !== seq) return;
      paint(d);
    }

    function paint(d) {
    const k = d.kpis;
    const periodText = state.from === state.to
      ? App.fmtDate(state.from)
      : App.fmtDate(state.from) + ' to ' + App.fmtDate(state.to);
    sub.textContent = 'Today ' + App.fmtDate(d.today) + ' · showing ' + periodText;

    App.mount(strip,
      kpi('Billed in this period', inr(k.billed_month), App.plural(k.orders_month, 'order')),
      kpi('Collected in this period', inr(k.collected_month), 'after refunds'),
      kpi('Outstanding', inr(k.outstanding), App.plural(k.owing_customers, 'customer') + ' owe you · all time'),
      kpi('Billed today', inr(k.billed_today), App.plural(k.orders_today, 'order')));

    const unpaid = d.unpaid.map((o) => el('a', { class: 'item', href: '#/order?id=' + o.id },
      el('span', { class: 'item-main' },
        el('span', { class: 'item-name', text: o.name }),
        el('span', { class: 'item-meta', text: o.order_no + ' · ' + dueText(o.due_date, d.today) })),
      el('span', { class: 'item-end' },
        o.due_date && o.due_date < d.today ? App.chip('Overdue', 'bad') : null,
        el('span', { class: 'item-amount mono', text: inr(o.balance_paise) }))));

    const noTrack = d.no_track.map((s) => el('a', { class: 'item', href: '#/shipments?needs_tracking=1&q=' + encodeURIComponent(s.order_no) },
      el('span', { class: 'item-main' },
        el('span', { class: 'item-name', text: s.name }),
        el('span', { class: 'item-meta', text: s.order_no + ' · ordered ' + App.fmtDate(s.order_date, false) })),
      el('span', { class: 'item-end' }, App.shipChip(s.status))));

    const pays = d.payments.map((p) => el('div', { class: 'item' },
      el('span', { class: 'item-main' },
        el('span', { class: 'item-name', text: p.name }),
        el('span', { class: 'item-meta', text: (App.LABELS.purpose[p.purpose] || p.purpose) + ' · ' + p.account_name + ' · ' + App.fmtDate(p.received_on, false) })),
      el('span', { class: 'item-amount mono ' + (p.type === 'refund' ? 'owe' : 'item-in'), text: (p.type === 'refund' ? '-' : '+') + inr(p.amount_paise) })));

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const max = Math.max(1, ...d.days.map((x) => x.amount_paise));
    // Long ranges get one bar per month; the labels and the amount above each bar are dropped when there are many bars.
    const tight = d.days.length > 14;
    const bars = el('div', { class: 'bars bars-tall' + (tight ? ' bars-tight' : '') }, d.days.map((x, i) => {
      const bar = el('div', { class: 'bar' });
      bar.style.height = Math.max(2, Math.round((x.amount_paise / max) * 130)) + 'px';
      const dt = new Date(x.date + 'T00:00:00');
      // Many days: only the day number, with the month added on the 1st and on the first bar.
      const tightDay = (i === 0 || dt.getDate() === 1) ? dt.getDate() + ' ' + MONTHS[dt.getMonth()] : String(dt.getDate());
      const label = d.by_month
        ? MONTHS[dt.getMonth()] + (d.days.length > 12 ? " '" + String(dt.getFullYear()).slice(2) : '')
        : (tight ? tightDay : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()] + ' ' + dt.getDate());
      bar.title = (d.by_month ? MONTHS[dt.getMonth()] + ' ' + dt.getFullYear() : App.fmtDate(x.date)) + ' · ' + inr(x.amount_paise);
      return el('div', { class: 'bar-col' },
        tight ? null : el('span', { class: 'bar-label', text: x.amount_paise ? inr(x.amount_paise) : '' }),
        bar,
        el('span', { class: 'bar-day', text: label }));
    }));

    App.mount(lanes,
      lane('Awaiting payment', d.unpaid_count, 'warn', unpaid, 'Nothing is waiting for payment.', '#/orders?pay=unpaid', 'View unpaid orders'),
      lane('Needs tracking ID', d.no_track_count, 'warn', noTrack, 'Every shipment has a tracking ID.', '#/shipments?needs_tracking=1', 'Open shipments'),
      lane('Payments in this period', null, 'ok', pays, 'No payments in this period.', '#/payments?from=' + state.from + '&to=' + state.to, 'All payments'));

    App.mount(chart,
      el('h2', { text: d.by_month ? 'Billed per month' : 'Billed per day' }),
      d.overdue_count ? el('p', { class: 'muted', text: App.plural(d.overdue_count, 'order') + ' past the due date.' }) : null,
      bars);
    }

    App.mount(page,
      el('div', { class: 'page-head' },
        el('div', null, el('h1', { text: 'Dashboard' }), sub)),
      el('section', { class: 'card' }, bar),
      strip,
      lanes,
      chart);
    await load();
  });
}());

/* Orders list with filters. Filters live in the address bar. */
(function () {
  'use strict';
  const App = window.App;
  const { el, inr } = App;

  App.view('orders', { nav: 'orders', title: 'Orders' }, async (page) => {
    const p = App.getParams();
    const state = {
      q: p.get('q') || '', status: p.get('status') || 'active', pay: p.get('pay') || '', plan: p.get('plan') || '', salesperson: p.get('salesperson') || '',
      from: p.get('from') || '', to: p.get('to') || '', page: parseInt(p.get('page') || '1', 10) || 1, per: 25, total: 0,
    };

    const q = App.input({ type: 'search', value: state.q, placeholder: 'Order no, name, phone or tracking ID' });
    const status = App.select([['active', 'Active'], ['cancelled', 'Cancelled'], ['all', 'All']], state.status);
    const pay = App.select([['', 'Any'], ['unpaid', 'Unpaid'], ['partial', 'Part paid'], ['paid', 'Paid']], state.pay);
    const plan = App.select([['', 'Any'], ['prepaid', 'UPI'], ['advance', 'Partial paid'], ['cod', 'COD'], ['credit', 'On credit']], state.plan);
    let salesNames = [];
    try { salesNames = await App.api('api/orders.php', { params: { names: 1 } }); } catch (e) { salesNames = []; }
    if (state.salesperson && !salesNames.includes(state.salesperson)) salesNames.push(state.salesperson);
    const sales = App.select([['', 'Any']].concat(salesNames.map((n) => [n, n])), state.salesperson);
    sales.value = state.salesperson;
    const from = App.input({ type: 'date', value: state.from });
    const to = App.input({ type: 'date', value: state.to });
    const out = el('div', { class: 'stack' });
    const totals = el('div', { class: 'totals' });

    const params = () => ({
      q: state.q, status: state.status, pay: state.pay, plan: state.plan, salesperson: state.salesperson, from: state.from, to: state.to,
      page: state.page > 1 ? state.page : '', per: state.per,
    });

    let seq = 0;
    async function load() {
      App.setParams(Object.assign({}, params(), { per: '' }));
      const mine = ++seq;
      let d;
      try {
        d = await App.api('api/orders.php', { params: Object.assign({}, params(), { q: App.phoneQuery(state.q) }) });
      } catch (e) {
        App.mount(out, el('p', { class: 'alert alert-error', text: e.message }));
        return;
      }
      if (mine !== seq) return;
      state.total = d.total;
      state.page = d.page;
      App.mount(totals,
        el('span', null, App.plural(d.total, 'order') + ' · billed ', el('strong', { text: inr(d.billed_paise) })),
        el('span', null, 'Received ', el('strong', { text: inr(d.paid_paise) })),
        el('span', null, 'Balance ', el('strong', { text: inr(d.billed_paise - d.paid_paise) })),
        el('span', null, 'Profit ', el('strong', { text: inr(d.profit_paise) }), d.no_cost_orders ? el('span', { class: 'muted', text: ' (' + App.plural(d.no_cost_orders, 'order') + ' without purchase price not counted)' }) : null));
      App.mount(out,
        App.table([
          { label: 'Order', render: (o) => el('a', { class: 'tbl-link', href: '#/order?id=' + o.id, text: o.order_no }) },
          { label: 'Date', class: 'nowrap', render: (o) => App.fmtDate(o.order_date) },
          { label: 'Customer', render: (o) => el('span', null, el('a', { class: 'tbl-link', href: '#/customer?id=' + o.customer_id, text: o.customer_name }), el('span', { class: 'cell-sub', text: o.phone })) },
          { label: 'Salesman', render: (o) => o.salesperson || el('span', { class: 'muted', text: '–' }) },
          { label: 'Type', render: (o) => App.LABELS.plan[o.pay_plan] || o.pay_plan },
          { label: 'Total', class: 'right mono', render: (o) => inr(o.total_paise) },
          { label: 'Profit', class: 'right', render: (o) => App.profitCell(o.status === 'active' ? o.profit_paise : null, o.profit_pct) },
          { label: 'Paid', class: 'right mono', render: (o) => inr(o.paid_paise) },
          { label: 'Balance', class: 'right mono', render: (o) => (o.status === 'active' && o.total_paise - o.paid_paise > 0 ? el('span', { class: 'owe', text: inr(o.total_paise - o.paid_paise) }) : el('span', { class: 'muted', text: '' })) },
          { label: 'Payment', render: (o) => App.payChip(o) },
          { label: 'Shipment', render: (o) => el('span', null, App.shipChip(o.ship_status), o.tracking_id ? el('span', { class: 'cell-sub mono', text: o.tracking_id }) : null) },
        ], d.rows.map((o) => Object.assign({ _class: o.status === 'cancelled' ? 'row-cancelled' : '' }, o)), 'No orders match.'),
        App.pager(state, (n) => { state.page = n; load(); window.scrollTo(0, 0); }));
    }

    const apply = () => { state.page = 1; load(); };
    const typing = App.debounce(() => { state.q = q.value.trim(); apply(); }, 300);
    q.addEventListener('input', typing);
    [[status, 'status'], [pay, 'pay'], [plan, 'plan'], [sales, 'salesperson'], [from, 'from'], [to, 'to']].forEach(([node, key]) =>
      node.addEventListener('change', () => { state[key] = node.value; apply(); }));

    const reset = el('button', { type: 'button', class: 'btn btn-quiet', text: 'Clear filters', onclick: () => {
      Object.assign(state, { q: '', status: 'active', pay: '', plan: '', salesperson: '', from: '', to: '' });
      q.value = ''; status.value = 'active'; pay.value = ''; plan.value = ''; sales.value = ''; from.value = ''; to.value = '';
      apply();
    } });

    App.mount(page,
      el('div', { class: 'page-head' },
        el('h1', { text: 'Orders' }),
        el('div', { class: 'row-gap' },
          el('a', { class: 'btn', href: App.exportUrl('orders', state.from, state.to), text: 'Export Excel' }),
          el('a', { class: 'btn btn-primary', href: '#/order', text: 'New order' }))),
      el('section', { class: 'card' },
        el('div', { class: 'toolbar' },
          el('div', { class: 'field field-grow' }, el('span', { class: 'field-label', text: 'Search' }), q),
          App.field('Status', status), App.field('Payment', pay), App.field('Type', plan), App.field('Salesman', sales), App.field('From', from), App.field('To', to), reset),
        totals),
      out);
    await load();
  });
}());

/* One order: new, view, edit. */
(function () {
  'use strict';
  const App = window.App;
  const { el, inr } = App;

  let products = [];

  async function loadProducts() {
    try { products = (await App.api('api/products.php', { params: { active: 1, per: 200 } })).rows; } catch (e) { products = []; }
  }

  /* ------------------------------------------------------------------ */
  /* Form (new and edit)                                                */
  /* ------------------------------------------------------------------ */

  async function showForm(page, order) {
    const editing = !!order;
    await loadProducts();
    // Item types (white box, OG box, tester, gift set) with their fixed prices from the Item types page.
    let itemTypes = { types: [] };
    try { itemTypes = await App.api('api/item_types.php'); } catch (e) { /* page still works without types */ }
    const accounts = (await App.accounts()).filter((a) => a.is_active);
    let salesNames = [];
    try { salesNames = await App.api('api/orders.php', { params: { names: 1 } }); } catch (e) { salesNames = []; }

    let customer = editing ? order.customer : null;
    const wantCust = parseInt(App.getParams().get('customer_id') || '0', 10);
    if (!editing && wantCust) {
      try {
        const cd = (await App.api('api/customers.php', { params: { id: wantCust } }));
        customer = Object.assign({}, cd.customer, { bal: cd.summary.balance_paise });
      } catch (e) { customer = null; }
    }
    const err = el('div', { class: 'alert alert-error', role: 'alert', hidden: true });

    /* customer */
    const custBox = el('section', { class: 'card' });
    const newName = App.input({ placeholder: 'Customer name', maxlength: 120 });
    const newPhone = App.input({ placeholder: '10-digit mobile number', inputmode: 'numeric' });
    App.digitsOnly(newPhone, 10);
    const address = App.input({ placeholder: 'House, street, area', maxlength: 255, value: editing ? order.ship_address : '' });
    const city = App.input({ placeholder: 'City', maxlength: 60, value: editing ? order.ship_city : '' });
    const pin = App.input({ placeholder: 'Pincode', maxlength: 10, inputmode: 'numeric', value: editing ? order.ship_pincode : '' });
    App.autoCity(pin, city);

    if (customer && !editing) { address.value = customer.address || ''; city.value = customer.city || ''; pin.value = customer.pincode || ''; }

    function paintCustomer() {
      App.clear(custBox);
      custBox.appendChild(el('h2', { text: 'Customer' }));
      if (customer) {
        custBox.appendChild(el('div', { class: 'picked' },
          el('span', null, el('strong', { text: customer.name }), el('span', { class: 'muted', text: '  ' + customer.phone }),
            customer.bal > 0 || customer.balance_paise > 0 ? el('span', { class: 'owe', text: '  owes ' + inr(customer.bal || customer.balance_paise) }) : null),
          editing ? null : el('button', { type: 'button', class: 'btn btn-small', text: 'Change', onclick: () => { customer = null; paintCustomer(); } })));
      } else {
        const picker = App.customerPicker({ onSelect: (c) => {
          customer = c;
          if (!address.value) address.value = c.address || '';
          if (!city.value) city.value = c.city || '';
          if (!pin.value) pin.value = c.pincode || '';
          paintCustomer();
        } });
        custBox.appendChild(App.field('Find an existing customer', picker.el));
        custBox.appendChild(el('p', { class: 'muted small', text: 'New customer? Fill in the name and phone below. They are saved with this order.' }));
        custBox.appendChild(el('div', { class: 'form-grid' }, App.field('Name', newName), App.field('Phone', newPhone)));
      }
      custBox.appendChild(el('div', { class: 'form-grid form-grid-3' },
        el('div', { class: 'span-2' }, App.field('Delivery address', address)), App.field('City', city), App.field('Pincode', pin)));
    }

    /* items */
    const itemsBody = el('tbody');
    const itemRows = [];
    const itemsTable = el('table', { class: 'items-tbl' },
      el('thead', null, el('tr', null, ['Item', 'Type', 'Qty', 'Purchase (₹)', 'Selling (₹)', 'Amount', 'Profit', ''].map((h) => el('th', { class: h === 'Type' ? 'col-type' : '', text: h })))),
      itemsBody);
    // The Type column exists only for perfumes (catalog category "Perfume"). Hidden when no line needs it.
    const paintTypeCol = () => itemsTable.classList.toggle('no-types', !itemRows.some((r) => r.perfume));
    const isPerfume = (it) => it.src === 'catalog' && /perfume/i.test(it.category || '');
    const subtotalOut = el('span', { class: 'mono' });
    const totalOut = el('span', { class: 'mono' });
    const discount = App.moneyInput(editing ? order.discount_paise : 0, { 'aria-label': 'Order discount' });
    const shipping = App.moneyInput(editing ? order.shipping_paise : 0, { 'aria-label': 'Shipping charge' });
    const payAmount = App.moneyInput(0, { 'aria-label': 'Payment amount' });

    function lineAmount(r) {
      const qty = parseInt(r.qty.value, 10);
      if (r.rate.value.trim() === '') return null;
      const rate = App.toPaise(r.rate.value);
      if (!(qty >= 1) || rate === null || rate < 0) return null;
      return qty * rate;
    }

    /** Purchase price of one line in paise; null when the box is empty or not a number. */
    function lineCost(r) {
      if (r.cost.value.trim() === '') return null;
      const c = App.toPaise(r.cost.value);
      return c === null || c < 0 ? null : c;
    }

    function recalc() {
      let sub = 0;
      itemRows.forEach((r) => {
        const a = lineAmount(r);
        r.amt.textContent = a === null ? '' : inr(a);
        if (a) sub += a;
        // Profit of this line = what it sold for minus what it cost.
        const c = lineCost(r);
        const qty = parseInt(r.qty.value, 10);
        App.clear(r.profit);
        if (c !== null && a !== null && qty >= 1) r.profit.appendChild(App.profitCell(a - qty * c, a > 0 ? Math.round(((a - qty * c) / a) * 1000) / 10 : null));
      });
      const disc = App.toPaise(discount.value) || 0;
      const ship = App.toPaise(shipping.value) || 0;
      const total = sub - disc + ship;
      subtotalOut.textContent = inr(sub);
      totalOut.textContent = inr(total);
      if (!editing) {
        const paid = App.toPaise(payAmount.value) || 0;
        leftOut.textContent = total > 0 ? 'Order total ' + inr(total) + ' · paid now ' + inr(paid) + ' · left to pay ' + inr(Math.max(total - paid, 0)) : '';
      }
      return { sub, disc, ship, total };
    }

    function addRow(item) {
      const r = { product_id: item ? item.product_id : null, image: item && item.image ? item.image : '', src: '', picked: false };
      r.src = r.image ? (/^uploads\//.test(r.image) ? 'manual' : 'catalog') : '';
      r.name = App.input({ placeholder: 'Item name', maxlength: 160, value: item ? item.name : '', 'aria-label': 'Item name' });
      r.thumb = el('button', { type: 'button', class: 'item-thumb', 'aria-label': 'Add or change photo', title: 'Add or change photo' });
      r.tag = el('span', { class: 'item-tag', hidden: true });
      r.paint = () => {
        r.thumb.textContent = '';
        r.thumb.classList.toggle('has', !!r.image);
        if (r.image) {
          const im = el('img', { src: App.imgSrc(r.image), alt: '' });
          im.addEventListener('error', () => { im.remove(); r.thumb.textContent = '+'; r.thumb.classList.remove('has'); });
          r.thumb.appendChild(im);
        } else r.thumb.textContent = '+';
        r.tag.hidden = !r.src;
        r.tag.textContent = r.src === 'catalog' ? 'Catalog' : r.src === 'manual' ? 'Added manually' : '';
        r.tag.classList.toggle('cat', r.src === 'catalog');
      };
      // Perfume lines must have a type; the type decides the prices. Other products have no type and use their own price.
      r.perfume = !!(item && item.item_type);
      r.typeTd = el('td', { class: 'col-type', 'data-label': 'Type' });
      r.setPerfume = (on) => {
        r.perfume = on;
        r.typeTd.classList.toggle('type-off', !on);
        if (!on) r.type.value = '';
        paintTypeCol();
      };
      r.clearPick = () => { r.picked = false; r.image = ''; r.src = ''; r.product_id = null; r.paint(); r.setPerfume(false); };
      // Type decides the prices: pick a type and its purchase and selling price are filled in (you can still change them).
      const typeOpts = [['', 'Type']].concat(itemTypes.types.map((t) => [t.name, t.name]));
      // An older order may carry a type that was renamed or deleted since: keep it selectable.
      if (item && item.item_type && !itemTypes.types.some((t) => t.name === item.item_type)) typeOpts.push([item.item_type, item.item_type]);
      r.type = App.select(typeOpts, item ? (item.item_type || '') : '', { 'aria-label': 'Item type' });
      r.typeTd.appendChild(r.type);
      r.applyType = () => {
        const t = itemTypes.types.find((x) => x.name === r.type.value);
        if (!t) return;
        if (t.rate_paise > 0) r.rate.value = App.fromPaise(t.rate_paise);
        if (t.cost_paise > 0) r.cost.value = App.fromPaise(t.cost_paise);
      };
      r.apply = (it, src) => {
        r.name.value = it.name;
        r.setPerfume(isPerfume(it));
        if (r.perfume) {
          // No amount until the type is chosen: the type sets both prices. One piece per line.
          r.rate.value = ''; r.cost.value = ''; r.type.value = ''; r.qty.value = '1';
        } else {
          r.qty.value = '1';
          r.rate.value = it.price_paise > 0 ? App.fromPaise(it.price_paise) : '';
          r.cost.value = it.cost_paise > 0 ? App.fromPaise(it.cost_paise) : '';
          // Catalog product whose buying price did not come with the search: fetch it from the catalog.
          if (src === 'catalog' && !r.cost.value.trim() && it.catalog_id) {
            const want = it.name;
            App.catalogCost(it.catalog_id).then((c) => { if (c > 0 && r.name.value === want && !r.cost.value.trim()) { r.cost.value = App.fromPaise(c); recalc(); } });
          }
        }
        r.product_id = it.id || null;
        r.image = it.image || '';
        r.src = src;
        r.picked = true;
        r.paint();
        recalc();
        if (r.perfume) r.type.focus();
      };
      r.qty = App.input({ inputmode: 'numeric', value: item ? String(item.qty) : '1', 'aria-label': 'Quantity' });
      // Purchase price: empty means "not entered", 0 means it cost nothing.
      r.cost = App.moneyInput(item && item.cost_paise ? item.cost_paise : 0, { placeholder: 'Purchase', 'aria-label': 'Purchase price' });
      if (item && item.cost_paise === 0) r.cost.value = '0';
      r.rate = App.moneyInput(item ? item.rate_paise : 0, { placeholder: 'Selling', 'aria-label': 'Selling price' });
      // Quantity and both prices are never typed here: 1 piece per line, prices come from the catalog
      // (buying and selling price on the product) or, for perfumes, from the Item types page.
      [r.qty, r.cost, r.rate].forEach((n) => { n.readOnly = true; n.tabIndex = -1; n.classList.add('input-static'); });
      r.setPerfume(r.perfume);
      r.amt = el('td', { class: 'col-amt', 'data-label': 'Amount' });
      r.profit = el('td', { class: 'col-profit', 'data-label': 'Profit' });
      r.tr = el('tr', null,
        el('td', { class: 'col-name' }, el('div', { class: 'item-name' }, r.thumb, el('div', { class: 'item-main' }, r.name, r.tag))),
        r.typeTd,
        el('td', { class: 'col-qty', 'data-label': 'Qty' }, r.qty),
        el('td', { class: 'col-cost', 'data-label': 'Purchase' }, r.cost),
        el('td', { class: 'col-rate', 'data-label': 'Selling' }, r.rate),
        r.amt,
        r.profit,
        el('td', { class: 'col-x' }, el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove item', text: '×', onclick: () => {
          if (itemRows.length === 1) { r.name.value = ''; r.type.value = ''; r.cost.value = ''; r.rate.value = ''; r.qty.value = '1'; r.clearPick(); recalc(); return; }
          itemRows.splice(itemRows.indexOf(r), 1); r.tr.remove(); paintTypeCol(); recalc();
        } })));
      r.name.addEventListener('input', () => { if (r.picked) r.clearPick(); });
      r.name.addEventListener('change', () => {
        if (r.picked) { recalc(); return; }
        const hit = products.find((pr) => pr.name.toLowerCase() === r.name.value.trim().toLowerCase());
        if (hit) { r.product_id = hit.id; if (!r.rate.value) r.rate.value = App.fromPaise(hit.rate_paise); if (!r.cost.value.trim() && hit.cost_paise > 0) r.cost.value = App.fromPaise(hit.cost_paise); if (!r.image && hit.image) { r.image = hit.image; r.src = 'manual'; r.paint(); } } else { r.product_id = null; }
        recalc();
      });
      r.type.addEventListener('change', () => { if (r.type.value) r.applyType(); else { r.rate.value = ''; r.cost.value = ''; } recalc(); });
      r.thumb.addEventListener('click', async () => {
        r.thumb.disabled = true;
        try { const u = await App.pickPhoto(); if (u) { r.image = u; r.src = 'manual'; r.paint(); } } catch (e) { App.toast(e.message, 'error'); }
        r.thumb.disabled = false;
      });
      App.itemSuggest(r.name, { onPick: (it) => r.apply(it, it.src === 'catalog' ? 'catalog' : 'manual') });
      r.paint();
      [r.qty, r.cost, r.rate].forEach((n) => n.addEventListener('input', recalc));
      itemRows.push(r);
      itemsBody.appendChild(r.tr);
      paintTypeCol();
      return r;
    }

    if (editing) order.items.forEach(addRow); else addRow();
    discount.addEventListener('input', recalc);
    shipping.addEventListener('input', recalc);
    payAmount.addEventListener('input', recalc);

    /* order details */
    // Order date is fixed: today for a new order, the saved date when editing. Nobody can change it.
    const orderDateVal = editing ? order.order_date : App.today;
    const orderDate = el('div', { class: 'input input-static', text: App.fmtDate(orderDateVal) });
    // Salesman dropdown. "+ Add new salesman" saves a name to the list without leaving the order.
    const NEW_SALESMAN = '__new__';
    if (editing && order.salesperson && !salesNames.includes(order.salesperson)) salesNames.push(order.salesperson);
    const salesperson = el('select', { class: 'input', 'aria-label': 'Salesman' });
    function fillSalesmen(selected) {
      App.clear(salesperson);
      salesperson.appendChild(el('option', { value: '', text: 'Select salesman' }));
      salesNames.slice().sort((a, b) => a.localeCompare(b)).forEach((n) => salesperson.appendChild(el('option', { value: n, text: n })));
      salesperson.appendChild(el('option', { value: NEW_SALESMAN, text: '+ Add new salesman...' }));
      salesperson.value = selected || '';
    }
    let lastSalesman = editing ? (order.salesperson || '') : '';
    fillSalesmen(lastSalesman);
    salesperson.addEventListener('change', async () => {
      if (salesperson.value !== NEW_SALESMAN) { lastSalesman = salesperson.value; return; }
      const nm = await App.askText({ title: 'Add a salesman', label: 'Salesman name', placeholder: 'Name', okLabel: 'Add', required: true, maxlength: 60 });
      if (nm === null) { salesperson.value = lastSalesman; return; }
      try {
        const r = await App.api('api/salesmen.php', { body: { action: 'save', name: nm } });
        if (!salesNames.some((n) => n.toLowerCase() === r.name.toLowerCase())) salesNames.push(r.name);
        lastSalesman = r.name;
      } catch (e) {
        // Already in the list: just pick the existing one.
        const same = salesNames.find((n) => n.toLowerCase() === nm.toLowerCase());
        if (same) lastSalesman = same; else App.toast(e.message, 'error');
      }
      fillSalesmen(lastSalesman);
    });
    const notes = el('textarea', { class: 'input', maxlength: 500, placeholder: 'Notes (optional)' });
    if (editing) notes.value = order.notes || '';
    /* payment taken with a new order. The payment type is worked out from the amount:
       full amount = UPI (prepaid), part of it = Partial paid, nothing = COD. */
    const account = App.input({ list: 'account-list', placeholder: 'Type the account name', maxlength: 60, autocomplete: 'off', value: App.store.get('account_name') || '' });
    const payDate = App.input({ type: 'date', value: App.today });
    const leftOut = el('p', { class: 'muted small' });
    const fullBtn = el('button', { type: 'button', class: 'btn btn-small', text: 'Full amount', onclick: () => { const t = recalc().total; payAmount.value = t > 0 ? App.fromPaise(t) : ''; recalc(); } });
    const payBox = el('section', { class: 'card' },
      el('h2', { text: 'Payment received' }),
      el('div', { class: 'form-grid' },
        App.field('Amount (₹)', payAmount), App.field('Date', payDate),
        el('div', { class: 'span-2' }, App.field('Received in account', account), App.datalist('account-list', accounts.map((a) => a.name)))),
      el('div', { class: 'row-gap' }, fullBtn, el('span', { class: 'muted small', text: 'Leave empty for COD. Part of the total is saved as partial paid.' })),
      leftOut);
    payBox.hidden = editing;

    /* first shipment */
    const courier = App.input({ list: 'courier-list', placeholder: 'Courier', maxlength: 40, value: '' });
    const tracking = App.input({ class: 'input mono', placeholder: 'Tracking ID (add later if you do not have it)', maxlength: 60 });
    const shipStatus = App.select(Object.keys(App.LABELS.ship).map((k) => [k, App.LABELS.ship[k]]), 'pending');
    const shipBox = el('section', { class: 'card' },
      el('h2', { text: 'Shipment' }), App.datalist('courier-list', App.COURIERS),
      el('div', { class: 'form-grid form-grid-3' }, App.field('Courier', courier), App.field('Tracking ID', tracking), App.field('Status', shipStatus)));
    shipBox.hidden = editing;

    const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', text: editing ? 'Save changes' : 'Create order' });
    const cancelLink = el('a', { class: 'btn', href: editing ? '#/order?id=' + order.id : '#/orders', text: 'Cancel' });

    saveBtn.addEventListener('click', async () => {
      err.hidden = true;
      const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center' }); };

      const items = [];
      for (const r of itemRows) {
        const name = r.name.value.trim();
        if (name === '' && r.rate.value.trim() === '') continue;
        if (name === '') return fail('Enter a name for every item.');
        if (r.perfume && !r.type.value) return fail('Choose the type (white box, OG box ...) for "' + name + '".');
        if (r.rate.value.trim() === '') return fail('Enter the selling price for "' + name + '".');
        const qty = parseInt(r.qty.value, 10);
        const rate = App.toPaise(r.rate.value);
        const costP = r.cost.value.trim() === '' ? null : App.toPaise(r.cost.value);
        if (!(qty >= 1) || String(qty) !== r.qty.value.trim()) return fail('Quantity for "' + name + '" must be a whole number, 1 or more.');
        if (rate === null || rate < 0) return fail('Selling price for "' + name + '" is not a valid amount.');
        if (r.cost.value.trim() !== '' && (costP === null || costP < 0)) return fail('Purchase price for "' + name + '" is not a valid amount.');
        items.push({ product_id: r.product_id, name, qty, rate_paise: rate, cost_paise: costP, discount_paise: 0, image: r.image || '', item_type: r.type.value });
      }
      if (!items.length) return fail('Add at least one item.');
      const discP = App.toPaise(discount.value);
      const shipP = App.toPaise(shipping.value);
      if (discP === null || discP < 0) return fail('Order discount is not a valid amount.');
      if (shipP === null || shipP < 0) return fail('Shipping charge is not a valid amount.');

      const cust = customer
        ? { id: customer.id, address: address.value, city: city.value, pincode: pin.value }
        : { name: newName.value, phone: newPhone.value, address: address.value, city: city.value, pincode: pin.value };
      if (!customer && !newName.value.trim()) return fail('Enter the customer name.');
      if (!customer && !/^\d{10}$/.test(newPhone.value.trim())) return fail('Enter the 10-digit mobile number.');
      if (!address.value.trim()) return fail('Enter the delivery address.');
      if (!city.value.trim()) return fail('Enter the city.');
      if (!pin.value.trim()) return fail('Enter the pincode.');
      if (salesperson.value === '' || salesperson.value === NEW_SALESMAN) return fail('Select the salesman.');

      const total = recalc().total;
      const amt = editing ? null : App.toPaise(payAmount.value);
      if (!editing && amt === null) return fail('Payment amount is not valid.');
      if (!editing && amt > total) return fail('The payment is more than the order total.');
      const payPlan = editing ? order.pay_plan : (amt > 0 ? (amt >= total ? 'prepaid' : 'advance') : 'cod');
      const body = {
        action: 'save', id: editing ? order.id : null, customer: cust, items, discount_paise: discP, shipping_paise: shipP,
        order_date: orderDateVal, due_date: editing ? (order.due_date || null) : null, pay_plan: payPlan, source: editing ? (order.source || 'WhatsApp') : 'WhatsApp', salesperson: salesperson.value === NEW_SALESMAN ? '' : salesperson.value, notes: notes.value,
      };
      if (!editing) {
        body.shipment = { courier: courier.value, tracking_id: tracking.value, status: shipStatus.value };
        if (amt > 0) {
          if (!account.value.trim()) return fail('Type the account that received the money.');
          body.payment = { amount_paise: amt, account_name: account.value.trim(), received_on: payDate.value };
        }
      }
      saveBtn.disabled = true;
      try {
        const r = await App.api('api/orders.php', { body });
        if (!editing && body.payment) { App.store.set('account_name', account.value.trim()); }
        App.toast((editing ? 'Order saved: ' : 'Order created: ') + r.order_no);
        location.replace('#/order?id=' + r.id);
      } catch (e) {
        saveBtn.disabled = false;
        fail(e.message);
      }
    });

    paintCustomer();
    recalc();

    App.mount(page,
      el('div', { class: 'page-head' },
        el('h1', { text: editing ? 'Edit ' + order.order_no : 'New order' }),
        el('div', { class: 'row-gap' }, cancelLink, saveBtn)),
      err,
      el('div', { class: 'order-grid' },
        el('div', { class: 'order-main' },
          custBox,
          el('section', { class: 'card' },
            el('h2', { text: 'Items' }),
            el('div', { class: 'table-wrap' }, itemsTable),
            el('div', null, el('button', { type: 'button', class: 'btn btn-small', text: 'Add item', onclick: () => { const r = addRow(); r.name.focus(); } }))),
          el('section', { class: 'card' }, el('h2', { text: 'Notes' }), notes),
          shipBox),
        el('div', { class: 'order-side' },
          el('section', { class: 'card' },
            el('h2', { text: 'Order details' }),
            App.field('Order date', orderDate),
            App.field('Salesman', salesperson)),
          el('section', { class: 'card' },
            el('h2', { text: 'Summary' }),
            el('div', { class: 'sum-row' }, el('span', { text: 'Items total' }), subtotalOut),
            el('div', { class: 'sum-row' }, el('span', { text: 'Discount (₹)' }), discount),
            el('div', { class: 'sum-row' }, el('span', { text: 'Shipping (₹)' }), shipping),
            el('div', { class: 'sum-row sum-total' }, el('span', { text: 'Total' }), totalOut)),
          payBox)));
    if (!customer) { /* picker already focused by user click */ }
  }

  /* ------------------------------------------------------------------ */
  /* View                                                               */
  /* ------------------------------------------------------------------ */

  async function showOrder(page, id) {
    let o;
    o = await App.api('api/orders.php', { params: { id } });
    document.title = (App.env === 'test' ? '[TEST] ' : '') + o.order_no + ' - ' + App.appName;
    const reload = () => showOrder(page, id).catch((e) => App.toast(e.message, 'error'));
    const cancelled = o.status === 'cancelled';

    let upi = '';
    try { upi = (await App.api('api/settings.php')).profile.upi_id || ''; } catch (e) { /* optional */ }

    const lines = o.items.map((i) => '• ' + App.itemLabel(i) + ' x ' + i.qty + ' = ' + inr(i.amount_paise)).join('\n');
    let msg = 'Hi ' + o.customer.name + ',\nYour order ' + o.order_no + ' is confirmed.\n\n' + lines + '\n';
    if (o.shipping_paise) msg += 'Shipping: ' + inr(o.shipping_paise) + '\n';
    if (o.discount_paise) msg += 'Discount: -' + inr(o.discount_paise) + '\n';
    msg += 'Total: ' + inr(o.total_paise) + '\nPaid: ' + inr(o.paid_paise) + '\n';
    if (o.balance_paise > 0) msg += 'Balance due: ' + inr(o.balance_paise) + '\n' + (upi ? 'Pay by UPI: ' + upi + '\n' : '');
    const tracked = o.shipments.filter((s) => s.tracking_id);
    if (tracked.length) msg += '\nTracking: ' + tracked.map((s) => (s.courier ? s.courier + ' ' : '') + s.tracking_id).join(', ') + '\n';
    msg += '\nThank you!';

    const actions = [];
    actions.push(el('a', { class: 'btn', href: '#/invoice?id=' + o.id, text: 'Invoice' }));
    actions.push(el('a', { class: 'btn', href: App.waLink(o.customer.phone, msg), target: '_blank', rel: 'noopener', text: 'WhatsApp customer' }));
    if (!cancelled) {
      actions.push(el('a', { class: 'btn', href: '#/order?id=' + o.id + '&edit=1', text: 'Edit' }));
      if (o.balance_paise > 0) actions.push(el('button', { type: 'button', class: 'btn btn-primary', text: 'Record payment', onclick: () =>
        App.paymentModal({ customer: o.customer, order: { id: o.id, order_no: o.order_no, balance_paise: o.balance_paise }, onSaved: reload }) }));
      if (o.paid_paise > 0) actions.push(el('button', { type: 'button', class: 'btn', text: 'Refund', onclick: () =>
        App.paymentModal({ customer: o.customer, order: { id: o.id, order_no: o.order_no, balance_paise: o.balance_paise }, refund: true, onSaved: reload }) }));
      actions.push(el('button', { type: 'button', class: 'btn', text: 'Cancel order', onclick: async () => {
        const reason = await App.askText({ title: 'Cancel ' + o.order_no, message: 'The order stays in your records but stops counting as sales. Money already received is not removed; refund it separately if needed.', label: 'Reason', okLabel: 'Cancel order', danger: true, required: true });
        if (reason === null) return;
        try { await App.api('api/orders.php', { body: { action: 'cancel', id: o.id, reason } }); App.toast('Order cancelled.'); reload(); } catch (e) { App.toast(e.message, 'error'); }
      } }));
    } else {
      actions.push(el('button', { type: 'button', class: 'btn btn-primary', text: 'Restore order', onclick: async () => {
        try { await App.api('api/orders.php', { body: { action: 'restore', id: o.id } }); App.toast('Order restored.'); reload(); } catch (e) { App.toast(e.message, 'error'); }
      } }));
    }

    const itemsTable = App.table([
      { label: 'Item', render: (i) => el('span', { class: 'item-cell' }, App.thumb(i.name, i.image, 'thumb-sm'), el('span', null, i.name, i.item_type_name ? el('span', { class: 'chip chip-muted type-chip', text: i.item_type_name }) : null)) },
      { label: 'Qty', class: 'right', render: (i) => String(i.qty) },
      { label: 'Purchase', class: 'right mono', render: (i) => (i.cost_paise === null ? el('span', { class: 'muted', text: '–' }) : inr(i.cost_paise)) },
      { label: 'Selling', class: 'right mono', render: (i) => inr(i.rate_paise) },
      { label: 'Amount', class: 'right mono', render: (i) => inr(i.amount_paise) },
      { label: 'Profit', class: 'right', render: (i) => {
        if (i.cost_paise === null) return App.profitCell(null);
        const pr = i.amount_paise - i.qty * i.cost_paise;
        return App.profitCell(pr, i.amount_paise > 0 ? Math.round((pr / i.amount_paise) * 1000) / 10 : null);
      } },
    ], o.items);

    const payTable = App.table([
      { label: 'Date', class: 'nowrap', render: (p) => App.fmtDate(p.received_on) },
      { label: 'Type', render: (p) => App.LABELS.purpose[p.purpose] || p.purpose },
      { label: 'Account', render: (p) => el('span', null, p.account_name, el('span', { class: 'cell-sub', text: App.LABELS.method[p.method] + (p.reference ? ' · ' + p.reference : '') })) },
      { label: 'Amount', class: 'right mono', render: (p) => (p.type === 'refund' ? '-' : '') + inr(p.amount_paise) },
      { label: '', class: 'right', render: (p) => (p.voided_at
        ? App.chip('Cancelled', 'muted')
        : el('button', { type: 'button', class: 'btn btn-small', text: 'Cancel', onclick: async () => {
          const reason = await App.askText({ title: 'Cancel this payment?', message: 'Use this for a wrong entry. It stops counting in totals but stays in the log.', label: 'Reason', okLabel: 'Cancel payment', danger: true, required: true });
          if (reason === null) return;
          try { await App.api('api/payments.php', { body: { action: 'void', id: p.id, reason } }); App.toast('Payment cancelled.'); reload(); } catch (e) { App.toast(e.message, 'error'); }
        } })) },
    ], o.payments.map((p) => Object.assign({ _class: p.voided_at ? 'row-void' : '' }, p)), 'No payments yet.');

    const parcelText = (s) => [
      s.length_cm && s.breadth_cm && s.height_cm ? s.length_cm + ' × ' + s.breadth_cm + ' × ' + s.height_cm + ' cm' : '',
      s.weight_kg ? s.weight_kg + ' kg' : '',
    ].filter(Boolean).join(' · ');

    const shipLines = o.shipments.map((s) => el('div', { class: 'track-line' },
      App.shipChip(s.status),
      el('span', { text: s.courier || 'Courier not set' }),
      s.tracking_id ? el('span', { class: 'mono strong', text: s.tracking_id }) : el('span', { class: 'muted', text: 'No tracking ID yet' }),
      parcelText(s) ? el('span', { class: 'muted small', text: parcelText(s) }) : null,
      el('span', { class: 'spacer' }),
      s.tracking_id || cancelled ? null : el('button', { type: 'button', class: 'btn btn-small', text: 'Get AWB from Shiprocket', onclick: (e) => App.fetchAwb(s.id, e.currentTarget, reload) }),
      el('button', { type: 'button', class: 'btn btn-small', text: s.tracking_id ? 'Edit' : 'Add tracking ID', onclick: () => App.trackingModal({ shipment: s, title: 'Tracking for ' + o.order_no, onSaved: reload }) })));

    const addShip = el('button', { type: 'button', class: 'btn btn-small', text: 'Add another parcel', onclick: async () => {
      try { await App.api('api/shipments.php', { body: { action: 'add', order_id: o.id } }); reload(); } catch (e) { App.toast(e.message, 'error'); }
    } });

    const kvRow = (k, v) => [el('dt', { text: k }), el('dd', null, v)];

    App.mount(page,
      el('div', { class: 'page-head' },
        el('div', null,
          el('h1', null, o.order_no, ' ', cancelled ? App.chip('Cancelled', 'muted') : App.payChip(o)),
          el('p', { class: 'page-sub', text: App.fmtDate(o.order_date) + ' · ' + (App.LABELS.plan[o.pay_plan] || o.pay_plan) + (o.salesperson ? ' · Salesman ' + o.salesperson : '') + (o.invoice_no ? ' · Invoice ' + o.invoice_no : '') })),
        el('div', { class: 'row-gap' }, actions)),
      cancelled ? el('div', { class: 'status-banner', text: 'This order is cancelled' + (o.cancel_reason ? ': ' + o.cancel_reason : '.') }) : null,
      el('div', { class: 'order-grid' },
        el('div', { class: 'order-main' },
          el('section', { class: 'card' }, el('h2', { text: 'Items' }), itemsTable, o.notes ? el('p', { class: 'muted pre', text: 'Notes: ' + o.notes }) : null),
          el('section', { class: 'card' }, el('h2', { text: 'Payments' }), payTable)),
        el('div', { class: 'order-side' },
          el('section', { class: 'card' },
            el('h2', { text: 'Summary' }),
            el('div', { class: 'sum-row' }, el('span', { text: 'Items total' }), el('span', { class: 'mono', text: inr(o.subtotal_paise) })),
            o.discount_paise ? el('div', { class: 'sum-row' }, el('span', { text: 'Discount' }), el('span', { class: 'mono', text: '-' + inr(o.discount_paise) })) : null,
            o.shipping_paise ? el('div', { class: 'sum-row' }, el('span', { text: 'Shipping' }), el('span', { class: 'mono', text: inr(o.shipping_paise) })) : null,
            el('div', { class: 'sum-row sum-total' }, el('span', { text: 'Total' }), el('span', { class: 'mono', text: inr(o.total_paise) })),
            el('div', { class: 'sum-row sum-paid' }, el('span', { text: 'Received' }), el('span', { class: 'mono', text: inr(o.paid_paise) })),
            !cancelled ? el('div', { class: 'sum-row ' + (o.balance_paise > 0 ? 'sum-due' : '') }, el('span', { text: 'Balance' }), el('span', { class: 'mono', text: inr(o.balance_paise) })) : null,
            o.due_date && !cancelled && o.balance_paise > 0 ? el('p', { class: 'muted small', text: 'Payment due by ' + App.fmtDate(o.due_date) + (o.due_date < App.today ? ' (overdue)' : '') }) : null),
          el('section', { class: 'card' },
            el('h2', { text: 'Profit' }),
            o.profit
              ? el('div', { class: 'profit-rows' },
                el('div', { class: 'sum-row' }, el('span', { text: 'Sold for (after discount)' }), el('span', { class: 'mono', text: inr(o.profit.base_paise) })),
                el('div', { class: 'sum-row' }, el('span', { text: 'Purchase cost' }), el('span', { class: 'mono', text: inr(o.profit.cost_paise) })),
                el('div', { class: 'sum-row sum-total' }, el('span', { text: 'Profit' }), App.profitCell(o.profit.profit_paise, o.profit.pct)))
              : el('p', { class: 'muted small', text: 'No profit yet. Edit the order and type the purchase price on every item.' }),
            el('p', { class: 'muted small', text: 'Only you see this. It is not on the invoice. Shipping is not counted.' })),
          el('section', { class: 'card' },
            el('h2', { text: 'Customer' }),
            el('dl', { class: 'kv' },
              kvRow('Name', App.link('#/customer?id=' + o.customer.id, o.customer.name)),
              kvRow('Phone', o.customer.phone),
              kvRow('Deliver to', [o.ship_address, o.ship_city, o.ship_pincode].filter(Boolean).join(', ') || 'Not set'),
              kvRow('Account balance', App.balanceText(o.customer.balance_paise)))),
          el('section', { class: 'card' }, el('h2', { text: 'Shipment' }), shipLines.length ? shipLines : el('p', { class: 'muted', text: 'No shipment yet.' }), cancelled ? null : addShip))));
  }

  App.view('order', { nav: 'orders', title: 'Order' }, async (page) => {
    const p = App.getParams();
    const id = parseInt(p.get('id') || '0', 10);
    if (!id) { await showForm(page, null); return; }
    if (p.get('edit') === '1') {
      const o = await App.api('api/orders.php', { params: { id } });
      if (o.status !== 'active') { location.replace('#/order?id=' + id); return; }
      await showForm(page, o);
      return;
    }
    await showOrder(page, id);
  });
}());

/* All payments, with filters and per-account totals. */
(function () {
  'use strict';
  const App = window.App;
  const { el, inr } = App;

  App.view('payments', { nav: 'payments', title: 'Payments' }, async (page) => {
    const p = App.getParams();
    const state = {
      q: p.get('q') || '', method: ['upi', 'partial'].includes(p.get('method')) ? p.get('method') : '', type: ['received', 'refund'].includes(p.get('type')) ? p.get('type') : '',
      from: p.get('from') || '', to: p.get('to') || '', include_void: p.get('include_void') || '',
      page: parseInt(p.get('page') || '1', 10) || 1, per: 25, total: 0,
    };

    const q = App.input({ type: 'search', value: state.q, placeholder: 'Customer, phone, order no or UTR' });
    const method = App.select([['', 'Any'], ['upi', 'UPI'], ['partial', 'Partial paid']], state.method);
    const type = App.select([['', 'Both'], ['received', 'Received'], ['refund', 'Refunds']], state.type);
    const from = App.input({ type: 'date', value: state.from });
    const to = App.input({ type: 'date', value: state.to });
    const voided = el('input', { type: 'checkbox', checked: state.include_void === '1' });
    const accountStrip = el('div', { class: 'stats' });
    const totals = el('div', { class: 'totals' });
    const out = el('div', { class: 'stack' });

    const params = () => ({
      q: state.q, method: state.method, type: state.type,
      from: state.from, to: state.to, include_void: state.include_void, page: state.page > 1 ? state.page : '', per: state.per,
    });

    let seq = 0;
    async function load() {
      App.setParams(Object.assign({}, params(), { per: '' }));
      const mine = ++seq;
      let d;
      try { d = await App.api('api/payments.php', { params: params() }); } catch (e) { App.mount(out, el('p', { class: 'alert alert-error', text: e.message })); return; }
      if (mine !== seq) return;
      state.total = d.total;
      state.page = d.page;

      // One box per account, then a Total box with all accounts added up (same filters).
      App.mount(accountStrip, d.by_account.length
        ? d.by_account.map((a) => el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: a.name }), el('span', { class: 'kpi-value', text: inr(a.net_paise) }), el('span', { class: 'kpi-sub', text: 'received in this account' })))
            .concat([el('div', { class: 'kpi kpi-total' }, el('span', { class: 'kpi-label', text: 'Total' }), el('span', { class: 'kpi-value credit', text: inr(d.by_account.reduce((t, a) => t + a.net_paise, 0)) }), el('span', { class: 'kpi-sub', text: 'all accounts together' }))])
        : el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: 'No payments in this view' })));
      App.mount(totals,
        el('span', null, 'Received ', el('strong', { text: inr(d.received_paise) })),
        el('span', null, 'Refunded ', el('strong', { text: inr(d.refunds_paise) })),
        el('span', null, 'Net ', el('strong', { text: inr(d.received_paise - d.refunds_paise) })));

      App.mount(out,
        App.table([
          { label: 'Date', class: 'nowrap', render: (x) => App.fmtDate(x.received_on) },
          { label: 'Customer', render: (x) => el('span', null, el('a', { class: 'tbl-link', href: '#/customer?id=' + x.customer_id, text: x.customer_name }), el('span', { class: 'cell-sub', text: x.phone })) },
          { label: 'Order', render: (x) => (x.order_id ? el('a', { class: 'tbl-link', href: '#/order?id=' + x.order_id, text: x.order_no }) : el('span', { class: 'muted', text: 'On account' })) },
          { label: 'Type', render: (x) => App.LABELS.purpose[x.purpose] || x.purpose },
          { label: 'Received in', render: (x) => el('span', null, x.account_name, x.reference ? el('span', { class: 'cell-sub', text: x.reference }) : null) },
          { label: 'Amount', class: 'right mono', render: (x) => el('span', { class: x.type === 'refund' ? 'owe' : '', text: (x.type === 'refund' ? '-' : '') + inr(x.amount_paise) }) },
          { label: '', class: 'right', render: (x) => (x.voided_at
            ? el('span', { class: 'chip chip-muted', title: x.void_reason, text: 'Cancelled' })
            : el('button', { type: 'button', class: 'btn btn-small', text: 'Cancel', onclick: async () => {
              const reason = await App.askText({ title: 'Cancel this payment?', message: 'Use this for a wrong entry. It stops counting in totals but stays in the log.', label: 'Reason', okLabel: 'Cancel payment', danger: true, required: true });
              if (reason === null) return;
              try { await App.api('api/payments.php', { body: { action: 'void', id: x.id, reason } }); App.toast('Payment cancelled.'); load(); } catch (e) { App.toast(e.message, 'error'); }
            } })) },
        ], d.rows.map((x) => Object.assign({ _class: x.voided_at ? 'row-void' : '' }, x)), 'No payments match.'),
        App.pager(state, (n) => { state.page = n; load(); window.scrollTo(0, 0); }));
    }

    const apply = () => { state.page = 1; load(); };
    q.addEventListener('input', App.debounce(() => { state.q = q.value.trim(); apply(); }, 300));
    [[method, 'method'], [type, 'type'], [from, 'from'], [to, 'to']].forEach(([n, k]) =>
      n.addEventListener('change', () => { state[k] = n.value; apply(); }));
    voided.addEventListener('change', () => { state.include_void = voided.checked ? '1' : ''; apply(); });

    App.mount(page,
      el('div', { class: 'page-head' },
        el('h1', { text: 'Payments' }),
        el('div', { class: 'row-gap' },
          el('a', { class: 'btn', href: App.exportUrl('payments', state.from, state.to), text: 'Export Excel' }),
          el('button', { type: 'button', class: 'btn btn-primary', text: 'Record payment', onclick: () => App.paymentModal({ onSaved: load }) }))),
      accountStrip,
      el('section', { class: 'card' },
        el('div', { class: 'toolbar' },
          el('div', { class: 'field field-grow' }, el('span', { class: 'field-label', text: 'Search' }), q),
          App.field('Payment type', method), App.field('Received / refund', type), App.field('From', from), App.field('To', to)),
        el('label', { class: 'check' }, voided, 'Show cancelled payments'),
        totals),
      out);
    await load();
  });
}());

/* Customer list and the add/edit customer form. */
(function () {
  'use strict';
  const App = window.App;
  const { el, inr } = App;

  App.view('customers', { nav: 'customers', title: 'Customers' }, async (page) => {
    const p = App.getParams();
    const state = { q: p.get('q') || '', filter: p.get('filter') || 'all', sort: p.get('sort') || 'name', page: parseInt(p.get('page') || '1', 10) || 1, per: 25, total: 0 };
    const q = App.input({ type: 'search', value: state.q, placeholder: 'Name, phone or city' });
    const sort = App.select([['name', 'Name'], ['balance', 'Highest balance'], ['recent', 'Latest order']], state.sort);
    const chips = el('div', { class: 'filters', role: 'group', 'aria-label': 'Filter' });
    const totals = el('div', { class: 'totals' });
    const out = el('div', { class: 'stack' });

    const FILTERS = [['all', 'All'], ['owes', 'Owe money'], ['settled', 'Settled']];
    const paintChips = () => App.mount(chips, FILTERS.map(([k, t]) => el('button', {
      type: 'button', class: 'filter-chip' + (state.filter === k ? ' filter-on' : ''), text: t, 'aria-pressed': state.filter === k ? 'true' : 'false',
      onclick: () => { state.filter = k; state.page = 1; paintChips(); load(); },
    })));

    let seq = 0;
    async function load() {
      App.setParams({ q: state.q, filter: state.filter === 'all' ? '' : state.filter, sort: state.sort === 'name' ? '' : state.sort, page: state.page > 1 ? state.page : '' });
      const mine = ++seq;
      let d;
      try { d = await App.api('api/customers.php', { params: { q: App.phoneQuery(state.q), filter: state.filter, sort: state.sort, page: state.page, per: state.per } }); } catch (e) { App.mount(out, el('p', { class: 'alert alert-error', text: e.message })); return; }
      if (mine !== seq) return;
      state.total = d.total;
      state.page = d.page;
      App.mount(totals, el('span', null, App.plural(d.total, 'customer')), el('span', null, 'They owe you ', el('strong', { text: inr(d.owed_paise) })));
      App.mount(out,
        App.table([
          { label: 'Customer', render: (c) => el('span', null, el('a', { class: 'tbl-link', href: '#/customer?id=' + c.id, text: c.name }), el('span', { class: 'cell-sub', text: c.phone })) },
          { label: 'City', render: (c) => c.city || '' },
          { label: 'Orders', class: 'right', render: (c) => String(c.orders_n) },
          { label: 'Last order', class: 'nowrap', render: (c) => (c.last_order ? App.fmtDate(c.last_order) : '') },
          { label: 'Balance', class: 'right', render: (c) => App.balanceText(c.bal) },
          { label: '', class: 'right', render: (c) => el('div', { class: 'row-gap row-end' },
            c.bal > 0
              ? el('a', { class: 'btn btn-small', href: App.waLink(c.phone, 'Hi ' + c.name + ', a gentle reminder: ' + inr(c.bal) + ' is pending with us. Please let us know once paid. Thank you!'), target: '_blank', rel: 'noopener', text: 'Remind on WhatsApp' })
              : null,
            el('button', { type: 'button', class: 'btn btn-small', text: 'Edit', onclick: () => App.customerModal({ customer: c, onSaved: load }) }),
            el('button', { type: 'button', class: 'btn btn-small btn-danger-ghost', text: 'Delete', onclick: () => App.deleteCustomer(c, load) })) },
        ], d.rows, 'No customers found.'),
        App.pager(state, (n) => { state.page = n; load(); window.scrollTo(0, 0); }));
    }

    q.addEventListener('input', App.debounce(() => { state.q = q.value.trim(); state.page = 1; load(); }, 300));
    sort.addEventListener('change', () => { state.sort = sort.value; state.page = 1; load(); });
    paintChips();

    App.mount(page,
      el('div', { class: 'page-head' },
        el('h1', { text: 'Customers' }),
        el('div', { class: 'row-gap' },
          el('a', { class: 'btn', href: App.exportUrl('customers'), text: 'Export Excel' }),
          el('button', { type: 'button', class: 'btn btn-primary', text: 'Add customer', onclick: () => App.customerModal({ onSaved: (id) => { location.href = '#/customer?id=' + id; } }) }))),
      el('section', { class: 'card' },
        el('div', { class: 'toolbar' }, el('div', { class: 'field field-grow' }, el('span', { class: 'field-label', text: 'Search' }), q), App.field('Sort by', sort)),
        chips, totals),
      out);
    await load();
  });
}());

/* One customer: balance, ledger, orders. */
(function () {
  'use strict';
  const App = window.App;
  const { el, inr } = App;

  function stat(label, node, sub) {
    return el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: label }), el('span', { class: 'kpi-value', text: '' }, node), el('span', { class: 'kpi-sub', text: sub || '' }));
  }

  async function show(page, id) {
    const d = await App.api('api/customers.php', { params: { id } });
    const c = d.customer;
    const s = d.summary;
    document.title = (App.env === 'test' ? '[TEST] ' : '') + c.name + ' - ' + App.appName;
    const reload = () => show(page, id).catch((e) => App.toast(e.message, 'error'));

    const pending = d.orders.filter((o) => o.status === 'active' && o.total_paise - o.paid_paise > 0);
    let msg = 'Hi ' + c.name + ', here is your account summary.\n\nTotal billed: ' + inr(s.billed_paise) + '\nTotal paid: ' + inr(s.received_paise) + '\n';
    if (s.balance_paise > 0) {
      msg += 'Balance due: ' + inr(s.balance_paise) + '\n';
      if (pending.length) msg += '\nPending orders:\n' + pending.map((o) => '• ' + o.order_no + ' (' + App.fmtDate(o.order_date, false) + '): ' + inr(o.total_paise - o.paid_paise)).join('\n') + '\n';
      msg += '\nPlease share the payment screenshot once paid. Thank you!';
    } else if (s.balance_paise < 0) {
      msg += 'Advance with us: ' + inr(-s.balance_paise) + '\n\nThank you!';
    } else {
      msg += 'Nothing is pending. Thank you!';
    }

    const ledger = App.table([
      { label: 'Date', class: 'nowrap', render: (e) => App.fmtDate(e.date) },
      { label: 'Entry', render: (e) => (e.order_id
        ? el('span', null, e.kind === 'order' ? 'Order ' : (e.text + ' · '), el('a', { class: 'tbl-link', href: '#/order?id=' + e.order_id, text: e.order_no }))
        : e.text + (e.kind === 'payment' && e.purpose ? ' · ' + (App.LABELS.purpose[e.purpose] || '') : '')) },
      { label: 'Received in', render: (e) => (e.account ? el('span', null, e.account, el('span', { class: 'cell-sub', text: (App.LABELS.method[e.method] || '') + (e.ref ? ' · ' + e.ref : '') })) : '') },
      { label: 'Billed', class: 'right mono', render: (e) => (e.debit ? inr(e.debit) : '') },
      { label: 'Paid', class: 'right mono', render: (e) => (e.credit ? inr(e.credit) : '') },
      { label: 'Balance', class: 'right mono', render: (e) => (e.balance < 0 ? inr(-e.balance) + ' cr' : inr(e.balance)) },
    ], d.ledger, 'Nothing recorded for this customer yet.');

    const orders = App.table([
      { label: 'Order', render: (o) => el('a', { class: 'tbl-link', href: '#/order?id=' + o.id, text: o.order_no }) },
      { label: 'Date', class: 'nowrap', render: (o) => App.fmtDate(o.order_date) },
      { label: 'Total', class: 'right mono', render: (o) => inr(o.total_paise) },
      { label: 'Paid', class: 'right mono', render: (o) => inr(o.paid_paise) },
      { label: 'Payment', render: (o) => App.payChip(o) },
      { label: 'Shipment', render: (o) => el('span', null, App.shipChip(o.ship_status), o.tracking_id ? el('span', { class: 'cell-sub mono', text: o.tracking_id }) : null) },
    ], d.orders.map((o) => Object.assign({ _class: o.status === 'cancelled' ? 'row-cancelled' : '' }, o)), 'No orders yet.');

    const where = [c.address, c.city, c.pincode].filter(Boolean).join(', ');
    App.mount(page,
      el('div', { class: 'page-head' },
        el('div', null, el('h1', { text: c.name }), el('p', { class: 'page-sub', text: c.phone + (where ? ' · ' + where : '') })),
        el('div', { class: 'row-gap' },
          el('a', { class: 'btn', href: App.waLink(c.phone, msg), target: '_blank', rel: 'noopener', text: 'Send statement' }),
          el('button', { type: 'button', class: 'btn', text: 'Edit', onclick: () => App.customerModal({ customer: c, onSaved: reload }) }),
          el('button', { type: 'button', class: 'btn btn-danger-ghost', text: 'Delete', onclick: () => App.deleteCustomer(c, () => { location.href = '#/customers'; }) }),
          el('button', { type: 'button', class: 'btn', text: 'Record payment', onclick: () => App.paymentModal({ customer: c, onSaved: reload }) }),
          el('a', { class: 'btn btn-primary', href: '#/order?customer_id=' + c.id, text: 'New order' }))),
      c.notes ? el('p', { class: 'muted', text: 'Note: ' + c.notes }) : null,
      el('div', { class: 'stats' },
        stat('Balance', App.balanceText(s.balance_paise), s.balance_paise > 0 ? 'owes you' : (s.balance_paise < 0 ? 'you hold their money' : 'all settled')),
        stat('Total billed', document.createTextNode(inr(s.billed_paise)), App.plural(s.orders, 'order')),
        stat('Total received', document.createTextNode(inr(s.received_paise)), 'after refunds')),
      el('section', { class: 'card' }, el('h2', { text: 'Ledger' }), ledger,
        el('p', { class: 'ledger-note', text: 'Billed adds to what they owe, paid reduces it. "cr" means you hold their money.' })),
      el('section', { class: 'card' }, el('h2', { text: 'Orders' }), orders));
  }

  App.view('customer', { nav: 'customers', title: 'Customer' }, async (page) => {
    const id = parseInt(App.getParams().get('id') || '0', 10);
    if (!id) { location.replace('#/customers'); return; }
    await show(page, id);
  });
}());

/* Shipments: fill in tracking IDs and move parcels along. */
(function () {
  'use strict';
  const App = window.App;
  const { el } = App;

  App.view('shipments', { nav: 'shipments', title: 'Shipments' }, async (page) => {
    const p = App.getParams();
    const state = { q: p.get('q') || '', status: p.get('status') || '', needs: p.get('needs_tracking') === '1', page: parseInt(p.get('page') || '1', 10) || 1, per: 25, total: 0 };
    const q = App.input({ type: 'search', value: state.q, placeholder: 'Tracking ID, order no, name or phone' });
    const chips = el('div', { class: 'filters', role: 'group', 'aria-label': 'Filter' });
    const out = el('div', { class: 'stack' });
    let counts = null;

    const params = () => ({ q: state.q, status: state.needs ? '' : state.status, needs_tracking: state.needs ? 1 : '', page: state.page > 1 ? state.page : '', per: state.per });

    function paintChips() {
      if (!counts) return;
      const items = [['needs', 'Needs tracking ID', counts.needs_tracking], ['', 'All', counts.all]]
        .concat(Object.keys(App.LABELS.ship).map((k) => [k, App.LABELS.ship[k], counts[k]]));
      App.mount(chips, items.map(([key, label, n]) => {
        const on = key === 'needs' ? state.needs : (!state.needs && state.status === key);
        return el('button', {
          type: 'button', class: 'filter-chip' + (on ? ' filter-on' : ''), 'aria-pressed': on ? 'true' : 'false',
          onclick: () => { state.needs = key === 'needs'; state.status = key === 'needs' ? '' : key; state.page = 1; load(); },
        }, label, el('span', { class: 'filter-count', text: String(n) }));
      }));
    }

    function rowEditor(s) {
      const courier = App.input({ list: 'courier-list', value: s.courier, placeholder: 'Courier', maxlength: 40, 'aria-label': 'Courier' });
      const track = App.input({ class: 'input mono', value: s.tracking_id, placeholder: 'Tracking ID', maxlength: 60, 'aria-label': 'Tracking ID' });
      const status = App.select(Object.keys(App.LABELS.ship).map((k) => [k, App.LABELS.ship[k]]), s.status, { 'aria-label': 'Status' });
      const save = el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Save', hidden: true });
      const dirty = () => { save.hidden = courier.value === s.courier && track.value.trim().toUpperCase() === s.tracking_id && status.value === s.status; };
      [courier, track, status].forEach((n) => { n.addEventListener('input', dirty); n.addEventListener('change', dirty); });
      const submit = async () => {
        save.disabled = true;
        try {
          await App.api('api/shipments.php', { body: { action: 'update', id: s.id, courier: courier.value, tracking_id: track.value, status: status.value, note: s.note || '' } });
          App.toast('Saved ' + s.order_no + '.');
          load();
        } catch (e) { App.toast(e.message, 'error'); save.disabled = false; }
      };
      save.addEventListener('click', submit);
      track.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!save.hidden) submit(); } });
      return { courier, track, status, save };
    }

    let seq = 0;
    async function load() {
      App.setParams({ q: state.q, needs_tracking: state.needs ? 1 : '', status: state.status, page: state.page > 1 ? state.page : '' });
      const mine = ++seq;
      let d;
      try { d = await App.api('api/shipments.php', { params: params() }); } catch (e) { App.mount(out, el('p', { class: 'alert alert-error', text: e.message })); return; }
      if (mine !== seq) return;
      state.total = d.total;
      state.page = d.page;
      counts = d.counts;
      paintChips();
      const editors = new Map();
      d.rows.forEach((s) => editors.set(s.id, rowEditor(s)));
      App.mount(out,
        App.datalist('courier-list', App.COURIERS),
        App.table([
          { label: 'Order', render: (s) => el('span', null, el('a', { class: 'tbl-link', href: '#/order?id=' + s.order_id, text: s.order_no }), el('span', { class: 'cell-sub', text: App.fmtDate(s.order_date) })) },
          { label: 'Customer', render: (s) => el('span', null, el('a', { class: 'tbl-link', href: '#/customer?id=' + s.customer_id, text: s.customer_name }), el('span', { class: 'cell-sub', text: [s.city, s.pincode].filter(Boolean).join(' ') || s.phone })) },
          { label: 'Courier', render: (s) => editors.get(s.id).courier },
          { label: 'Tracking ID', render: (s) => editors.get(s.id).track },
          { label: 'Status', render: (s) => editors.get(s.id).status },
          { label: '', class: 'right', render: (s) => el('div', { class: 'row-gap' },
            editors.get(s.id).save,
            s.tracking_id && s.phone ? el('a', { class: 'btn btn-small', target: '_blank', rel: 'noopener', text: 'WhatsApp', href: App.waLink(s.phone, 'Hi ' + s.customer_name + ', your order ' + s.order_no + ' has been shipped.\n' + (s.courier ? 'Courier: ' + s.courier + '\n' : '') + 'Tracking ID: ' + s.tracking_id + '\n\nThank you!') }) : null) },
        ], d.rows.map((s) => Object.assign({ _class: s.order_status === 'cancelled' ? 'row-cancelled' : '' }, s)), state.needs ? 'Every shipment has a tracking ID.' : 'No shipments match.'),
        App.pager(state, (n) => { state.page = n; load(); window.scrollTo(0, 0); }));
    }

    q.addEventListener('input', App.debounce(() => { state.q = q.value.trim(); state.page = 1; load(); }, 300));

    const fillAll = el('button', { type: 'button', class: 'btn btn-primary', text: 'Fill all from Shiprocket', onclick: async () => {
      fillAll.disabled = true;
      fillAll.textContent = 'Checking Shiprocket...';
      try {
        const r = await App.api('api/shipments.php', { body: { action: 'shiprocket_all' } });
        let msg = r.checked ? 'Filled ' + r.filled.length + ' of ' + r.checked + '.' : 'Nothing is waiting for a tracking ID.';
        if (r.missing.length) msg += ' Not in Shiprocket yet: ' + r.missing.slice(0, 8).join(', ') + (r.missing.length > 8 ? '...' : '') + '.';
        if (r.stopped) msg += ' Shiprocket was busy, press the button again.';
        App.toast(msg, r.filled.length ? undefined : 'error');
        await load();
      } catch (e) { App.toast(e.message, 'error'); }
      fillAll.disabled = false;
      fillAll.textContent = 'Fill all from Shiprocket';
    } });

    App.mount(page,
      el('div', { class: 'page-head' }, el('div', null, el('h1', { text: 'Shipments' }), el('p', { class: 'page-sub', text: 'Paste the tracking ID, press Enter, done. "Self delivery" parcels never need one.' })),
        el('div', { class: 'row-gap' }, fillAll)),
      el('section', { class: 'card' },
        el('div', { class: 'toolbar' }, el('div', { class: 'field field-grow' }, el('span', { class: 'field-label', text: 'Search' }), q)),
        chips),
      out);
    await load();
  });
}());

/* Reports: sales, collections, accounts, ageing, top customers. */
(function () {
  'use strict';
  const App = window.App;
  const { el, inr } = App;

  function monthRange(today, offset) {
    const [y, m] = today.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + offset, 1));
    const last = new Date(Date.UTC(y, m + offset, 0));
    const f = (d) => d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    return [f(first), f(last)];
  }

  function chart(series, bucket) {
    if (!series.length) return el('p', { class: 'muted', text: 'No sales or payments in this period.' });
    const max = Math.max(1, ...series.map((s) => Math.max(s.billed_paise, s.collected_paise)));
    const step = Math.ceil(series.length / 12);
    const bars = el('div', { class: 'bars bars-tall' }, series.map((s, i) => {
      const b = el('div', { class: 'bar bar-v', title: 'Billed ' + inr(s.billed_paise) });
      b.style.height = Math.max(2, Math.round((s.billed_paise / max) * 140)) + 'px';
      const c = el('div', { class: 'bar bar-v2', title: 'Collected ' + inr(s.collected_paise) });
      c.style.height = Math.max(2, Math.round((s.collected_paise / max) * 140)) + 'px';
      const label = bucket === 'day' ? String(parseInt(s.label.slice(8), 10)) : App.fmtDate(s.label + '-01').replace(/^1 /, '');
      return el('div', { class: 'bar-group' }, el('div', { class: 'bar-pair' }, b, c), el('span', { class: 'bar-day', text: i % step === 0 ? label : '' }));
    }));
    return el('div', null,
      el('div', { class: 'legend' }, el('span', null, el('i', { class: 'swatch' }), 'Billed'), el('span', null, el('i', { class: 'swatch swatch-2' }), 'Collected')),
      bars);
  }

  function split(title, rows, labelOf, note) {
    const total = rows.reduce((a, r) => a + r.paise, 0) || 1;
    return el('section', { class: 'card' }, el('h2', { text: title }),
      App.table([
        { label: '', render: (r) => labelOf(r) },
        { label: 'Count', class: 'right', render: (r) => String(r.n) },
        { label: 'Amount', class: 'right mono', render: (r) => inr(r.paise) },
        { label: 'Share', render: (r) => { const m = el('div', { class: 'meter' }, el('span')); m.firstChild.style.width = Math.max(0, Math.round((r.paise / total) * 100)) + '%'; return m; } },
      ], rows, 'Nothing in this period.'),
      note ? el('p', { class: 'ledger-note', text: note }) : null);
  }

  App.view('reports', { nav: 'reports', title: 'Reports' }, async (page) => {
    const p = App.getParams();
    const [mFrom, mTo] = monthRange(App.today, 0);
    const state = { from: p.get('from') || mFrom, to: p.get('to') || App.today };
    const from = App.input({ type: 'date', value: state.from });
    const to = App.input({ type: 'date', value: state.to });
    const out = el('div', { class: 'stack' });

    const presets = [
      ['This month', () => monthRange(App.today, 0)],
      ['Last month', () => monthRange(App.today, -1)],
      ['Last 7 days', () => [App.addDays(App.today, -6), App.today]],
      ['Last 30 days', () => [App.addDays(App.today, -29), App.today]],
      ['This year', () => [App.today.slice(0, 4) + '-01-01', App.today]],
    ];

    let seq = 0;
    async function load() {
      App.setParams(state);
      const mine = ++seq;
      let d;
      try { d = await App.api('api/reports.php', { params: state }); } catch (e) { App.mount(out, el('p', { class: 'alert alert-error', text: e.message })); return; }
      if (mine !== seq) return;
      const s = d.summary;
      const ageTotal = d.ageing.reduce((a, r) => a + r.paise, 0);

      App.mount(out,
        el('div', { class: 'kpi-strip' },
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: 'Billed' }), el('span', { class: 'kpi-value', text: inr(s.billed_paise) }), el('span', { class: 'kpi-sub', text: App.plural(s.orders, 'order') })),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: 'Collected' }), el('span', { class: 'kpi-value', text: inr(s.collected_paise) }), el('span', { class: 'kpi-sub', text: inr(s.received_paise) + ' received, ' + inr(s.refunds_paise) + ' refunded' })),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: 'Profit' }), el('span', { class: 'kpi-value', text: inr(s.profit_paise) }),
            el('span', { class: 'kpi-sub', text: (s.profit_pct === null ? '' : s.profit_pct + '% of sales') + (s.no_cost_orders ? (s.profit_pct === null ? '' : ' · ') + App.plural(s.no_cost_orders, 'order') + ' without purchase price not counted' : '') })),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: 'Discounts given' }), el('span', { class: 'kpi-value', text: inr(s.discount_paise) }), el('span', { class: 'kpi-sub', text: 'Shipping charged ' + inr(s.shipping_paise) })),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: 'Outstanding today' }), el('span', { class: 'kpi-value', text: inr(s.outstanding_paise) }), el('span', { class: 'kpi-sub', text: App.plural(s.owing_customers, 'customer') + ' owe you (all time)' }))),
        el('section', { class: 'card chart-card' }, el('h2', { text: d.bucket === 'day' ? 'Billed and collected per day' : 'Billed and collected per month' }), chart(d.series, d.bucket)),
        el('div', { class: 'grid-2' },
          el('section', { class: 'card' }, el('h2', { text: 'Money by account' }),
            App.table([
              { label: 'Account', render: (a) => el('span', null, a.name, el('span', { class: 'cell-sub', text: App.LABELS.accountType[a.type] })) },
              { label: 'This period', class: 'right mono', render: (a) => inr(a.period_paise) },
              { label: 'Balance now', class: 'right mono', render: (a) => inr(a.balance_paise) },
            ], d.by_account, 'No accounts.'),
            el('p', { class: 'ledger-note', text: 'Balance now is the opening balance plus everything received minus refunds. It is not read from the bank.' })),
          el('section', { class: 'card' }, el('h2', { text: 'Unpaid by age' }),
            App.table([
              { label: 'Order age', render: (a) => a.label },
              { label: 'Orders', class: 'right', render: (a) => String(a.n) },
              { label: 'Unpaid', class: 'right mono', render: (a) => inr(a.paise) },
            ], d.ageing.concat([{ label: 'Total', n: d.ageing.reduce((x, r) => x + r.n, 0), paise: ageTotal, _class: 'total-row' }])),
            el('p', { class: 'ledger-note', text: 'Adds up the unpaid balance of each order. A customer total can be lower when that customer also holds credit.' })),
          split('Payment methods', d.by_method, (r) => App.LABELS.method[r.method] || r.method),
          split('UPI vs partial paid vs balance vs COD', d.by_purpose, (r) => App.LABELS.purpose[r.purpose] || r.purpose, 'Shows how the money came in: paid in full by UPI, partial payments and later balances, COD, or credit on account.'),
          split('Orders by payment type', d.by_plan, (r) => App.LABELS.plan[r.pay_plan] || r.pay_plan),
          el('section', { class: 'card' }, el('h2', { text: 'Sales by salesman' }),
            App.table([
              { label: 'Salesman', render: (r) => r.salesperson || el('span', { class: 'muted', text: 'Not set' }) },
              { label: 'Orders', class: 'right', render: (r) => String(r.n) },
              { label: 'Billed', class: 'right mono', render: (r) => inr(r.billed_paise) },
              { label: 'Profit', class: 'right', render: (r) => (r.missing >= r.n ? App.profitCell(null)
                : el('span', null, App.profitCell(r.profit_paise, r.profit_pct), r.missing ? el('span', { class: 'cell-sub', text: '+' + r.missing + ' without price' }) : null)) },
            ], d.by_salesperson, 'No orders in this period.'),
            el('p', { class: 'ledger-note', text: 'Profit counts only orders where every item has a purchase price.' })),
          el('section', { class: 'card' }, el('h2', { text: 'Top customers' }),
            App.table([
              { label: 'Customer', render: (r) => el('a', { class: 'tbl-link', href: '#/customer?id=' + r.id, text: r.name }) },
              { label: 'Orders', class: 'right', render: (r) => String(r.orders_n) },
              { label: 'Billed', class: 'right mono', render: (r) => inr(r.billed_paise) },
              { label: 'Balance', class: 'right', render: (r) => App.balanceText(r.balance_paise) },
            ], d.top_customers, 'No orders in this period.'))));
    }

    const apply = () => { state.from = from.value; state.to = to.value; if (state.from && state.to) load(); };
    from.addEventListener('change', apply);
    to.addEventListener('change', apply);

    App.mount(page,
      el('div', { class: 'page-head' }, el('h1', { text: 'Reports' }),
        el('div', { class: 'row-gap' },
          el('a', { class: 'btn', href: '#', text: 'Orders Excel', onclick: (e) => { e.currentTarget.href = App.exportUrl('orders', state.from, state.to); } }),
          el('a', { class: 'btn', href: '#', text: 'Payments Excel', onclick: (e) => { e.currentTarget.href = App.exportUrl('payments', state.from, state.to); } }))),
      el('section', { class: 'card' },
        el('div', { class: 'filters' }, presets.map(([label, fn]) => el('button', { type: 'button', class: 'filter-chip', text: label, onclick: () => {
          const [a, b] = fn(); from.value = a; to.value = b; apply();
        } }))),
        el('div', { class: 'toolbar' }, App.field('From', from), App.field('To', to))),
      out);
    await load();
  });
}());

/* Salesmen: the names shown in the New order dropdown. */
(function () {
  'use strict';
  const App = window.App;
  const { el, inr } = App;

  App.view('salesmen', { nav: 'salesmen', title: 'Salesmen' }, async (page) => {
    const err = el('div', { class: 'form-error', role: 'alert' });
    const nameBox = App.input({ placeholder: 'Salesman name', maxlength: 60, autocomplete: 'off' });
    const addBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Add salesman' });
    const out = el('div', { class: 'stack' });

    async function load() {
      let d;
      try { d = await App.api('api/salesmen.php'); } catch (e) { App.mount(out, el('p', { class: 'alert alert-error', text: e.message })); return; }
      App.mount(out, App.table([
        { label: 'Salesman', render: (r) => el('strong', { text: r.name }) },
        { label: 'Orders', class: 'right', render: (r) => String(r.orders_n) },
        { label: 'Billed', class: 'right mono', render: (r) => inr(r.billed_paise) },
        { label: '', class: 'right', render: (r) => el('span', { class: 'row-gap' },
          el('a', { class: 'btn btn-small', href: '#/orders?salesperson=' + encodeURIComponent(r.name), text: 'Orders' }),
          el('button', { type: 'button', class: 'btn btn-small', text: 'Rename', onclick: async () => {
            const nm = await App.askText({ title: 'Rename salesman', message: 'Orders that already have this name change to the new one.', label: 'Salesman name', value: r.name, okLabel: 'Save', required: true, maxlength: 60 });
            if (nm === null || nm === r.name) return;
            try { await App.api('api/salesmen.php', { body: { action: 'save', id: r.id, name: nm } }); App.toast('Renamed.'); load(); } catch (e) { App.toast(e.message, 'error'); }
          } }),
          el('button', { type: 'button', class: 'btn btn-small', text: 'Remove', onclick: async () => {
            if (!(await App.confirm('Remove ' + r.name + ' from the dropdown? Their ' + App.plural(r.orders_n, 'order') + ' keep the name.', 'Remove', true))) return;
            try { await App.api('api/salesmen.php', { body: { action: 'delete', id: r.id } }); App.toast('Removed.'); load(); } catch (e) { App.toast(e.message, 'error'); }
          } })) },
      ], d.rows, 'No salesmen yet. Add the first one above.'));
    }

    async function add() {
      err.textContent = '';
      const nm = nameBox.value.trim();
      if (!nm) { err.textContent = 'Type the salesman name.'; return; }
      addBtn.disabled = true;
      try {
        await App.api('api/salesmen.php', { body: { action: 'save', name: nm } });
        nameBox.value = '';
        App.toast('Added ' + nm + '.');
        await load();
      } catch (e) { err.textContent = e.message; }
      addBtn.disabled = false;
      nameBox.focus();
    }
    addBtn.addEventListener('click', add);
    nameBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

    App.mount(page,
      el('div', { class: 'page-head' }, el('h1', { text: 'Salesmen' })),
      el('section', { class: 'card' },
        el('h2', { text: 'Add a salesman' }),
        el('div', { class: 'row-gap sales-add' }, el('div', { class: 'field-grow' }, nameBox), addBtn),
        err,
        el('p', { class: 'muted small', text: 'These names appear in the Salesman dropdown when you create an order.' })),
      out);
    await load();
  });
}());

/* Commission: today, one month, or any date range. Rates come from the rules box. */
(function () {
  'use strict';
  const App = window.App;
  const { el, inr } = App;

  const pctText = (n) => String(Number(n)) + '%';

  /** One table: a row per salesman plus a total row. */
  /** Click on a salesman: his orders, profit, rate and commission for every day of the period. */
  async function showDays(name, from, to) {
    let d;
    try { d = await App.api('api/commission.php', { params: { salesman: name, from, to } }); } catch (e) { App.toast(e.message, 'error'); return; }
    const rules = d.rules;
    const dayRows = d.days.map((x) => Object.assign({}, x, { _class: x.high ? 'day-high' : '' }));
    const total = { date: 'Total', orders_n: d.orders_n, sales_paise: d.sales_paise, profit_paise: d.profit_paise, no_cost_n: d.no_cost_n, commission_paise: d.commission_paise, total: true, _class: 'total-row' };
    const ordersLink = (x) => '#/orders?salesperson=' + encodeURIComponent(name) + '&from=' + x.date + '&to=' + x.date;
    const body = el('div', { class: 'stack' },
      el('p', { class: 'muted small', text: App.fmtDate(from) + ' to ' + App.fmtDate(to) + ' · ' + App.plural(d.days_high, 'day') + ' @ ' + pctText(rules.high_pct) + ', ' + App.plural(d.days_low, 'day') + ' @ ' + pctText(rules.low_pct) + ' · ' + rules.threshold + '+ orders in a day = ' + pctText(rules.high_pct) + ' of that day\'s profit' }),
      App.table([
        { label: 'Date', render: (x) => (x.total ? el('strong', { text: 'Total' }) : el('span', null, App.fmtDate(x.date),
          x.no_cost_n > 0 ? el('span', { class: 'cell-sub owe', text: x.no_cost_n + ' order' + (x.no_cost_n === 1 ? '' : 's') + ' without purchase price' }) : null)) },
        { label: 'Orders', class: 'right', render: (x) => (x.total ? el('strong', { text: String(x.orders_n) }) : el('a', { class: 'tbl-link', href: ordersLink(x), text: String(x.orders_n), title: 'Open these orders' })) },
        { label: 'Sales', class: 'right mono', render: (x) => el('span', { class: 'muted', text: inr(x.sales_paise) }) },
        { label: 'Profit', class: 'right mono', render: (x) => el('span', { class: x.profit_paise < 0 ? 'owe' : (x.total ? 'strong' : ''), text: inr(x.profit_paise) }) },
        { label: 'Rate', class: 'right', render: (x) => (x.total ? '' : el('span', { class: 'small' }, App.chip(pctText(x.rate_pct), x.high ? 'ok' : 'muted'),
          x.more_for_high > 0 ? el('span', { class: 'cell-sub', text: x.more_for_high + ' more for ' + pctText(rules.high_pct) }) : null)) },
        { label: 'Commission', class: 'right mono', render: (x) => (x.total ? el('strong', { text: inr(x.commission_paise) }) : el('span', { class: x.commission_paise > 0 ? 'strong' : 'muted', text: inr(x.commission_paise) })) },
      ], dayRows.length ? dayRows.concat([total]) : [], 'No orders for ' + name + ' in this period.'));
    App.modal({ title: name + ' · day by day', wide: true, body, buttons: [{ label: 'Close', onClick: (close) => close() }] });
  }

  function block(d, rules) {
    const rows = d.rows.map((r) => ({
      salesman: r.salesman, orders_n: r.orders_n, sales_paise: r.sales_paise, profit_paise: r.profit_paise, no_cost: r.no_cost_n,
      rate_pct: r.rate_pct, days_high: r.days_high, days_low: r.days_low, commission_paise: r.commission_paise, more: r.more_for_high,
    }));
    // One day: the rate that applied. Several days: how many days got each rate.
    const rateText = (r) => {
      if (d.single_day) return r.orders_n ? pctText(r.rate_pct) + ' of profit' : '';
      const parts = [];
      if (r.days_low) parts.push(r.days_low + (r.days_low === 1 ? ' day' : ' days') + ' @ ' + pctText(rules.low_pct));
      if (r.days_high) parts.push(r.days_high + (r.days_high === 1 ? ' day' : ' days') + ' @ ' + pctText(rules.high_pct));
      return parts.join(', ');
    };
    const total = { salesman: 'Total', orders_n: d.orders_n, sales_paise: d.sales_paise, profit_paise: d.profit_paise, no_cost: d.no_cost_n, commission_paise: d.commission_paise, _class: 'total-row', total: true };
    const profitCell = (r) => el('span', { class: r.profit_paise < 0 ? 'owe' : (r.total ? 'strong' : ''), text: inr(r.profit_paise) });
    return el('div', { class: 'stack comm-tbl' },
      App.table([
        { label: 'Salesman', render: (r) => (r.total ? el('strong', { text: r.salesman }) : el('span', null,
          el('a', { class: 'tbl-link', href: '#', text: r.salesman, title: 'Day by day', onclick: (e) => { e.preventDefault(); showDays(r.salesman, d.from, d.to); } }),
          r.more > 0 && r.orders_n > 0 ? el('span', { class: 'cell-sub', text: r.more + ' more order' + (r.more === 1 ? '' : 's') + ' today for ' + pctText(rules.high_pct) }) : null,
          r.no_cost > 0 ? el('span', { class: 'cell-sub owe', text: r.no_cost + ' order' + (r.no_cost === 1 ? '' : 's') + ' without purchase price, not counted' }) : null)) },
        { label: 'Orders', class: 'right', render: (r) => String(r.orders_n) },
        { label: 'Sales', class: 'right mono', render: (r) => el('span', { class: 'muted', text: inr(r.sales_paise) }) },
        { label: 'Profit', class: 'right mono', render: profitCell },
        { label: 'Rate', class: 'right', render: (r) => (r.total ? '' : el('span', { class: 'small', text: rateText(r) })) },
        { label: 'Commission', class: 'right mono', render: (r) => (r.total ? el('strong', { text: inr(r.commission_paise) }) : el('span', { class: r.commission_paise > 0 ? 'strong' : 'muted', text: inr(r.commission_paise) })) },
      ], rows.length ? rows.concat([total]) : [], 'No salesmen yet. Add them on the Salesmen page.'),
      d.no_salesman ? el('p', { class: 'ledger-note', text: App.plural(d.no_salesman, 'order') + ' in this period ha' + (d.no_salesman === 1 ? 's' : 've') + ' no salesman and ' + (d.no_salesman === 1 ? 'is' : 'are') + ' not counted.' }) : null,
      d.no_cost_n ? el('p', { class: 'ledger-note', text: App.plural(d.no_cost_n, 'order') + ' ha' + (d.no_cost_n === 1 ? 's' : 've') + ' an item without a purchase price, so the profit is unknown and no commission is counted for ' + (d.no_cost_n === 1 ? 'it' : 'them') + '. Open the order, add the purchase price, and it will count.' }) : null);
  }

  App.view('commission', { nav: 'commission', title: 'Commission' }, async (page) => {
    const p = App.getParams();
    const thisMonth = App.today.slice(0, 7);
    const state = { month: p.get('month') || thisMonth, from: p.get('from') || thisMonth + '-01', to: p.get('to') || App.today };

    const month = App.input({ type: 'month', value: state.month });
    const from = App.input({ type: 'date', value: state.from });
    const to = App.input({ type: 'date', value: state.to });
    const todayBox = el('div'); const monthBox = el('div'); const rangeBox = el('div');

    /* rules */
    const err = el('div', { class: 'form-error', role: 'alert' });
    const threshold = App.input({ inputmode: 'numeric', maxlength: 4, 'aria-label': 'Orders needed' });
    const low = App.input({ inputmode: 'decimal', maxlength: 5, 'aria-label': 'Rate below' });
    const high = App.input({ inputmode: 'decimal', maxlength: 5, 'aria-label': 'Rate at or above' });
    const saveRules = el('button', { type: 'button', class: 'btn btn-primary', text: 'Save rules' });
    let rules = { threshold: 12, low_pct: 7, high_pct: 8 };

    let seq = 0;
    async function load() {
      App.setParams(state);
      const mine = ++seq;
      let d;
      try { d = await App.api('api/commission.php', { params: state }); } catch (e) { App.mount(todayBox, el('p', { class: 'alert alert-error', text: e.message })); return; }
      if (mine !== seq) return;
      rules = d.rules;
      threshold.value = String(rules.threshold); low.value = String(Number(rules.low_pct)); high.value = String(Number(rules.high_pct));
      state.from = d.range.from; state.to = d.range.to; from.value = d.range.from; to.value = d.range.to;
      const sub = (t) => el('p', { class: 'muted small', text: t });
      App.mount(todayBox, sub(App.fmtDate(d.today.date)), block(d.today, rules));
      App.mount(monthBox, sub(App.fmtDate(d.month.from) + ' to ' + App.fmtDate(d.month.to)), block(d.month, rules));
      App.mount(rangeBox, sub(App.fmtDate(d.range.from) + ' to ' + App.fmtDate(d.range.to)), block(d.range, rules));
    }

    saveRules.addEventListener('click', async () => {
      err.textContent = '';
      saveRules.disabled = true;
      try {
        await App.api('api/commission.php', { body: { action: 'save_rules', threshold: threshold.value.trim(), low_pct: low.value.trim(), high_pct: high.value.trim() } });
        App.toast('Rules saved.');
        await load();
      } catch (e) { err.textContent = e.message; }
      saveRules.disabled = false;
    });
    month.addEventListener('change', () => { if (month.value) { state.month = month.value; load(); } });
    const applyRange = () => { if (from.value && to.value) { state.from = from.value; state.to = to.value; load(); } };
    from.addEventListener('change', applyRange);
    to.addEventListener('change', applyRange);

    const presets = [
      ['Last 7 days', () => [App.addDays(App.today, -6), App.today]],
      ['Last 30 days', () => [App.addDays(App.today, -29), App.today]],
      ['This year', () => [App.today.slice(0, 4) + '-01-01', App.today]],
    ];

    App.mount(page,
      el('div', { class: 'page-head' }, el('h1', { text: 'Commission' })),
      el('section', { class: 'card' },
        el('h2', { text: 'Rules' }),
        el('div', { class: 'form-grid form-grid-3' },
          App.field('Orders in ONE DAY for the higher rate', threshold),
          App.field('Rate when a day has fewer (%)', low),
          App.field('Rate when a day has that many or more (%)', high)),
        el('div', { class: 'row-gap' }, saveRules),
        err,
        el('p', { class: 'muted small', text: 'Commission is a percentage of each salesman\'s PROFIT, not of sales. Profit of an order = selling price minus purchase price of every item, minus the order discount (shipping left out). Example: bought for ₹4,000, sold for ₹5,000, profit ₹1,000, so the rate applies to ₹1,000. The rate is decided day by day: on a day with fewer than the number of orders above, that day\'s profit earns the lower rate; on a day with that many or more, the higher rate. A month is the sum of its days. Cancelled orders do not count.' })),
      el('section', { class: 'card' }, el('h2', { text: 'Today' }), todayBox),
      el('section', { class: 'card' },
        el('div', { class: 'card-head' }, el('h2', { text: 'Monthly' }), App.field('Month', month)),
        monthBox),
      el('section', { class: 'card' },
        el('h2', { text: 'Date range' }),
        el('div', { class: 'filters' }, presets.map(([label, fn]) => el('button', { type: 'button', class: 'filter-chip', text: label, onclick: () => {
          const [a, b] = fn(); from.value = a; to.value = b; applyRange();
        } }))),
        el('div', { class: 'toolbar' }, App.field('From', from), App.field('To', to)),
        rangeBox));
    await load();
  });
}());

/* Printable invoice. Opening it issues the invoice number the first time. */
(function () {
  'use strict';
  const App = window.App;
  const { el, inr } = App;

  // Logo shown at the top of every invoice (transparent background).
  const LOGO = 'data:image/png;base64,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';
  const LOGO_RATIO = 1623 / 541;

  /* ---- PDF download: draws the invoice on A4 canvases and wraps them in a PDF (no libraries) ---- */
  const PW = 794, PH = 1123, PM = 48, SC = 2;
  const SANS = '"IBM Plex Sans", "Segoe UI", Arial, "Noto Sans Gujarati", "Nirmala UI", sans-serif';
  const MONO = '"IBM Plex Mono", Consolas, "Courier New", monospace';

  function wrapText(g, text, maxW) {
    const out = [];
    String(text || '').split('\n').forEach((para) => {
      let line = '';
      para.split(/\s+/).filter(Boolean).forEach((word) => {
        let w = word;
        while (g.measureText(w).width > maxW) {
          let cut = w.length - 1;
          while (cut > 1 && g.measureText(w.slice(0, cut)).width > maxW) cut--;
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const trial = line ? line + ' ' + w : w;
        if (line && g.measureText(trial).width > maxW) { out.push(line); line = w; } else { line = trial; }
      });
      out.push(line);
    });
    while (out.length > 1 && out[out.length - 1] === '') out.pop();
    return out;
  }

  function jpegBytes(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Could not create the image.')); return; }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      }, 'image/jpeg', 0.92);
    });
  }

  function pdfFromJpegs(pages) {
    const enc = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let len = 0;
    const push = (x) => { const u = typeof x === 'string' ? enc.encode(x) : x; chunks.push(u); len += u.length; };
    const obj = (n, fn) => { offsets[n] = len; push(n + ' 0 obj\n'); fn(); push('\nendobj\n'); };
    const n = pages.length;
    push('%PDF-1.4\n');
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push('<< /Type /Pages /Kids [' + pages.map((_, i) => (3 + 3 * i) + ' 0 R').join(' ') + '] /Count ' + n + ' >>'));
    pages.forEach((j, i) => {
      const pg = 3 + 3 * i;
      const stream = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
      obj(pg, () => push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ' + (pg + 2) + ' 0 R >> >> /Contents ' + (pg + 1) + ' 0 R >>'));
      obj(pg + 1, () => push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream'));
      obj(pg + 2, () => {
        push('<< /Type /XObject /Subtype /Image /Width ' + j.w + ' /Height ' + j.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + j.bytes.length + ' >>\nstream\n');
        push(j.bytes);
        push('\nendstream');
      });
    });
    const total = 3 + 3 * n;
    const xref = len;
    let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (let k = 1; k < total; k++) x += String(offsets[k]).padStart(10, '0') + ' 00000 n \n';
    push(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
    return new Blob(chunks, { type: 'application/pdf' });
  }

  async function buildInvoicePdf(o, b, paid) {
    try {
      await Promise.all(['400 12px "IBM Plex Sans"', '600 12px "IBM Plex Sans"', '700 12px "IBM Plex Sans"', '500 12px "IBM Plex Mono"'].map((f) => document.fonts.load(f)));
    } catch (e) { /* fall back to system fonts */ }

    const canvases = [];
    let g = null;
    let y = 0;
    const page = () => {
      const c = document.createElement('canvas');
      c.width = PW * SC; c.height = PH * SC;
      g = c.getContext('2d');
      g.scale(SC, SC);
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, PW, PH);
      g.textBaseline = 'alphabetic';
      canvases.push(c);
      y = PM;
    };
    const put = (text, x, yy, o2) => {
      const f = o2 || {};
      g.font = (f.weight || 400) + ' ' + (f.size || 11) + 'px ' + (f.mono ? MONO : SANS);
      g.fillStyle = f.color || '#1c1c1c';
      g.textAlign = f.align || 'left';
      g.fillText(String(text), x, yy);
    };
    const para = (text, x, yy, maxW, o2) => {
      const f = o2 || {};
      g.font = (f.weight || 400) + ' ' + (f.size || 11) + 'px ' + SANS;
      const lh = (f.size || 11) + 4;
      const ls = wrapText(g, text, maxW);
      ls.forEach((l, i) => put(l, x, yy + i * lh, f));
      return yy + ls.length * lh;
    };
    const rule = (yy, color) => { g.fillStyle = color || '#d9d9d9'; g.fillRect(PM, yy, PW - 2 * PM, 1); };
    const RIGHT = PW - PM;
    const MUTED = '#666666';

    page();

    // Header: business on the left, invoice details on the right
    const leftW = 340;
    let yl;
    const logoImg = await new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = LOGO;
    });
    if (logoImg) {
      const lh = 44;
      g.drawImage(logoImg, PM, y + 2, lh * LOGO_RATIO, lh);
      yl = y + 2 + lh + 12;
    } else {
      yl = para(b.name, PM, y + 16, leftW, { size: 20, weight: 700 });
      yl += 2;
    }
    (b.address || '').split('\n').filter((l) => l.trim()).forEach((l) => { yl = para(l, PM, yl, leftW, { color: MUTED }); });
    if (b.phone) yl = para(b.phone, PM, yl, leftW, { color: MUTED });
    if (b.email) yl = para(b.email, PM, yl, leftW, { color: MUTED });
    if (b.gstin) yl = para('GSTIN: ' + b.gstin, PM, yl, leftW, { color: MUTED });

    let yr = y + 18;
    put('INVOICE', RIGHT, yr, { size: 22, weight: 700, align: 'right', color: '#444444' });
    yr += 22; put(o.invoice_no, RIGHT, yr, { size: 13, weight: 700, align: 'right' });
    yr += 18; put('Date: ' + App.fmtDate(o.invoice_date || o.order_date), RIGHT, yr, { align: 'right', color: MUTED });
    yr += 15; put('Order: ' + o.order_no + ' (' + App.fmtDate(o.order_date) + ')', RIGHT, yr, { align: 'right', color: MUTED });
    if (o.due_date && !paid) { yr += 15; put('Pay by: ' + App.fmtDate(o.due_date), RIGHT, yr, { align: 'right', color: MUTED }); }

    y = Math.max(yl, yr) + 14;
    rule(y); y += 22;

    // Bill to + status stamp
    put('BILL TO', PM, y, { size: 9, weight: 600, color: MUTED });
    let yb = y + 17;
    yb = para(o.customer.name, PM, yb, 360, { size: 13, weight: 700 });
    yb = para(o.customer.phone, PM, yb, 360);
    const address = [o.ship_address, o.ship_city, o.ship_pincode].filter(Boolean).join(', ');
    if (address) yb = para(address, PM, yb, 360, { color: MUTED });

    const stampText = paid ? 'PAID' : 'BALANCE DUE';
    const stampColor = paid ? '#1a7f4b' : '#b42318';
    g.font = '700 14px ' + SANS;
    const sw = g.measureText(stampText).width + 32;
    g.strokeStyle = stampColor; g.lineWidth = 2;
    g.strokeRect(RIGHT - sw, y - 4, sw, 32);
    put(stampText, RIGHT - sw / 2, y + 17, { size: 14, weight: 700, color: stampColor, align: 'center' });

    y = Math.max(yb, y + 32) + 18;

    // Items table
    const cols = { n: PM + 4, item: PM + 32, qty: 470, rate: 560, disc: 650, amt: RIGHT };
    const head = () => {
      g.fillStyle = '#f2f2f2'; g.fillRect(PM, y - 14, PW - 2 * PM, 24);
      put('#', cols.n, y + 2, { size: 10, weight: 600, color: MUTED });
      put('ITEM', cols.item, y + 2, { size: 10, weight: 600, color: MUTED });
      ['QTY', 'RATE', 'DISCOUNT', 'AMOUNT'].forEach((h, i) => put(h, [cols.qty, cols.rate, cols.disc, cols.amt][i], y + 2, { size: 10, weight: 600, color: MUTED, align: 'right' }));
      y += 24;
    };
    head();
    o.items.forEach((it, i) => {
      g.font = '400 12px ' + SANS;
      const ls = wrapText(g, App.itemLabel(it), cols.qty - 50 - cols.item);
      const rowH = ls.length * 16 + 10;
      if (y + rowH > PH - 90) { page(); head(); }
      put(String(i + 1), cols.n, y + 2, { color: MUTED });
      ls.forEach((l, k) => put(l, cols.item, y + 2 + k * 16, { size: 12 }));
      put(String(it.qty), cols.qty, y + 2, { size: 12, align: 'right' });
      put(inr(it.rate_paise), cols.rate, y + 2, { size: 12, align: 'right', mono: true });
      if (it.discount_paise) put('-' + inr(it.discount_paise), cols.disc, y + 2, { size: 12, align: 'right', mono: true });
      put(inr(it.amount_paise), cols.amt, y + 2, { size: 12, align: 'right', mono: true });
      y += rowH;
      rule(y - 6, '#ececec');
    });
    y += 8;

    // Totals
    const sums = [['Items total', inr(o.subtotal_paise), '']];
    if (o.discount_paise) sums.push(['Discount', '-' + inr(o.discount_paise), '']);
    if (o.shipping_paise) sums.push(['Shipping', inr(o.shipping_paise), '']);
    sums.push(['Total', inr(o.total_paise), 'grand']);
    sums.push(['Received', inr(o.paid_paise), 'paid']);
    sums.push(['Balance due', inr(Math.max(0, o.balance_paise)), o.balance_paise > 0 ? 'due' : '']);
    if (y + sums.length * 22 + 20 > PH - 60) page();
    const lx = 470;
    sums.forEach(([label, value, kind]) => {
      if (kind === 'grand') { g.fillStyle = '#1c1c1c'; g.fillRect(lx, y - 10, RIGHT - lx, 1.2); y += 6; }
      const color = kind === 'due' ? '#b42318' : (kind === 'paid' ? '#1a7f4b' : '#1c1c1c');
      const size = kind === 'grand' ? 14 : 12;
      const weight = kind === 'grand' || kind === 'due' ? 700 : 400;
      put(label, lx, y + 4, { size, weight, color: kind === 'grand' ? '#1c1c1c' : (kind ? color : MUTED) });
      put(value, RIGHT, y + 4, { size, weight, color, align: 'right', mono: true });
      y += 22;
    });
    y += 14;

    // How to pay, terms, footer
    const block = (label, text) => {
      g.font = '400 11px ' + SANS;
      const need = 18 + wrapText(g, text, PW - 2 * PM).length * 15 + 12;
      if (y + need > PH - 50) page();
      put(label, PM, y, { size: 9, weight: 600, color: MUTED });
      y = para(text, PM, y + 15, PW - 2 * PM, { color: '#333333' }) + 10;
    };
    if ((b.upi_id || b.bank_details) && !paid) block('HOW TO PAY', (b.upi_id ? 'UPI: ' + b.upi_id + '\n' : '') + (b.bank_details || ''));
    if (b.terms) block('TERMS', b.terms);
    if (b.footer) {
      if (y + 30 > PH - 30) page();
      put(b.footer, PW / 2, y + 14, { size: 11, color: MUTED, align: 'center' });
    }

    const pages = [];
    for (const c of canvases) pages.push({ bytes: await jpegBytes(c), w: c.width, h: c.height });
    return pdfFromJpegs(pages);
  }

  async function downloadInvoice(o, b, paid, btn) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparing...';
    try {
      const blob = await buildInvoicePdf(o, b, paid);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Invoice-' + String(o.invoice_no).replace(/[^A-Za-z0-9_-]+/g, '-') + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      App.toast('Could not create the PDF. ' + (e && e.message ? e.message : ''), 'error');
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }

  App.view('invoice', { nav: 'orders', title: 'Invoice' }, async (page) => {
    const id = parseInt(App.getParams().get('id') || '0', 10);
    if (!id) { location.replace('#/orders'); return; }
    const d = await App.api('api/orders.php', { body: { action: 'invoice', id } });
    const o = d.order;
    const b = d.business;
    document.title = (App.env === 'test' ? '[TEST] ' : '') + 'Invoice ' + o.invoice_no;

    const lines = (text) => (text || '').split('\n').filter((x) => x.trim() !== '').map((x) => el('p', { text: x }));
    const paid = o.balance_paise <= 0;

    const msg = 'Hi ' + o.customer.name + ',\nInvoice ' + o.invoice_no + ' for order ' + o.order_no + '.\nTotal: ' + inr(o.total_paise)
      + (o.balance_paise > 0 ? '\nBalance due: ' + inr(o.balance_paise) + (b.upi_id ? '\nPay by UPI: ' + b.upi_id : '') : '\nPaid in full. Thank you!');

    const items = el('div', { class: 'table-wrap' }, el('table', { class: 'tbl' },
      el('thead', null, el('tr', null, ['#', 'Item', 'Qty', 'Rate', 'Discount', 'Amount'].map((h, i) => el('th', { class: i === 0 || i === 1 ? '' : 'right', text: h })))),
      el('tbody', null, o.items.map((i, n) => el('tr', null,
        el('td', { text: String(n + 1) }), el('td', { text: App.itemLabel(i) }),
        el('td', { class: 'right', text: String(i.qty) }), el('td', { class: 'right mono', text: inr(i.rate_paise) }),
        el('td', { class: 'right mono', text: i.discount_paise ? '-' + inr(i.discount_paise) : '' }),
        el('td', { class: 'right mono', text: inr(i.amount_paise) }))))));

    const row = (label, value, cls) => el('div', { class: 'sum-row ' + (cls || '') }, el('span', { text: label }), el('span', { class: 'mono', text: value }));
    const address = [o.ship_address, o.ship_city, o.ship_pincode].filter(Boolean).join(', ');

    App.mount(page,
      el('div', { class: 'invoice-actions no-print' },
        el('a', { class: 'btn', href: '#/order?id=' + o.id, text: 'Back to order' }),
        el('div', { class: 'row-gap' },
          el('a', { class: 'btn', href: App.waLink(o.customer.phone, msg), target: '_blank', rel: 'noopener', text: 'WhatsApp customer' }),
          el('button', { type: 'button', class: 'btn', text: 'Print', onclick: () => window.print() }),
          el('button', { type: 'button', class: 'btn btn-primary', text: 'Download PDF', onclick: (ev) => downloadInvoice(o, b, paid, ev.currentTarget) }))),
      el('article', { class: 'sheet' },
        el('div', { class: 'inv-head' },
          el('div', { class: 'inv-biz' }, el('img', { class: 'inv-logo', src: LOGO, alt: b.name, height: '44' }), lines(b.address), b.phone ? el('p', { text: b.phone }) : null, b.email ? el('p', { text: b.email }) : null, b.gstin ? el('p', { text: 'GSTIN: ' + b.gstin }) : null),
          el('div', { class: 'inv-meta' },
            el('div', { class: 'inv-title', text: 'INVOICE' }),
            el('p', null, el('strong', { text: o.invoice_no })),
            el('p', { text: 'Date: ' + App.fmtDate(o.invoice_date || o.order_date) }),
            el('p', { text: 'Order: ' + o.order_no + ' (' + App.fmtDate(o.order_date) + ')' }),
            o.due_date && !paid ? el('p', { text: 'Pay by: ' + App.fmtDate(o.due_date) }) : null)),
        el('div', { class: 'inv-cols' },
          el('div', { class: 'inv-to' }, el('div', { class: 'inv-label', text: 'Bill to' }), el('p', null, el('strong', { text: o.customer.name })), el('p', { text: o.customer.phone }), address ? el('p', { text: address }) : null),
          paid ? el('div', { class: 'inv-stamp', text: 'PAID' }) : el('div', { class: 'inv-stamp inv-stamp-due', text: 'BALANCE DUE' })),
        items,
        el('div', { class: 'inv-totals' },
          row('Items total', inr(o.subtotal_paise)),
          o.discount_paise ? row('Discount', '-' + inr(o.discount_paise)) : null,
          o.shipping_paise ? row('Shipping', inr(o.shipping_paise)) : null,
          row('Total', inr(o.total_paise), 'grand'),
          row('Received', inr(o.paid_paise), 'sum-paid'),
          row('Balance due', inr(Math.max(0, o.balance_paise)), o.balance_paise > 0 ? 'sum-due' : '')),
        (b.upi_id || b.bank_details) && !paid ? el('div', null, el('div', { class: 'inv-label', text: 'How to pay' }), b.upi_id ? el('p', { text: 'UPI: ' + b.upi_id }) : null, lines(b.bank_details)) : null,
        b.terms ? el('div', null, el('div', { class: 'inv-label', text: 'Terms' }), el('p', { class: 'pre', text: b.terms })) : null,
        b.footer ? el('div', { class: 'inv-foot', text: b.footer }) : null));
  });
}());

/* Cash book: every rupee in and out of each account (Cash, UPI ...), who paid it and where it went.
   Money in = customer payments (by themselves, from the Payments page) + anything you add here as
   "Money in" (opening balance, owner deposit, loan, refund). Money out = expenses you add here. */
(function () {
  'use strict';
  const App = window.App;
  const { el, inr } = App;

  function monthRange(today, offset) {
    const [y, m] = today.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + offset, 1));
    const last = new Date(Date.UTC(y, m + offset, 0));
    const f = (d) => d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    return [f(first), f(last)];
  }

  /** The add-entry form: money out (an expense) or money in that is not a customer payment. opts: {kind, accounts, purposes, who, onSaved} */
  App.cashbookModal = function (opts) {
    const err = el('div', { class: 'form-error', role: 'alert' });
    const whoLabel = el('span', { class: 'field-label' });
    const forLabel = el('span', { class: 'field-label' });
    const accountLabel = el('span', { class: 'field-label' });
    const kindSeg = App.segmented([['out', 'Money out (paid / spent)'], ['in', 'Money in (not an order)']], opts.kind || 'out', () => paint(), 'In or out');
    const amount = App.moneyInput(0, { placeholder: '0', 'aria-label': 'Amount' });
    const who = App.input({ maxlength: 120, autocomplete: 'off', list: 'cashbook-who' });
    const purpose = App.input({ maxlength: 120, autocomplete: 'off', list: 'cashbook-purpose' });
    const account = App.input({ list: 'account-list', placeholder: 'Type the account name', maxlength: 60, autocomplete: 'off', value: App.store.get('account_name') || (opts.accounts[0] ? opts.accounts[0].name : '') });
    const date = App.input({ type: 'date', value: App.today });
    const note = App.input({ placeholder: 'Note (optional)', maxlength: 200 });

    function paint() {
      const isIn = kindSeg.get() === 'in';
      whoLabel.textContent = isIn ? 'Received from (person, bank, owner)' : 'Paid to (shop, courier, person)';
      forLabel.textContent = isIn ? 'What for' : 'What for';
      accountLabel.textContent = isIn ? 'Received into which account' : 'Paid from which account';
      who.placeholder = isIn ? 'Owner deposit, Loan, Refund from courier ...' : 'Delhivery, Shree Packaging, Rudra ...';
      purpose.placeholder = isIn ? 'Opening balance, Capital, Refund ...' : 'Courier, Packing, Salary, Ads ...';
    }
    paint();

    const modal = App.modal({
      title: 'Add cash book entry',
      wide: true,
      body: el('div', null,
        el('div', { class: 'form-grid' },
          el('div', { class: 'field span-2' }, el('span', { class: 'field-label', text: 'Entry' }), kindSeg.el),
          App.field('Amount (₹)', amount),
          App.field('Date', date),
          el('label', { class: 'field' }, whoLabel, who, App.datalist('cashbook-who', opts.who || [])),
          el('label', { class: 'field' }, forLabel, purpose, App.datalist('cashbook-purpose', opts.purposes || [])),
          el('div', { class: 'span-2' }, el('label', { class: 'field' }, accountLabel, account, el('span', { class: 'field-hint', text: 'Cash, or the UPI / bank account the money moved through' })), App.datalist('account-list', opts.accounts.map((a) => a.name))),
          el('div', { class: 'span-2' }, App.field('Note', note))),
        err),
      buttons: [
        { label: 'Cancel', onClick: (close) => close() },
        { label: 'Save entry', kind: 'primary', onClick: async (close, btn) => {
          err.textContent = '';
          const isIn = kindSeg.get() === 'in';
          const paise = App.toPaise(amount.value);
          if (paise === null || paise <= 0) { err.textContent = 'Enter the amount.'; amount.focus(); return; }
          if (!who.value.trim()) { err.textContent = isIn ? 'Who did you receive it from?' : 'Who did you pay?'; who.focus(); return; }
          if (!purpose.value.trim()) { err.textContent = 'What was it for?'; purpose.focus(); return; }
          if (!account.value.trim()) { err.textContent = 'Which account?'; account.focus(); return; }
          if (btn) btn.disabled = true;
          try {
            await App.api('api/cashbook.php', { body: {
              action: 'add', kind: kindSeg.get(), amount_paise: paise, who: who.value.trim(), purpose: purpose.value.trim(),
              entry_on: date.value, note: note.value.trim(), account_name: account.value.trim(),
            } });
            App.store.set('account_name', account.value.trim());
            App.toast((isIn ? 'Received ' : 'Paid ') + inr(paise) + ' recorded.');
            close();
            if (opts.onSaved) opts.onSaved();
          } catch (e) {
            err.textContent = e.message;
            if (btn) btn.disabled = false;
          }
        } },
      ],
    });
    amount.focus();
    return modal;
  };

  function shareList(rows, cls) {
    if (!rows.length) return el('p', { class: 'muted small', text: 'Nothing in this period.' });
    const total = rows.reduce((a, r) => a + r.paise, 0) || 1;
    return el('ul', { class: 'cb-list' }, rows.slice(0, 12).map((r) => {
      const bar = el('div', { class: 'meter ' + cls }, el('span'));
      bar.firstChild.style.width = Math.max(3, Math.round((r.paise / total) * 100)) + '%';
      return el('li', null,
        el('div', { class: 'cb-line' },
          el('span', { class: 'cb-name' }, r.name, el('small', { class: 'muted', text: ' ' + App.plural(r.n, 'entry').replace('entrys', 'entries') })),
          el('span', { class: 'mono strong', text: inr(r.paise) })),
        bar);
    }));
  }

  App.view('cashbook', { nav: 'cashbook', title: 'Cash book' }, async (page) => {
    const p = App.getParams();
    // Opens on today; the presets switch to this month, last month or all time.
    const state = {
      from: p.has('from') ? p.get('from') : App.today, to: p.has('to') ? p.get('to') : App.today,
      account_id: parseInt(p.get('account_id') || '0', 10) || 0, q: p.get('q') || '',
    };

    const from = App.input({ type: 'date', value: state.from });
    const to = App.input({ type: 'date', value: state.to });
    const q = App.input({ type: 'search', value: state.q, placeholder: 'Name, purpose, order no or note' });
    const strip = el('div', { class: 'kpi-strip' });
    const accountChips = el('div', { class: 'filters', role: 'group', 'aria-label': 'Account' });
    const totals = el('div', { class: 'totals' });
    const out = el('div', { class: 'stack' });
    const byPurpose = el('div');
    const byWho = el('div');
    const exportLink = el('a', { class: 'btn', href: '#', text: 'Export Excel' });
    let data = null;

    const presets = [
      ['Today', () => [App.today, App.today]],
      ['This month', () => monthRange(App.today, 0)],
      ['Last month', () => monthRange(App.today, -1)],
      ['All time', () => ['', '']],
    ];

    const chip = (text, on, count, onclick) => el('button', {
      type: 'button', class: 'filter-chip' + (on ? ' filter-on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick,
    }, text, count === null || count === undefined ? null : el('span', { class: 'filter-count', text: String(count) }));

    function paintChips() {
      const accounts = data ? data.accounts : [];
      // One account only: nothing to choose between, so no chips.
      if (accounts.length < 2) { state.account_id = 0; App.mount(accountChips); return; }
      App.mount(accountChips,
        chip('All accounts', state.account_id === 0, null, () => { state.account_id = 0; load(); }),
        accounts.map((a) => chip(a.name, state.account_id === a.id, null, () => { state.account_id = a.id; load(); })));
    }

    let seq = 0;
    async function load() {
      App.setParams(state);
      exportLink.href = App.exportUrl('cashbook', state.from, state.to);
      const mine = ++seq;
      try {
        data = await App.api('api/cashbook.php', { params: { from: state.from, to: state.to, account_id: state.account_id || '', q: state.q } });
      } catch (e) { App.mount(out, el('p', { class: 'alert alert-error', text: e.message })); return; }
      if (mine !== seq) return;
      const d = data;
      const isToday = state.from === App.today && state.to === App.today;
      const periodText = !state.from && !state.to ? 'all time' : isToday ? 'today' : state.from === state.to ? 'on ' + App.fmtDate(state.from) : 'in this period';
      const amtLabel = (way) => (isToday ? 'Today amount ' : 'Amount ') + way;

      // Boxes follow the filters: only the chosen account, and each box shows that account's in and out for the period.
      const perAcc = {};
      d.rows.forEach((x) => { const t = perAcc[x.account_id] || (perAcc[x.account_id] = { in: 0, out: 0 }); t[x.kind === 'in' ? 'in' : 'out'] += x.amount_paise; });
      const shown = d.accounts.filter((a) => !state.account_id || a.id === state.account_id);
      App.mount(strip,
        shown.map((a) => { const t = perAcc[a.id] || { in: 0, out: 0 }; return el('div', { class: 'kpi' },
          el('span', { class: 'kpi-label' }, a.name, ' ', App.chip(App.LABELS.accountType[a.type] || a.type, a.type === 'cash' ? 'warn' : 'info')),
          el('span', { class: 'kpi-value', text: inr(a.balance_paise) }),
          el('span', { class: 'kpi-sub' }, 'balance now · ', el('span', { class: 'credit', text: '+' + inr(t.in) }), ' ', el('span', { class: 'owe', text: '−' + inr(t.out) }), ' ' + periodText)); }),
        el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: amtLabel('in') }), el('span', { class: 'kpi-value credit', text: inr(d.in_paise) }), el('span', { class: 'kpi-sub', text: isToday ? App.fmtDate(App.today) : periodText })),
        el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: amtLabel('out') }), el('span', { class: 'kpi-value owe', text: inr(d.out_paise) }), el('span', { class: 'kpi-sub', text: 'net ' + inr(d.in_paise - d.out_paise) + ' ' + periodText })));

      paintChips();

      App.mount(totals,
        el('span', null, 'In ', el('strong', { text: inr(d.in_paise) })),
        el('span', null, 'Out ', el('strong', { text: inr(d.out_paise) })),
        el('span', null, 'Net ', el('strong', { text: inr(d.in_paise - d.out_paise) })),
        el('span', { class: 'muted', text: App.plural(d.rows.length, 'entry').replace('entrys', 'entries') + (d.running ? '' : ' (balance column hidden while searching)') }));

      App.mount(out,
        App.table([
          { label: 'Date', class: 'nowrap', render: (x) => App.fmtDate(x.entry_on) },
          { label: 'Account', render: (x) => App.chip(x.account_name, /cash/i.test(x.account_name) ? 'warn' : 'info') },
          { label: 'Who', render: (x) => el('span', null,
            x.customer_id ? el('a', { class: 'tbl-link', href: '#/customer?id=' + x.customer_id, text: x.who }) : x.who,
            el('span', { class: 'cell-sub', text: x.kind === 'in' ? 'paid you' : 'you paid' })) },
          { label: 'For', render: (x) => el('span', null,
            x.purpose,
            x.order_id ? [' ', el('a', { class: 'tbl-link mono', href: '#/order?id=' + x.order_id, text: x.order_no })] : null,
            x.note ? el('span', { class: 'cell-sub', text: x.note }) : null) },
          { label: 'In', class: 'right mono', render: (x) => (x.kind === 'in' ? el('span', { class: 'credit', text: '+' + inr(x.amount_paise) }) : '') },
          { label: 'Out', class: 'right mono', render: (x) => (x.kind === 'out' ? el('span', { class: 'owe', text: '-' + inr(x.amount_paise) }) : '') },
          { label: 'Balance', class: 'right mono', render: (x) => (x.balance_paise === null ? el('span', { class: 'muted', text: '–' }) : inr(x.balance_paise)) },
          { label: '', class: 'right', render: (x) => (x.src === 'payment'
            ? el('a', { class: 'btn btn-small', href: '#/payments?q=' + encodeURIComponent(x.order_no || x.who), text: 'Payments' })
            : el('button', { type: 'button', class: 'btn btn-small', text: 'Cancel', onclick: async () => {
              const reason = await App.askText({ title: 'Cancel this entry?', message: 'Use this for a wrong entry. It stops counting but stays in the log.', label: 'Reason', okLabel: 'Cancel entry', danger: true, required: true });
              if (reason === null) return;
              try { await App.api('api/cashbook.php', { body: { action: 'void', id: x.id, reason } }); App.toast('Entry cancelled.'); load(); } catch (e) { App.toast(e.message, 'error'); }
            } })) },
        ], d.rows, 'No entries in this period.'));

      App.mount(byPurpose, shareList(d.by_purpose, 'meter-out'));
      App.mount(byWho, shareList(d.by_who, 'meter-in'));
    }

    const addEntry = (kind) => App.cashbookModal({
      kind, accounts: data ? data.accounts : [], purposes: data ? data.purposes : [],
      who: data ? data.payees : [], onSaved: load,
    });

    const apply = () => { state.from = from.value; state.to = to.value; load(); };
    from.addEventListener('change', apply);
    to.addEventListener('change', apply);
    q.addEventListener('input', App.debounce(() => { state.q = q.value.trim(); load(); }, 300));

    App.mount(page,
      el('div', { class: 'page-head' },
        el('div', null, el('h1', { text: 'Cash book' }), el('p', { class: 'page-sub', text: 'Every rupee in and out: who paid, where it went, and what is left in each account.' })),
        el('div', { class: 'row-gap' },
          exportLink,
          el('button', { type: 'button', class: 'btn', text: 'Money in', onclick: () => addEntry('in') }),
          el('button', { type: 'button', class: 'btn btn-primary', text: 'Add expense', onclick: () => addEntry('out') }))),
      el('section', { class: 'card' },
        el('div', { class: 'toolbar' },
          el('div', { class: 'filters' }, presets.map(([label, fn]) => el('button', { type: 'button', class: 'filter-chip', text: label, onclick: () => { const [a, b] = fn(); from.value = a; to.value = b; apply(); } }))),
          App.field('From', from), App.field('To', to),
          el('div', { class: 'field field-grow' }, el('span', { class: 'field-label', text: 'Search' }), q)),
        el('div', { class: 'row-gap' }, accountChips),
        totals),
      strip,
      el('div', { class: 'cb-split' },
        out,
        el('div', { class: 'stack' },
          el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Where it went' }), el('span', { class: 'muted small', text: 'money out' })), byPurpose),
          el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Who paid' }), el('span', { class: 'muted small', text: 'money in' })), byWho))));
    await load();
  });
}());

/* Item types: the kinds of perfume item (white box, OG box, tester, gift set ...) and the fixed
   purchase and selling price of each. Add, rename, change prices or delete. */
(function () {
  const el = App.el;

  App.view('itemtypes', { nav: 'itemtypes', title: 'Item types' }, async (page) => {
    const err = el('div', { class: 'form-error', role: 'alert' });
    const rowsEl = el('tbody');
    let types = (await App.api('api/item_types.php')).types;

    /** One editable line: name, purchase, selling, profit per piece, Save, Delete. */
    function line(t) {
      const name = App.input({ placeholder: 'Type name (e.g. OG box)', maxlength: 60, value: t.name || '', 'aria-label': 'Type name' });
      const cost = App.moneyInput(t.cost_paise || 0, { placeholder: '0', 'aria-label': 'Purchase price' });
      const rate = App.moneyInput(t.rate_paise || 0, { placeholder: '0', 'aria-label': 'Selling price' });
      const profit = el('td', { class: 'col-profit', 'data-label': 'Profit per piece' });
      const save = el('button', { type: 'button', class: 'btn btn-small btn-primary', text: t.id ? 'Save' : 'Add' });
      const del = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete type', title: 'Delete', text: '×' });
      const tr = el('tr', null,
        el('td', { class: 'col-name' }, name),
        el('td', { class: 'col-cost', 'data-label': 'Purchase' }, cost),
        el('td', { class: 'col-rate', 'data-label': 'Selling' }, rate),
        profit,
        el('td', { class: 'col-act' }, save),
        el('td', { class: 'col-x' }, del));
      const paintProfit = () => {
        const c = App.toPaise(cost.value) || 0;
        const r = App.toPaise(rate.value) || 0;
        App.clear(profit);
        if (c || r) profit.appendChild(App.profitCell(r - c, r > 0 ? Math.round(((r - c) / r) * 1000) / 10 : null));
      };
      const dirty = () => { save.classList.add('btn-attention'); };
      [cost, rate].forEach((n) => n.addEventListener('input', () => { paintProfit(); dirty(); }));
      name.addEventListener('input', dirty);
      paintProfit();

      save.addEventListener('click', async () => {
        err.textContent = '';
        const c = App.toPaise(cost.value || '0');
        const r = App.toPaise(rate.value || '0');
        if (!name.value.trim()) { err.textContent = 'Type the name of the type.'; name.focus(); return; }
        if (c === null || c < 0) { err.textContent = name.value.trim() + ': purchase price is not a valid amount.'; return; }
        if (r === null || r < 0) { err.textContent = name.value.trim() + ': selling price is not a valid amount.'; return; }
        save.disabled = true;
        try {
          const d = await App.api('api/item_types.php', { body: { action: 'save', id: t.id || 0, name: name.value.trim(), cost_paise: c, rate_paise: r } });
          App.toast(t.id ? 'Type saved.' : 'Type added.');
          types = d.types;
          paintAll();
        } catch (e) { err.textContent = e.message; save.disabled = false; }
      });
      del.addEventListener('click', async () => {
        err.textContent = '';
        if (!t.id) { tr.remove(); return; }
        const ok = await App.confirm('Delete "' + t.name + '"? Orders already made keep it on their lines; it just stops showing in the dropdown.', 'Delete', true);
        if (!ok) return;
        try {
          const d = await App.api('api/item_types.php', { body: { action: 'delete', id: t.id } });
          App.toast('Type deleted.');
          types = d.types;
          paintAll();
        } catch (e) { err.textContent = e.message; }
      });
      return tr;
    }

    function paintAll() {
      App.clear(rowsEl);
      types.forEach((t) => rowsEl.appendChild(line(t)));
      if (!types.length) rowsEl.appendChild(el('tr', null, el('td', { class: 'muted small', colspan: 6, text: 'No types yet. Click "Add type".' })));
    }
    paintAll();

    const addBtn = el('button', { type: 'button', class: 'btn', text: 'Add type', onclick: () => {
      if (rowsEl.lastChild && rowsEl.lastChild.querySelector && !rowsEl.lastChild.querySelector('input')) rowsEl.lastChild.remove();
      const tr = line({});
      rowsEl.appendChild(tr);
      tr.querySelector('input').focus();
    } });

    App.mount(page,
      el('div', { class: 'page-head' }, el('div', null, el('h1', { text: 'Item types' }),
        el('p', { class: 'page-sub', text: 'Set the purchase and selling price once per type. On a new order, pick the perfume and the type and both prices fill in by themselves.' })),
        addBtn),
      el('section', { class: 'card' },
        el('h2', { text: 'Prices' }),
        el('div', { class: 'table-wrap' }, el('table', { class: 'items-tbl types-tbl' },
          el('thead', null, el('tr', null, ['Type', 'Purchase (₹)', 'Selling (₹)', 'Profit per piece', '', ''].map((h) => el('th', { text: h })))),
          rowsEl)),
        err,
        el('p', { class: 'muted small', text: 'The same price applies to every perfume of that type. A price left at 0 is not filled in, so the catalog price is used instead. You can still change the price on one order line. Press Save on a line after changing it.' })));
  });
})();

App.start();