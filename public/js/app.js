// Student side: bank, businesses, grants, loans, cash register
const { api, money, dollars, esc, dateTime, logoHtml, pill, kindLabel, toast, modal, onSubmit, readLogo,
  lineChart, donut, bars, columns, byDay, balanceHistory, txTable, setToken, getToken } = SBG;

if (!getToken()) location.href = '/';

const view = document.getElementById('view');
let me = null;          // /api/me
let roster = null;      // class list for the cash register
let currentBiz = null;  // business detail
let bizTab = 'register';
let cart = [];

document.getElementById('logout').onclick = async () => {
  try { await api('POST', 'logout'); } catch {}
  setToken('');
  location.href = '/';
};

async function loadMe() {
  me = await api('GET', 'me');
  document.getElementById('bankName').textContent = me.bank_name;
  document.getElementById('who').textContent = me.student.name;
  return me;
}

function setNav(tab) {
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
}

const isInStudent = (t) => t.to_type === 'student' && t.to_id === me.student.id;

// ---------------- router ----------------
async function router() {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, id] = h.split('/');
  try {
    if (page === 'biz' && id) { setNav('businesses'); await showBusiness(+id); }
    else {
      await loadMe();
      if (page === 'businesses') { setNav('businesses'); showBusinesses(); }
      else if (page === 'grants') { setNav('grants'); showGrants(); }
      else if (page === 'loans') { setNav('loans'); showLoans(); }
      else if (page === 'directory') { setNav('directory'); await showDirectory(); }
      else if (page === 'create') { setNav('businesses'); showCreateBusiness(); }
      else { setNav('bank'); showBank(); }
    }
  } catch (e) {
    view.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);
router();

// ---------------- My Bank ----------------
function pinCard() {
  const has = me.student.has_pin;
  return `<div class="card ${has ? '' : 'app-card'}" id="pinCard">
    <h3>${has ? 'Change my bank PIN' : '🔒 Create your 4-digit bank PIN'}</h3>
    <p class="small muted">${has
      ? 'Your PIN lets you pay at class businesses. To change it, type your account password too.'
      : 'You need a PIN before you can buy anything. When you shop at a class business, you type this PIN at their cash register. Keep it secret!'}</p>
    <form id="pinForm" class="row" style="align-items:flex-end">
      <div style="flex:1;min-width:140px"><label>New PIN</label>
        <input name="pin" class="pin-input" inputmode="numeric" pattern="\\d{4}" maxlength="4" required autocomplete="off" placeholder="••••"></div>
      <div style="flex:1;min-width:140px"><label>Type it again</label>
        <input name="pin2" class="pin-input" inputmode="numeric" pattern="\\d{4}" maxlength="4" required autocomplete="off" placeholder="••••"></div>
      ${has ? `<div style="flex:1;min-width:160px"><label>Account password</label><input name="password" type="password" required></div>` : ''}
      <button class="btn primary" type="submit">${has ? 'Change PIN' : 'Save my PIN'}</button>
    </form>
  </div>`;
}
function wirePin() {
  onSubmit(document.getElementById('pinForm'), async (d) => {
    if (d.pin !== d.pin2) throw new Error('The two PINs do not match.');
    await api('POST', 'pin', d);
    toast('PIN saved!');
    router();
  });
}

function showBank() {
  const st = me.student;
  const tx = me.transactions;
  const live = tx.filter((t) => !t.refunded && t.kind !== 'refund');
  const income = live.filter(isInStudent);
  const spend = live.filter((t) => !isInStudent(t));
  const totalIn = income.reduce((a, t) => a + t.amount, 0);
  const totalOut = spend.reduce((a, t) => a + t.amount, 0);
  const weekAgo = Date.now() - 7 * 864e5;
  const weekOut = spend.filter((t) => t.created_at > weekAgo).reduce((a, t) => a + t.amount, 0);

  const cats = {};
  for (const t of spend) {
    const k = t.kind === 'purchase' ? t.to_name : ({ tax: 'Taxes', fee: 'Fees', loan_payment: 'Loan payments' }[t.kind] || kindLabel(t.kind));
    cats[k] = (cats[k] || 0) + t.amount;
  }
  const slices = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  const incomeCats = {};
  for (const t of income) incomeCats[kindLabel(t.kind)] = (incomeCats[kindLabel(t.kind)] || 0) + t.amount;

  const approved = me.businesses.filter((b) => b.status === 'approved');
  const others = me.businesses.filter((b) => b.status !== 'approved');
  const activeLoans = me.loans.filter((l) => l.status === 'active');

  view.innerHTML = `
    ${st.has_pin ? '' : pinCard()}
    <div class="grid g2" style="margin-top:${st.has_pin ? 0 : 16}px">
      <div class="bankcard">
        <div class="bk-top"><span>${esc(me.bank_name)} · Checking</span><span class="chip"></span></div>
        <div><div class="small" style="opacity:.8">Available balance</div>
          <div class="bk-bal ${st.balance < 0 ? 'neg' : ''}">${money(st.balance)}</div></div>
        <div class="row between"><span class="bk-name">${esc(st.name)}</span><span class="bk-name">Acct •••• ${String(st.id).padStart(4, '0')}</span></div>
      </div>
      <div class="grid g2">
        <div class="stat"><div class="label">Money in</div><div class="value pos">${money(totalIn)}</div><div class="sub">all time</div></div>
        <div class="stat"><div class="label">Money out</div><div class="value neg">${money(totalOut)}</div><div class="sub">all time</div></div>
        <div class="stat"><div class="label">Spent this week</div><div class="value">${money(weekOut)}</div><div class="sub">last 7 days</div></div>
        <div class="stat"><div class="label">Loans owed</div><div class="value">${money(activeLoans.reduce((a, l) => a + l.balance_owed, 0))}</div>
          <div class="sub">${activeLoans.length} active loan${activeLoans.length === 1 ? '' : 's'}</div></div>
      </div>
    </div>

    <div class="row" style="margin-top:16px">
      <a class="btn primary" href="#/create">＋ Create a Business</a>
      <button class="btn" id="joinBtn">Join a Business</button>
      <a class="btn" href="#/grants">Apply for a Grant</a>
      <a class="btn" href="#/loans">Apply for a Loan</a>
    </div>

    <div class="section-title"><h2>My Businesses</h2><span class="small muted">Tap a business to open its page and cash register</span></div>
    <div class="tiles">
      ${approved.map(bizTile).join('')}
      ${others.map(bizTile).join('')}
      <a class="tile add" href="#/create">＋ Create a business</a>
    </div>

    <div class="section-title"><h2>My Money Dashboard</h2></div>
    <div class="grid g2">
      <div class="card"><h3>Balance over time</h3>${lineChart(balanceHistory(tx, st.balance, isInStudent))}</div>
      <div class="card"><h3>Where my money went</h3>${donut(slices)}</div>
      <div class="card"><h3>Money in vs. money out by day</h3>${columns(byDay(live, isInStudent))}
        <div class="legend"><span><i style="background:#1f6b4f"></i>In</span><span><i style="background:#c99a2e"></i>Out</span></div></div>
      <div class="card"><h3>Where my money came from</h3>${bars(Object.entries(incomeCats).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })))}</div>
    </div>

    <div class="section-title"><h2>Recent activity</h2></div>
    <div class="card">${txTable(tx.slice(0, 40), { meType: 'student', meId: st.id })}</div>

    ${st.has_pin ? `<div class="section-title"><h2>Security</h2></div>${pinCard()}` : ''}
  `;
  wirePin();
  document.getElementById('joinBtn').onclick = joinBusiness;
}

function bizTile(b) {
  const href = `#/biz/${b.id}`;
  return `<a class="tile" href="${href}">${logoHtml(b)}<div style="min-width:0">
    <div class="t-name">${esc(b.name)}</div>
    <div class="t-sub">${b.status === 'approved' ? `Balance <span class="money">${money(b.balance)}</span>` : pill(b.status)}</div>
    <div class="t-sub">${b.role === 'owner' ? 'Owner' : 'Partner'}${b.status !== 'approved' ? ' · Permit ' + (b.status === 'pending' ? 'under review' : b.status) : ''}</div>
  </div></a>`;
}

function joinBusiness() {
  modal(`<h2>Join a Business</h2>
    <p class="muted">Ask the business owner for their 6-letter partner code.</p>
    <form id="joinForm"><label>Partner code</label>
      <input name="code" required autocapitalize="characters" class="pin-input" maxlength="8" style="letter-spacing:.3em">
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Join</button></div>
    </form>`, {
    onOpen: (m, close) => onSubmit(m.querySelector('form'), async (d) => {
      const r = await api('POST', 'business/join', d);
      close();
      toast(`You joined ${r.name}!` + (r.status === 'pending' ? ' It is still waiting for its permit.' : ''));
      location.hash = `#/biz/${r.id}`;
    }),
  });
}

// ---------------- My Businesses ----------------
function showBusinesses() {
  view.innerHTML = `
    <div class="section-title" style="margin-top:0"><h1>My Businesses</h1>
      <div class="row"><a class="btn primary" href="#/create">＋ Create a Business</a><button class="btn" id="joinBtn">Join with a code</button></div></div>
    ${me.businesses.length ? `<div class="tiles">${me.businesses.map(bizTile).join('')}</div>`
      : `<div class="card empty">You are not part of a business yet. Create one, or ask a classmate for their partner code and join theirs.</div>`}
    <div class="card" style="margin-top:20px"><h3>How it works</h3>
      <ol class="small" style="margin:0;padding-left:18px">
        <li><b>Apply for a Business Permit</b> — click Create a Business and fill out the form.</li>
        <li><b>Share your partner code</b> with classmates who will run the business with you.</li>
        <li><b>Wait for approval</b> — your teacher reviews every permit.</li>
        <li><b>Open for business!</b> Use the cash register to sell. Customers type their PIN to pay.</li>
        <li><b>Pay the owners</b> from the business account when you make a profit.</li>
      </ol>
    </div>`;
  document.getElementById('joinBtn').onclick = joinBusiness;
}

// ---------------- Create a Business (permit application) ----------------
function itemRow(i = {}) {
  return `<div class="inline-fields item-row" style="margin-bottom:8px">
    <input name="iname" placeholder="Item name" value="${esc(i.name || '')}" maxlength="60">
    <input name="idesc" placeholder="Description" value="${esc(i.description || '')}" maxlength="300">
    <input name="iprice" placeholder="Price $" inputmode="decimal" value="${i.price != null ? dollars(i.price) : ''}">
    <button type="button" class="btn sm ghost" data-remove title="Remove">✕</button>
  </div>`;
}

function showCreateBusiness() {
  let logo = '';
  view.innerHTML = `
    <div class="card" style="max-width:820px;margin:0 auto">
      <h1>Business Permit Application</h1>
      <p class="muted">Fill this out to start a business. Your teacher will review it. Once it is approved you can start selling.</p>
      <form id="bizForm">
        <div class="grid g2">
          <div><label>Business name</label><input name="name" required maxlength="60"></div>
          <div><label>Slogan</label><input name="slogan" maxlength="120" placeholder="A short catchy line"></div>
        </div>
        <label>What does your business do? <span class="hint">(description)</span></label>
        <textarea name="description" maxlength="1000"></textarea>
        <label>Logo <span class="hint">(upload an image)</span></label>
        <div class="row"><div id="logoPrev" class="logo lg">?</div><input type="file" accept="image/*" id="logoFile" style="max-width:320px"></div>
        <label style="margin-top:18px">Items for sale</label>
        <div class="small muted" style="margin-bottom:8px">Name · Description · Price</div>
        <div id="itemRows">${itemRow()}${itemRow()}</div>
        <button type="button" class="btn sm" id="addItem">＋ Add another item</button>
        <div class="row" style="margin-top:22px;justify-content:flex-end">
          <a class="btn" href="#/businesses">Cancel</a>
          <button class="btn primary lg" type="submit">Submit permit application</button>
        </div>
      </form>
    </div>`;
  const rows = document.getElementById('itemRows');
  document.getElementById('addItem').onclick = () => rows.insertAdjacentHTML('beforeend', itemRow());
  rows.addEventListener('click', (e) => { if (e.target.closest('[data-remove]') && rows.children.length > 1) e.target.closest('.item-row').remove(); });
  document.getElementById('logoFile').onchange = async (e) => {
    try {
      logo = await readLogo(e.target.files[0]);
      document.getElementById('logoPrev').outerHTML = `<img id="logoPrev" class="logo lg" src="${logo}" alt="">`;
    } catch (err) { toast(err.message, true); }
  };
  onSubmit(document.getElementById('bizForm'), async (d) => {
    const items = [...rows.querySelectorAll('.item-row')].map((r) => ({
      name: r.querySelector('[name=iname]').value, description: r.querySelector('[name=idesc]').value, price: r.querySelector('[name=iprice]').value,
    })).filter((i) => i.name.trim());
    const r = await api('POST', 'business', { name: d.name, slogan: d.slogan, description: d.description, logo, items });
    modal(`<h2>Application sent! 🎉</h2>
      <p>Your Business Permit for <b>${esc(d.name)}</b> is waiting for teacher approval.</p>
      <p>Give this <b>partner code</b> to classmates who will join your business:</p>
      <p style="text-align:center"><span class="code-box">${esc(r.join_code)}</span></p>
      <div class="actions"><button class="btn primary" data-close>Go to my business</button></div>`);
    location.hash = `#/biz/${r.id}`;
  });
}

// ---------------- Business page ----------------
async function showBusiness(id, keepTab = false) {
  if (!me) await loadMe();
  const [detail, r] = await Promise.all([api('GET', `business/${id}`), roster ? Promise.resolve({ students: roster }) : api('GET', 'roster')]);
  roster = r.students;
  if (!currentBiz || currentBiz.business.id !== id) { cart = []; if (!keepTab) bizTab = 'register'; }
  currentBiz = detail;
  const b = detail.business;
  if (b.status !== 'approved' && (bizTab === 'register' || bizTab === 'money')) bizTab = 'items';
  const tabs = [['register', '🧾 Cash Register'], ['dashboard', '📊 Dashboard'], ['items', '🏷️ Items for Sale'], ['money', '💸 Payouts & Expenses'], ['settings', '⚙️ Business Info']];
  view.innerHTML = `
    <a href="#/businesses" class="small">← My Businesses</a>
    <div class="card" style="margin-top:8px">
      <div class="biz-head">
        ${logoHtml(b, 'lg')}
        <div class="grow"><h1 style="margin:0">${esc(b.name)}</h1><div class="muted">${esc(b.slogan || '')}</div>
          <div class="row small" style="margin-top:6px">${pill(b.status)} <span class="muted">Partner code:</span> <b class="num">${esc(b.join_code)}</b></div></div>
        <div style="text-align:right"><div class="small muted">Business account</div><div class="money" style="font-size:1.8rem;font-weight:700">${money(b.balance)}</div></div>
      </div>
      ${b.status === 'pending' ? `<div class="notice warn" style="margin-top:14px">⏳ Your Business Permit is waiting for teacher approval. You can set up your items now. The cash register opens once you are approved.</div>` : ''}
      ${b.status === 'rejected' ? `<div class="notice err" style="margin-top:14px">Your permit was not approved.${b.teacher_note ? ` Teacher note: <b>${esc(b.teacher_note)}</b>` : ''} Make changes and ask your teacher to review it again.</div>` : ''}
      ${b.status === 'closed' ? `<div class="notice err" style="margin-top:14px">This business has been closed by the teacher.</div>` : ''}
      ${b.status === 'approved' && b.teacher_note ? `<div class="notice info small" style="margin-top:14px">Teacher note: ${esc(b.teacher_note)}</div>` : ''}
    </div>
    <div class="subtabs" id="bizTabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${bizTab === k ? 'active' : ''}" ${b.status !== 'approved' && (k === 'register' || k === 'money') ? 'disabled title="Opens after approval"' : ''}>${l}</button>`).join('')}</div>
    <div id="bizBody"></div>`;
  document.getElementById('bizTabs').onclick = (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    bizTab = t.dataset.t;
    document.querySelectorAll('#bizTabs button').forEach((x) => x.classList.toggle('active', x === t));
    renderBizTab();
  };
  renderBizTab();
}

function renderBizTab() {
  const body = document.getElementById('bizBody');
  ({ register: renderRegister, dashboard: renderBizDashboard, items: renderItems, money: renderBizMoney, settings: renderBizSettings })[bizTab](body);
}

const refreshBiz = () => showBusiness(currentBiz.business.id, true);

// ----- Cash register -----
function renderRegister(body) {
  const { items, business: b } = currentBiz;
  const periods = [...new Set(roster.map((s) => s.period || ''))];
  body.innerHTML = `
    <div class="register">
      <div class="card">
        <h3>Tap items the customer is buying</h3>
        ${items.length ? `<div class="item-buttons">${items.map((i) => `<button class="item-btn" data-add="${i.id}">
          <div><b>${esc(i.name)}</b><div class="small muted">${esc(i.description || '')}</div></div><div class="price">${money(i.price)}</div></button>`).join('')}</div>`
          : '<div class="empty">No items yet. Add some on the Items for Sale tab.</div>'}
      </div>
      <div class="card">
        <h3>Sale</h3>
        <div class="receipt" id="receipt"></div>
        <form id="saleForm" autocomplete="off">
          <div class="row" style="align-items:flex-end;flex-wrap:nowrap">
            <div style="flex:2;min-width:0"><label>Customer</label>
              <select name="buyer_id" required><option value="">Choose a student…</option>
                ${periods.map((p) => `<optgroup label="${p ? 'Period ' + esc(p) : 'Students'}">${roster.filter((s) => (s.period || '') === p)
                  .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}
              </select></div>
            <div style="flex:1;min-width:90px"><label>Customer PIN</label>
              <input name="pin" type="password" class="pin-input" inputmode="numeric" maxlength="4" pattern="\\d{4}" required placeholder="••••" autocomplete="new-password"></div>
          </div>
          <p class="small muted" style="margin:8px 0 0">Hand the device to the customer so they can type their own secret PIN.</p>
          <button class="btn primary block lg" type="submit" style="margin-top:12px" id="chargeBtn">Charge customer</button>
          <button class="btn ghost block sm" type="button" id="clearCart" style="margin-top:6px">Clear sale</button>
        </form>
      </div>
    </div>`;
  const drawCart = () => {
    const total = cart.reduce((a, c) => a + c.price * c.qty, 0);
    document.getElementById('receipt').innerHTML = cart.length
      ? cart.map((c, i) => `<div class="line"><span>${esc(c.name)}</span><span class="qty">
          <button type="button" data-dec="${i}">−</button><b>${c.qty}</b><button type="button" data-inc="${i}">+</button></span>
          <span>${money(c.price * c.qty)}</span></div>`).join('') + `<div class="total"><span>TOTAL</span><span>${money(total)}</span></div>`
      : '<div class="empty" style="font-family:var(--sans)">Tap items to add them to this sale.</div>';
    document.getElementById('chargeBtn').textContent = cart.length ? `Charge ${money(total)}` : 'Charge customer';
  };
  body.querySelector('.item-buttons')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    const it = items.find((i) => i.id === +btn.dataset.add);
    const line = cart.find((c) => c.item_id === it.id);
    if (line) line.qty = Math.min(99, line.qty + 1); else cart.push({ item_id: it.id, name: it.name, price: it.price, qty: 1 });
    drawCart();
  });
  document.getElementById('receipt').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
    if (inc) cart[+inc.dataset.inc].qty = Math.min(99, cart[+inc.dataset.inc].qty + 1);
    if (dec) { const i = +dec.dataset.dec; cart[i].qty--; if (cart[i].qty <= 0) cart.splice(i, 1); }
    drawCart();
  });
  document.getElementById('clearCart').onclick = () => { cart = []; drawCart(); };
  drawCart();
  const form = document.getElementById('saleForm');
  onSubmit(form, async (d) => {
    if (!cart.length) throw new Error('Add at least one item first.');
    const r = await api('POST', `business/${b.id}/sale`, { buyer_id: d.buyer_id, pin: d.pin, items: cart.map((c) => ({ item_id: c.item_id, qty: c.qty })) });
    const lines = cart.map((c) => `<div class="line"><span>${c.qty}× ${esc(c.name)}</span><span>${money(c.price * c.qty)}</span></div>`).join('');
    cart = [];
    modal(`<h2 style="text-align:center">✅ Payment approved</h2>
      <div class="receipt"><div style="text-align:center;font-weight:700">${esc(b.name)}</div>
        <div class="small" style="text-align:center">${dateTime(Date.now())} · Sale #${r.transaction_id}</div>${lines}
        <div class="total"><span>PAID</span><span>${money(r.total)}</span></div>
        <div class="small" style="text-align:center;margin-top:6px">Customer: ${esc(r.buyer)}</div></div>
      <div class="actions"><button class="btn primary" data-close>Next customer</button></div>`);
    refreshBiz();
  });
}

// ----- Business dashboard -----
function renderBizDashboard(body) {
  const { business: b, transactions: tx, top_items } = currentBiz;
  const isIn = (t) => t.to_type === 'business' && t.to_id === b.id;
  const live = tx.filter((t) => !t.refunded && t.kind !== 'refund');
  const sales = live.filter((t) => t.kind === 'purchase' && isIn(t));
  const revenue = sales.reduce((a, t) => a + t.amount, 0);
  const otherIn = live.filter((t) => isIn(t) && t.kind !== 'purchase').reduce((a, t) => a + t.amount, 0);
  const outs = live.filter((t) => !isIn(t));
  const expenses = outs.filter((t) => t.kind !== 'payout').reduce((a, t) => a + t.amount, 0);
  const payouts = outs.filter((t) => t.kind === 'payout').reduce((a, t) => a + t.amount, 0);
  const expCats = {};
  for (const t of outs) expCats[kindLabel(t.kind)] = (expCats[kindLabel(t.kind)] || 0) + t.amount;
  const salesByDay = byDay(sales, () => true).map((r) => ({ label: r.label, a: r.a, b: 0 }));
  body.innerHTML = `
    <div class="grid g4">
      <div class="stat"><div class="label">Sales revenue</div><div class="value pos">${money(revenue)}</div><div class="sub">${sales.length} sale${sales.length === 1 ? '' : 's'}</div></div>
      <div class="stat"><div class="label">Expenses</div><div class="value neg">${money(expenses)}</div><div class="sub">taxes, fees, costs, loan payments</div></div>
      <div class="stat"><div class="label">Profit</div><div class="value ${revenue - expenses >= 0 ? 'pos' : 'neg'}">${money(revenue - expenses)}</div><div class="sub">revenue − expenses</div></div>
      <div class="stat"><div class="label">Paid to owners</div><div class="value">${money(payouts)}</div><div class="sub">grants & loans in: ${money(otherIn)}</div></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Account balance over time</h3>${lineChart(balanceHistory(tx, b.balance, isIn))}</div>
      <div class="card"><h3>Sales by day</h3>${columns(salesByDay)}</div>
      <div class="card"><h3>🏆 Top-selling items</h3>
        ${top_items.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Item</th><th class="r">Sold</th><th class="r">Revenue</th></tr></thead><tbody>
          ${top_items.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.name)}</td><td class="r num">${t.qty}</td><td class="r money">${money(t.revenue)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">No sales yet.</div>'}</div>
      <div class="card"><h3>Where the money went</h3>${donut(Object.entries(expCats).map(([label, value]) => ({ label, value })))}</div>
    </div>
    <div class="section-title"><h2>Business transactions</h2></div>
    <div class="card">${txTable(tx.slice(0, 60), { meType: 'business', meId: b.id })}</div>`;
}

// ----- Items -----
function renderItems(body) {
  const { items, business: b } = currentBiz;
  body.innerHTML = `
    <div class="grid g2">
      <div class="card"><h3>Items for sale</h3>
        ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Item</th><th class="r">Price</th><th></th></tr></thead><tbody>
          ${items.map((i) => `<tr><td><b>${esc(i.name)}</b><div class="small muted">${esc(i.description || '')}</div></td><td class="r money">${money(i.price)}</td>
            <td class="r" style="white-space:nowrap"><button class="btn sm" data-edit="${i.id}">Edit</button> <button class="btn sm ghost" data-del="${i.id}">Remove</button></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">No items yet.</div>'}
      </div>
      <div class="card"><h3>Add a new item</h3>
        <form id="newItem">
          <label>Item name</label><input name="name" required maxlength="60">
          <label>Description</label><textarea name="description" maxlength="300" style="min-height:60px"></textarea>
          <label>Price ($)</label><input name="price" required inputmode="decimal" placeholder="0.00">
          <button class="btn primary" type="submit" style="margin-top:12px">Add item</button>
        </form>
      </div>
    </div>`;
  onSubmit(document.getElementById('newItem'), async (d) => { await api('POST', `business/${b.id}/items`, d); toast('Item added'); refreshBiz(); });
  body.onclick = async (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) {
      const it = items.find((i) => i.id === +ed.dataset.edit);
      modal(`<h2>Edit item</h2><form>
        <label>Item name</label><input name="name" required value="${esc(it.name)}" maxlength="60">
        <label>Description</label><textarea name="description" maxlength="300">${esc(it.description || '')}</textarea>
        <label>Price ($)</label><input name="price" required inputmode="decimal" value="${dollars(it.price)}">
        <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`, {
        onOpen: (m, close) => onSubmit(m.querySelector('form'), async (d) => { await api('PUT', `items/${it.id}`, d); close(); toast('Saved'); refreshBiz(); }),
      });
    }
    if (del) {
      const it = items.find((i) => i.id === +del.dataset.del);
      modal(`<h2>Remove ${esc(it.name)}?</h2><p>It will no longer show on the cash register. Past sales stay in your records.</p>
        <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn danger" id="yes">Remove</button></div>`, {
        onOpen: (m, close) => (m.querySelector('#yes').onclick = async () => {
          try { await api('DELETE', `items/${it.id}`); close(); toast('Removed'); refreshBiz(); } catch (err) { toast(err.message, true); }
        }),
      });
    }
  };
}

// ----- Payouts & expenses -----
function renderBizMoney(body) {
  const { business: b, members, loans } = currentBiz;
  const active = loans.filter((l) => l.status === 'active');
  body.innerHTML = `
    <div class="grid g2">
      <div class="card"><h3>💸 Pay the owners</h3>
        <p class="small muted">Move money from the business account (${money(b.balance)}) into owners' personal bank accounts.</p>
        <form id="payForm">
          ${members.map((m) => `<div class="row" style="flex-wrap:nowrap;margin:8px 0"><div style="flex:1">${esc(m.name)} <span class="small muted">${m.role}</span></div>
            <input name="m${m.id}" inputmode="decimal" placeholder="$0.00" style="max-width:130px"></div>`).join('')}
          <button type="button" class="btn sm" id="split">Split evenly</button>
          <label>Note <span class="hint">(optional)</span></label><input name="memo" maxlength="200" placeholder="Weekly profit share">
          <div class="row between" style="margin-top:12px"><span>Total: <b class="money" id="payTotal">$0.00</b></span>
            <button class="btn primary" type="submit">Send payouts</button></div>
        </form>
      </div>
      <div class="stack">
        <div class="card"><h3>🧾 Pay a business expense</h3>
          <p class="small muted">Buying supplies, rent, advertising… This pays the Bank from your business account.</p>
          <form id="expForm"><div class="grid g2">
            <div><label>Amount ($)</label><input name="amount" required inputmode="decimal"></div>
            <div><label>What for?</label><input name="memo" required maxlength="200" placeholder="Supplies"></div></div>
            <button class="btn" type="submit" style="margin-top:12px">Pay expense</button></form>
        </div>
        <div class="card"><h3>🏦 Business loans</h3>
          ${active.length ? active.map((l) => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)">
              <div>Loan #${l.id} · ${l.interest_rate}% interest<div class="small muted">Owed: <b class="money">${money(l.balance_owed)}</b></div></div>
              <button class="btn sm" data-payloan="${l.id}">Make payment</button></div>`).join('')
            : '<div class="empty">No active loans. <a href="#/loans">Apply for a loan</a></div>'}
        </div>
      </div>
    </div>`;
  const form = document.getElementById('payForm');
  const totalEl = document.getElementById('payTotal');
  const sum = () => members.reduce((a, m) => a + (Number(form[`m${m.id}`].value) || 0), 0);
  form.addEventListener('input', () => (totalEl.textContent = money(Math.round(sum() * 100))));
  document.getElementById('split').onclick = () => {
    const each = Math.floor(b.balance / members.length) / 100;
    members.forEach((m) => (form[`m${m.id}`].value = each.toFixed(2)));
    totalEl.textContent = money(Math.round(sum() * 100));
  };
  onSubmit(form, async (d) => {
    const payouts = members.map((m) => ({ student_id: m.id, amount: d[`m${m.id}`] || 0 })).filter((p) => Number(p.amount) > 0);
    const r = await api('POST', `business/${b.id}/payout`, { payouts, memo: d.memo });
    toast(`Paid out ${money(r.total)}`);
    refreshBiz();
  });
  onSubmit(document.getElementById('expForm'), async (d) => { await api('POST', `business/${b.id}/expense`, d); toast('Expense paid'); refreshBiz(); });
  body.onclick = (e) => {
    const p = e.target.closest('[data-payloan]');
    if (p) payLoan(loans.find((l) => l.id === +p.dataset.payloan), refreshBiz, 'business');
  };
}

// ----- Business info -----
function renderBizSettings(body) {
  const { business: b, members } = currentBiz;
  let logo = b.logo;
  body.innerHTML = `
    <div class="grid g2">
      <div class="card"><h3>Business info</h3>
        <form id="infoForm">
          <label>Business name</label><input name="name" required maxlength="60" value="${esc(b.name)}">
          <label>Slogan</label><input name="slogan" maxlength="120" value="${esc(b.slogan || '')}">
          <label>Description</label><textarea name="description" maxlength="1000">${esc(b.description || '')}</textarea>
          <label>Logo</label>
          <div class="row"><span id="lp">${logoHtml(b, 'lg')}</span><input type="file" accept="image/*" id="lf" style="max-width:280px"></div>
          <button class="btn primary" type="submit" style="margin-top:14px">Save changes</button>
        </form>
      </div>
      <div class="stack">
        <div class="card"><h3>Partners</h3>
          ${members.map((m) => `<div class="row between" style="padding:6px 0"><span>${esc(m.name)}</span><span class="pill info">${m.role}</span></div>`).join('')}
        </div>
        <div class="card"><h3>Partner code</h3><p class="small muted">Give this code to classmates so they can join this business.</p>
          <span class="code-box">${esc(b.join_code)}</span></div>
      </div>
    </div>`;
  document.getElementById('lf').onchange = async (e) => {
    try { logo = await readLogo(e.target.files[0]); document.getElementById('lp').innerHTML = `<img class="logo lg" src="${logo}" alt="">`; }
    catch (err) { toast(err.message, true); }
  };
  onSubmit(document.getElementById('infoForm'), async (d) => { await api('PUT', `business/${b.id}`, { ...d, logo }); toast('Saved'); refreshBiz(); });
}

// ---------------- Grants ----------------
function businessOptions() {
  return `<option value="">Just me (personal account)</option>` + me.businesses.filter((b) => b.status !== 'rejected' && b.status !== 'closed')
    .map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
}

function showGrants() {
  view.innerHTML = `
    <div class="grid g2" style="align-items:start">
      <div class="card"><h1>Grant Application</h1>
        <p class="muted">A grant is money you <b>do not</b> pay back. To earn one, explain how your business will make our class or community better.</p>
        <form id="grantForm">
          <label>Which business is this for?</label><select name="business_id">${businessOptions()}</select>
          <label>Project title</label><input name="title" required maxlength="100">
          <label>How will your business improve society?</label><textarea name="society_impact" required></textarea>
          <label>Who will it help, and how?</label><textarea name="who_helped" required></textarea>
          <label>How will you spend the grant money?</label><textarea name="spend_plan" required></textarea>
          <label>Amount requested ($)</label><input name="amount" required inputmode="decimal">
          <button class="btn primary lg" type="submit" style="margin-top:14px">Submit grant application</button>
        </form>
      </div>
      <div><h2>My grant applications</h2>${appList(me.grants, 'grant')}</div>
    </div>`;
  onSubmit(document.getElementById('grantForm'), async (d) => { await api('POST', 'grants', d); toast('Grant application sent!'); router(); });
}

function appList(list, type) {
  if (!list.length) return '<div class="card empty">No applications yet.</div>';
  return list.map((a) => `<div class="card">
    <div class="row between"><b>${type === 'grant' ? esc(a.title) : `Loan #${a.id}`}</b>${pill(a.status)}</div>
    <div class="small muted">${dateTime(a.created_at)}${a.business_name ? ' · ' + esc(a.business_name) : ''}</div>
    <div class="small" style="margin-top:6px">Requested <b class="money">${money(a.amount_requested)}</b>
      ${type === 'grant' && a.status === 'approved' ? ` · Awarded <b class="money pos">${money(a.amount_awarded)}</b>` : ''}
      ${type === 'loan' && (a.status === 'active' || a.status === 'paid') ? ` · Approved <b class="money">${money(a.amount_approved)}</b> at <b>${a.interest_rate}%</b> · Still owed <b class="money">${money(a.balance_owed)}</b>` : ''}</div>
    ${a.teacher_note ? `<div class="notice info small" style="margin-top:8px">Teacher: ${esc(a.teacher_note)}</div>` : ''}
    ${type === 'loan' && a.status === 'active' ? `<button class="btn sm primary" style="margin-top:10px" data-payloan="${a.id}">Make a payment</button>` : ''}
  </div>`).join('');
}

// ---------------- Loans ----------------
function showLoans() {
  view.innerHTML = `
    <div class="grid g2" style="align-items:start">
      <div class="card"><h1>Loan Application</h1>
        <p class="muted">A loan from the Bank must be paid back <b>with interest</b>. Your teacher decides if you are approved and sets the interest rate.</p>
        <form id="loanForm">
          <label>Which business is this for?</label><select name="business_id">${businessOptions()}</select>
          <label>Business description</label><textarea name="description" required placeholder="What does your business sell or do?"></textarea>
          <label>Business goals</label><textarea name="goals" required placeholder="What will this loan help you accomplish?"></textarea>
          <div class="grid g2">
            <div><label>Loan amount ($)</label><input name="amount" required inputmode="decimal"></div>
            <div><label>How much money do you plan to make? ($)</label><input name="projected_revenue" required inputmode="decimal"></div>
          </div>
          <label>How will you pay it back?</label><textarea name="repayment_plan" required></textarea>
          <button class="btn primary lg" type="submit" style="margin-top:14px">Submit loan application</button>
        </form>
      </div>
      <div><h2>My loans</h2><div id="loanList">${appList(me.loans, 'loan')}</div></div>
    </div>`;
  onSubmit(document.getElementById('loanForm'), async (d) => { await api('POST', 'loans', d); toast('Loan application sent!'); router(); });
  document.getElementById('loanList').addEventListener('click', (e) => {
    const p = e.target.closest('[data-payloan]');
    if (p) payLoan(me.loans.find((l) => l.id === +p.dataset.payloan), router);
  });
}

function payLoan(loan, after, defaultFrom = 'me') {
  modal(`<h2>Pay on Loan #${loan.id}</h2>
    <p>Still owed: <b class="money">${money(loan.balance_owed)}</b></p>
    <form><label>Payment amount ($)</label><input name="amount" required inputmode="decimal" value="${dollars(loan.balance_owed)}">
      <label>Pay from</label><select name="from"><option value="me" ${defaultFrom === 'me' ? 'selected' : ''}>My bank account</option>
        ${loan.business_id ? `<option value="business" ${defaultFrom === 'business' ? 'selected' : ''}>The business account</option>` : ''}</select>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Pay</button></div></form>`, {
    onOpen: (m, close) => onSubmit(m.querySelector('form'), async (d) => {
      const r = await api('POST', `loans/${loan.id}/pay`, d);
      close();
      toast(r.left > 0 ? `Paid ${money(r.paid)}. Still owed ${money(r.left)}.` : 'Loan paid off! 🎉');
      after();
    }),
  });
}

// ---------------- Class market ----------------
async function showDirectory() {
  const { businesses } = await api('GET', 'directory');
  view.innerHTML = `<div class="section-title" style="margin-top:0"><h1>Class Market</h1><span class="muted">Businesses open in our class and what they sell</span></div>
    ${businesses.length ? `<div class="grid g3">${businesses.map((b) => `<div class="card">
      <div class="row" style="flex-wrap:nowrap">${logoHtml(b)}<div><b>${esc(b.name)}</b><div class="small muted">${esc(b.slogan || '')}</div></div></div>
      <div style="margin-top:10px">${b.items.map((i) => `<div class="row between small" style="padding:4px 0;border-bottom:1px dashed var(--line)"><span>${esc(i.name)}</span><span class="money">${money(i.price)}</span></div>`).join('') || '<div class="small muted">No items yet</div>'}</div>
    </div>`).join('')}</div>` : '<div class="card empty">No businesses are open yet.</div>'}`;
}
