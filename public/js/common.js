// Shared helpers for the Student Business Game
const SBG = (() => {
  const TOKEN_KEYS = { student: 'sbg_token', teacher: 'sbg_teacher_token' };
  let role = 'student';

  function setRole(r) { role = r; }
  function getToken() { try { return localStorage.getItem(TOKEN_KEYS[role]) || ''; } catch { return ''; } }
  function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEYS[role], t) : localStorage.removeItem(TOKEN_KEYS[role]); } catch {} }

  async function api(method, path, body) {
    const opts = { method, headers: {} };
    const token = getToken();
    if (token) opts.headers.authorization = 'Bearer ' + token;
    if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res, data;
    try {
      res = await fetch('/api/' + path, opts);
      data = await res.json().catch(() => ({}));
    } catch (e) {
      throw new Error('Could not reach the server. Check your internet connection.');
    }
    if (res.status === 401 && path !== 'login' && path !== 'teacher/login') {
      setToken('');
      location.href = role === 'teacher' ? '/teacher.html' : '/';
      throw new Error(data.error || 'Please log in again.');
    }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  const money = (c) => {
    c = Number(c) || 0;
    return (c < 0 ? '-$' : '$') + (Math.abs(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  const dollars = (c) => ((Number(c) || 0) / 100).toFixed(2);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const date = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const dateTime = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const initial = (name) => esc((String(name || '?').trim()[0] || '?').toUpperCase());
  const logoHtml = (b, cls = '') => b.logo
    ? `<img class="logo ${cls}" src="${esc(b.logo)}" alt="${esc(b.name)} logo">`
    : `<div class="logo ${cls}">${initial(b.name)}</div>`;
  const pill = (status) => `<span class="pill ${esc(status)}">${esc(status)}</span>`;

  const KIND_LABEL = {
    award: 'Award', purchase: 'Purchase', payout: 'Owner payout', tax: 'Tax', fee: 'Fee', grant: 'Grant',
    loan: 'Loan', loan_payment: 'Loan payment', refund: 'Refund', expense: 'Business expense',
  };
  const kindLabel = (k) => KIND_LABEL[k] || k;

  let toastTimer;
  function toast(msg, isErr = false) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = ''), isErr ? 5000 : 2800);
  }

  function modal(html, { onOpen } = {}) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => bg.remove();
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
    document.body.appendChild(bg);
    if (onOpen) onOpen(bg.querySelector('.modal'), close);
    const f = bg.querySelector('input, textarea, select');
    if (f) setTimeout(() => f.focus(), 30);
    return close;
  }

  // Wrap a form submit: disables button, shows errors as toast
  function onSubmit(form, fn) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      try { await fn(Object.fromEntries(new FormData(form)), form); }
      catch (err) { toast(err.message, true); }
      finally { if (btn) btn.disabled = false; }
    });
  }

  // Resize an uploaded image to a small square-ish logo (data URL)
  function readLogo(file, max = 256) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve('');
      if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          let url = c.toDataURL('image/png');
          if (url.length > 250000) url = c.toDataURL('image/jpeg', 0.85);
          resolve(url);
        };
        img.onerror = () => reject(new Error('That image could not be read.'));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- tiny SVG charts ----------
  const PALETTE = ['#1f6b4f', '#c99a2e', '#2c5d8a', '#b23b32', '#7a4f9a', '#3e9a8c', '#d17a3a', '#6b7a3a', '#8a8f99'];

  function lineChart(points, { height = 200, color = '#1f6b4f', fill = true } = {}) {
    if (!points.length) return '<div class="empty">No activity yet.</div>';
    if (points.length === 1) points = [{ x: points[0].x - 864e5, y: points[0].y }, points[0]];
    const W = 600, H = height, P = { l: 58, r: 12, t: 12, b: 26 };
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(0, ...ys), y1 = Math.max(...ys);
    if (y1 === y0) y1 = y0 + 100;
    const sx = (x) => P.l + ((x - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
    const sy = (y) => H - P.b - ((y - y0) / (y1 - y0)) * (H - P.t - P.b);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    const area = `${d}L${sx(x1).toFixed(1)},${sy(Math.max(y0, 0))}L${sx(x0).toFixed(1)},${sy(Math.max(y0, 0))}Z`;
    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const v = y0 + ((y1 - y0) * i) / 3;
      grid += `<line x1="${P.l}" x2="${W - P.r}" y1="${sy(v)}" y2="${sy(v)}" stroke="#e6dfcd" />
        <text x="${P.l - 6}" y="${sy(v) + 4}" text-anchor="end" font-size="11" fill="#5f6e67" font-family="IBM Plex Mono, monospace">${money(Math.round(v)).replace('.00', '')}</text>`;
    }
    const labels = [x0, (x0 + x1) / 2, x1].map((x, i) =>
      `<text x="${sx(x)}" y="${H - 6}" font-size="11" fill="#5f6e67" text-anchor="${['start', 'middle', 'end'][i]}">${date(x)}</text>`).join('');
    const last = points[points.length - 1];
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">
      ${grid}
      ${fill ? `<path d="${area}" fill="${color}" opacity=".10" />` : ''}
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" />
      <circle cx="${sx(last.x)}" cy="${sy(last.y)}" r="4.5" fill="${color}" />
      ${labels}
    </svg></div>`;
  }

  function donut(slices, { size = 180 } = {}) {
    slices = slices.filter((s) => s.value > 0);
    const total = slices.reduce((a, s) => a + s.value, 0);
    if (!total) return '<div class="empty">Nothing spent yet.</div>';
    const r = 70, cx = 90, cy = 90, C = 2 * Math.PI * r;
    let off = 0;
    const arcs = slices.map((s, i) => {
      const len = (s.value / total) * C;
      const color = s.color || PALETTE[i % PALETTE.length];
      const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="26"
        stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(s.label)}: ${money(s.value)}</title></circle>`;
      off += len;
      s.color = color;
      return el;
    }).join('');
    return `<div class="row" style="align-items:center;gap:18px;flex-wrap:nowrap">
      <svg viewBox="0 0 180 180" width="${size}" height="${size}" style="flex:none">${arcs}
        <text x="90" y="86" text-anchor="middle" font-size="11" fill="#5f6e67">Total</text>
        <text x="90" y="104" text-anchor="middle" font-size="15" font-weight="700" font-family="IBM Plex Mono, monospace" fill="#1d2b26">${money(total)}</text>
      </svg>
      <div class="legend" style="flex-direction:column;align-items:flex-start">${slices.map((s) =>
        `<span><i style="background:${s.color}"></i>${esc(s.label)} <b class="money">${money(s.value)}</b></span>`).join('')}</div>
    </div>`;
  }

  function bars(rows, { valueFmt = money, color = '#1f6b4f' } = {}) {
    if (!rows.length) return '<div class="empty">No data yet.</div>';
    const max = Math.max(...rows.map((r) => r.value), 1);
    return `<div class="bars">${rows.map((r) => `<div class="bar-row"><div>${esc(r.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.value / max) * 100}%;background:${r.color || color}"></div></div>
      <div class="num small">${valueFmt(r.value)}</div></div>`).join('')}</div>`;
  }

  function columns(rows, { height = 200 } = {}) {
    // rows: [{label, a, b}] grouped columns (a = in, b = out)
    if (!rows.length) return '<div class="empty">No activity yet.</div>';
    const W = 600, H = height, P = { l: 58, r: 10, t: 10, b: 26 };
    const max = Math.max(...rows.map((r) => Math.max(r.a, r.b)), 100);
    const bw = (W - P.l - P.r) / rows.length;
    const sy = (v) => H - P.b - (v / max) * (H - P.t - P.b);
    let g = '';
    for (let i = 0; i <= 3; i++) {
      const v = (max * i) / 3;
      g += `<line x1="${P.l}" x2="${W - P.r}" y1="${sy(v)}" y2="${sy(v)}" stroke="#e6dfcd"/><text x="${P.l - 6}" y="${sy(v) + 4}" text-anchor="end" font-size="11" fill="#5f6e67" font-family="IBM Plex Mono, monospace">${money(Math.round(v)).replace('.00', '')}</text>`;
    }
    rows.forEach((r, i) => {
      const x = P.l + i * bw + bw * 0.15, w = (bw * 0.7) / 2;
      g += `<rect x="${x}" y="${sy(r.a)}" width="${w}" height="${H - P.b - sy(r.a)}" fill="#1f6b4f" rx="3"><title>${esc(r.label)} in: ${money(r.a)}</title></rect>`;
      g += `<rect x="${x + w}" y="${sy(r.b)}" width="${w}" height="${H - P.b - sy(r.b)}" fill="#c99a2e" rx="3"><title>${esc(r.label)} out: ${money(r.b)}</title></rect>`;
      if (rows.length <= 14 || i % Math.ceil(rows.length / 10) === 0) g += `<text x="${P.l + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#5f6e67">${esc(r.label)}</text>`;
    });
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}">${g}</svg></div>`;
  }

  // Group transactions into per-day buckets (last N days with activity)
  function byDay(tx, isIn, days = 14) {
    const map = new Map();
    for (const t of tx) {
      const d = new Date(t.created_at); d.setHours(0, 0, 0, 0);
      const k = d.getTime();
      if (!map.has(k)) map.set(k, { a: 0, b: 0 });
      const m = map.get(k);
      if (isIn(t)) m.a += t.amount; else m.b += t.amount;
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).slice(-days).map(([k, v]) => ({ label: date(k), ...v }));
  }

  // Balance history for an account, worked backwards from the current balance
  function balanceHistory(tx, current, isIn) {
    const sorted = [...tx].sort((a, b) => b.created_at - a.created_at || b.id - a.id);
    let bal = current;
    const pts = [{ x: Date.now(), y: bal }];
    for (const t of sorted) {
      pts.push({ x: t.created_at, y: bal });
      bal += isIn(t) ? -t.amount : t.amount;
      pts.push({ x: t.created_at - 1, y: bal });
    }
    return pts.reverse();
  }

  function txTable(tx, { meType, meId, refund = false, empty = 'No transactions yet.' } = {}) {
    if (!tx.length) return `<div class="empty">${empty}</div>`;
    return `<div class="table-wrap"><table><thead><tr><th>When</th><th>Type</th><th>Details</th><th class="r">Amount</th>${refund ? '<th></th>' : ''}</tr></thead><tbody>
      ${tx.map((t) => {
        let sign = '', who = '';
        if (meType) {
          const incoming = t.to_type === meType && t.to_id === meId;
          sign = incoming ? '+' : '−';
          who = incoming ? `from ${esc(t.from_name)}` : `to ${esc(t.to_name)}`;
          return `<tr class="${t.refunded ? 'refunded' : ''}"><td class="small muted">${dateTime(t.created_at)}</td><td>${esc(kindLabel(t.kind))}</td>
            <td>${esc(t.memo || '')}<div class="small muted">${who}</div></td>
            <td class="r money ${incoming ? 'pos' : 'neg'}">${sign}${money(t.amount)}</td></tr>`;
        }
        return `<tr class="${t.refunded ? 'refunded' : ''}"><td class="small muted">#${t.id}<br>${dateTime(t.created_at)}</td><td>${esc(kindLabel(t.kind))}</td>
          <td><b>${esc(t.from_name)}</b> → <b>${esc(t.to_name)}</b><div class="small muted">${esc(t.memo || '')}</div></td>
          <td class="r money">${money(t.amount)}</td>
          ${refund ? `<td class="r">${t.kind !== 'refund' && !t.refunded ? `<button class="btn sm" data-refund="${t.id}">Refund</button>` : t.refunded ? '<span class="small muted">refunded</span>' : ''}</td>` : ''}</tr>`;
      }).join('')}</tbody></table></div>`;
  }

  return { setRole, getToken, setToken, api, money, dollars, esc, date, dateTime, logoHtml, pill, kindLabel, toast, modal, onSubmit, readLogo,
    lineChart, donut, bars, columns, byDay, balanceHistory, txTable, PALETTE, initial };
})();
