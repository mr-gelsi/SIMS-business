// Teacher back end
const { api, money, dollars, esc, dateTime, logoHtml, pill, kindLabel, toast, modal, onSubmit, bars, txTable, setRole, setToken, getToken } = SBG;
setRole('teacher');

const view = document.getElementById('view');
let data = null;
let tab = 'home';
let ledgerFilter = '';

const loginScreen = document.getElementById('loginScreen');
const appScreen = document.getElementById('appScreen');

onSubmit(document.getElementById('tLogin'), async (d) => {
  const r = await api('POST', 'teacher/login', d);
  setToken(r.token);
  start();
});
document.getElementById('logout').onclick = async () => {
  try { await api('POST', 'logout'); } catch {}
  setToken('');
  location.reload();
};
document.getElementById('nav').onclick = (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) go(b.dataset.tab);
};

function go(t) {
  tab = t;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  render();
  window.scrollTo(0, 0);
}

async function load() {
  data = await api('GET', 'teacher/overview');
  const pend = (l) => l.filter((x) => x.status === 'pending').length;
  const counts = { permits: pend(data.businesses), grants: pend(data.grants), loans: pend(data.loans) };
  document.querySelectorAll('#nav button').forEach((b) => {
    const base = b.textContent.replace(/\d+$/, '').trim();
    const c = counts[b.dataset.tab];
    b.innerHTML = esc(base) + (c ? `<span class="badge">${c}</span>` : '');
  });
}

async function refresh() { await load(); render(); }

async function start() {
  if (!getToken()) { loginScreen.classList.remove('hidden'); appScreen.classList.add('hidden'); return; }
  try {
    await load();
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    render();
  } catch (e) {
    loginScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
  }
}
start();

function render() {
  view.onclick = null;
  try {
    ({ home: renderHome, permits: renderPermits, grants: renderGrants, loans: renderLoans, money: renderMoney,
      students: renderStudents, ledger: renderLedger, settings: renderSettings })[tab]();
  } catch (e) { view.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}

const studentById = (id) => data.students.find((s) => s.id === id);

// ---------------- Overview ----------------
function renderHome() {
  const active = data.students.filter((s) => s.active);
  const studentTotal = active.reduce((a, s) => a + s.balance, 0);
  const approved = data.businesses.filter((b) => b.status === 'approved');
  const bizTotal = approved.reduce((a, b) => a + b.balance, 0);
  const owed = data.loans.filter((l) => l.status === 'active').reduce((a, l) => a + l.balance_owed, 0);
  const pend = (l) => l.filter((x) => x.status === 'pending');
  const queue = [
    ['permits', 'Business Permits', pend(data.businesses).length],
    ['grants', 'Grant applications', pend(data.grants).length],
    ['loans', 'Loan applications', pend(data.loans).length],
  ];
  view.innerHTML = `
    <h1>Overview</h1>
    <div class="grid g4">
      <div class="stat"><div class="label">Students</div><div class="value">${active.length}</div><div class="sub">${active.filter((s) => !s.has_pin).length} without a PIN</div></div>
      <div class="stat"><div class="label">In student accounts</div><div class="value">${money(studentTotal)}</div><div class="sub">avg ${money(active.length ? Math.round(studentTotal / active.length) : 0)}</div></div>
      <div class="stat"><div class="label">In business accounts</div><div class="value">${money(bizTotal)}</div><div class="sub">${approved.length} open businesses</div></div>
      <div class="stat"><div class="label">Loans owed to bank</div><div class="value">${money(owed)}</div><div class="sub">${data.loans.filter((l) => l.status === 'active').length} active loans</div></div>
    </div>
    <div class="section-title"><h2>Needs your review</h2></div>
    <div class="grid g3">${queue.map(([t, label, n]) => `<button class="stat" style="text-align:left;cursor:pointer;font:inherit" data-go="${t}">
      <div class="label">${label}</div><div class="value ${n ? '' : 'muted'}">${n}</div><div class="sub">${n ? 'waiting — click to review' : 'all caught up'}</div></button>`).join('')}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Top businesses by sales</h3>${bars(approved.sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((b) => ({ label: b.name, value: b.revenue })))}</div>
      <div class="card"><h3>Highest student balances</h3>${bars([...active].sort((a, b) => b.balance - a.balance).slice(0, 8).map((s) => ({ label: s.name, value: s.balance, color: '#c99a2e' })))}</div>
    </div>`;
  view.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
}

// ---------------- Permits ----------------
function renderPermits() {
  const groups = [['pending', 'Waiting for approval'], ['approved', 'Approved businesses'], ['rejected', 'Not approved'], ['closed', 'Closed']];
  view.innerHTML = `<h1>Business Permits</h1>` + groups.map(([st, title]) => {
    const list = data.businesses.filter((b) => b.status === st);
    if (!list.length && st !== 'pending') return '';
    return `<div class="section-title"><h2>${title} <span class="muted small">(${list.length})</span></h2></div>
      ${list.length ? list.map(permitCard).join('') : '<div class="card empty">No permit applications waiting.</div>'}`;
  }).join('');
  view.onclick = async (e) => {
    const b = e.target.closest('[data-decide]');
    if (b) {
      const card = b.closest('[data-biz]');
      const note = card.querySelector('[name=note]').value;
      try { await api('POST', `teacher/business/${card.dataset.biz}/decision`, { status: b.dataset.decide, note }); toast('Saved'); refresh(); }
      catch (err) { toast(err.message, true); }
    }
    const h = e.target.closest('[data-history]');
    if (h) { ledgerFilter = `business:${h.dataset.history}`; go('ledger'); }
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      const [bid, sid] = rm.dataset.rm.split(':');
      if (!confirmInline(rm)) return;
      try { await api('POST', `teacher/business/${bid}/remove-member`, { student_id: +sid }); toast('Removed'); refresh(); }
      catch (err) { toast(err.message, true); }
    }
  };
}
function confirmInline(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  const old = btn.textContent;
  btn.textContent = 'Click again to confirm';
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; }, 3000);
  return false;
}
function permitCard(b) {
  const members = (b.member_names || '').split(', ').filter(Boolean);
  return `<div class="card ${b.status === 'pending' ? 'app-card' : ''}" data-biz="${b.id}">
    <div class="biz-head">${logoHtml(b, 'lg')}
      <div class="grow"><h2 style="margin:0">${esc(b.name)}</h2><div class="muted">${esc(b.slogan || '')}</div>
        <div class="small" style="margin-top:4px">${pill(b.status)} Owner: <b>${esc(b.owner_name)}</b> · Code <b class="num">${esc(b.join_code)}</b> · Applied ${dateTime(b.created_at)}</div></div>
      <div style="text-align:right"><div class="small muted">Balance</div><div class="money" style="font-size:1.4rem;font-weight:700">${money(b.balance)}</div>
        <div class="small muted">Sales ${money(b.revenue)}</div></div>
    </div>
    <div class="grid g2" style="margin-top:12px">
      <div>${b.description ? `<dl class="qa"><dt>What the business does</dt><dd>${esc(b.description)}</dd></dl>` : ''}
        <dl class="qa"><dt>Partners (${b.member_count})</dt><dd>${members.map((n) => {
          const st = data.students.find((s) => s.name === n);
          return `${esc(n)}${st && st.id !== b.owner_id ? ` <button class="btn sm ghost" data-rm="${b.id}:${st.id}" title="Remove from business">✕</button>` : ''}`;
        }).join(' · ')}</dd></dl></div>
      <div><dl class="qa"><dt>Items for sale</dt></dl>
        ${b.items.length ? b.items.map((i) => `<div class="row between small" style="padding:3px 0;border-bottom:1px dashed var(--line)"><span><b>${esc(i.name)}</b> <span class="muted">${esc(i.description || '')}</span></span><span class="money">${money(i.price)}</span></div>`).join('') : '<div class="small muted">No items</div>'}
      </div>
    </div>
    <label>Note to students <span class="hint">(optional)</span></label>
    <input name="note" value="${esc(b.teacher_note || '')}" maxlength="500">
    <div class="row" style="margin-top:12px">
      ${b.status !== 'approved' ? `<button class="btn primary" data-decide="approved">✓ Approve permit</button>` : ''}
      ${b.status === 'pending' ? `<button class="btn danger" data-decide="rejected">Reject</button>` : ''}
      ${b.status === 'approved' ? `<button class="btn" data-decide="approved">Save note</button><button class="btn danger" data-decide="closed">Close business</button>` : ''}
      ${b.status === 'rejected' || b.status === 'closed' ? `<button class="btn" data-decide="pending">Move back to pending</button>` : ''}
      <span class="spacer" style="flex:1"></span>
      <button class="btn ghost sm" data-history="${b.id}">View transactions →</button>
    </div>
  </div>`;
}

// ---------------- Grants ----------------
function renderGrants() {
  const pending = data.grants.filter((g) => g.status === 'pending');
  const done = data.grants.filter((g) => g.status !== 'pending');
  view.innerHTML = `<h1>Grant Applications</h1>
    <div class="section-title"><h2>Waiting (${pending.length})</h2></div>
    ${pending.length ? pending.map((g) => `<div class="card app-card" data-grant="${g.id}">
      <div class="row between"><h2 style="margin:0">${esc(g.title)}</h2><span class="small muted">${dateTime(g.created_at)}</span></div>
      <div class="small">From <b>${esc(g.student_name)}</b>${g.business_name ? ` for <b>${esc(g.business_name)}</b>` : ' (personal)'} · Requested <b class="money">${money(g.amount_requested)}</b></div>
      <dl class="qa"><dt>How will the business improve society?</dt><dd>${esc(g.society_impact)}</dd>
        <dt>Who will it help?</dt><dd>${esc(g.who_helped)}</dd><dt>How will they spend it?</dt><dd>${esc(g.spend_plan)}</dd></dl>
      <div class="grid g3" style="align-items:end">
        <div><label>Award amount ($)</label><input name="amount" inputmode="decimal" value="${dollars(g.amount_requested)}"></div>
        <div style="grid-column:span 2"><label>Note to student</label><input name="note" maxlength="1000" placeholder="Great idea! …"></div>
      </div>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-g="approved">Approve & deposit</button><button class="btn danger" data-g="denied">Deny</button></div>
      <div class="small muted" style="margin-top:6px">Money goes into the business account if the business is approved, otherwise into the student's account.</div>
    </div>`).join('') : '<div class="card empty">No grant applications waiting.</div>'}
    <div class="section-title"><h2>Decided</h2></div>
    <div class="card">${done.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Student</th><th>Title</th><th>Status</th><th class="r">Requested</th><th class="r">Awarded</th></tr></thead><tbody>
      ${done.map((g) => `<tr><td class="small">${dateTime(g.created_at)}</td><td>${esc(g.student_name)}${g.business_name ? `<div class="small muted">${esc(g.business_name)}</div>` : ''}</td>
        <td><a href="#" data-view-grant="${g.id}">${esc(g.title)}</a></td><td>${pill(g.status)}</td><td class="r money">${money(g.amount_requested)}</td><td class="r money">${money(g.amount_awarded)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">None yet.</div>'}</div>`;
  view.onclick = async (e) => {
    const b = e.target.closest('[data-g]');
    if (b) {
      const card = b.closest('[data-grant]');
      b.disabled = true;
      try {
        await api('POST', `teacher/grants/${card.dataset.grant}/decision`, { status: b.dataset.g, amount: card.querySelector('[name=amount]').value, note: card.querySelector('[name=note]').value });
        toast(b.dataset.g === 'approved' ? 'Grant approved and deposited' : 'Grant denied'); refresh();
      } catch (err) { toast(err.message, true); b.disabled = false; }
    }
    const v = e.target.closest('[data-view-grant]');
    if (v) {
      e.preventDefault();
      const g = data.grants.find((x) => x.id === +v.dataset.viewGrant);
      modal(`<h2>${esc(g.title)}</h2><div class="small">${esc(g.student_name)} · ${pill(g.status)}</div>
        <dl class="qa"><dt>Improve society</dt><dd>${esc(g.society_impact)}</dd><dt>Who it helps</dt><dd>${esc(g.who_helped)}</dd><dt>Spend plan</dt><dd>${esc(g.spend_plan)}</dd>
        ${g.teacher_note ? `<dt>Your note</dt><dd>${esc(g.teacher_note)}</dd>` : ''}</dl><div class="actions"><button class="btn" data-close>Close</button></div>`);
    }
  };
}

// ---------------- Loans ----------------
function renderLoans() {
  const pending = data.loans.filter((l) => l.status === 'pending');
  const active = data.loans.filter((l) => l.status === 'active');
  const done = data.loans.filter((l) => !['pending', 'active'].includes(l.status));
  view.innerHTML = `<h1>Bank Loans</h1>
    <div class="section-title"><h2>Applications waiting (${pending.length})</h2></div>
    ${pending.length ? pending.map((l) => `<div class="card app-card" data-loan="${l.id}">
      <div class="row between"><h2 style="margin:0">Loan #${l.id} — ${money(l.amount_requested)}</h2><span class="small muted">${dateTime(l.created_at)}</span></div>
      <div class="small">From <b>${esc(l.student_name)}</b>${l.business_name ? ` for <b>${esc(l.business_name)}</b>` : ' (personal)'}
        · Plans to make <b class="money">${money(l.projected_revenue)}</b></div>
      <dl class="qa"><dt>Business description</dt><dd>${esc(l.description)}</dd><dt>Goals</dt><dd>${esc(l.goals)}</dd><dt>Repayment plan</dt><dd>${esc(l.repayment_plan)}</dd></dl>
      <div class="grid g4" style="align-items:end">
        <div><label>Loan amount ($)</label><input name="amount" inputmode="decimal" value="${dollars(l.amount_requested)}"></div>
        <div><label>Interest rate (%)</label><input name="rate" inputmode="decimal" value="10"></div>
        <div style="grid-column:span 2"><label>Note to student</label><input name="note" maxlength="1000"></div>
      </div>
      <div class="small muted" style="margin-top:6px" data-preview></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-l="approved">Approve & deposit</button><button class="btn danger" data-l="denied">Deny</button></div>
    </div>`).join('') : '<div class="card empty">No loan applications waiting.</div>'}
    <div class="section-title"><h2>Active loans (${active.length})</h2></div>
    <div class="card">${active.length ? `<div class="table-wrap"><table><thead><tr><th>Loan</th><th>Borrower</th><th class="r">Lent</th><th class="r">Rate</th><th class="r">Still owed</th><th></th></tr></thead><tbody>
      ${active.map((l) => `<tr><td>#${l.id}<div class="small muted">${dateTime(l.decided_at || l.created_at)}</div></td><td>${esc(l.student_name)}${l.business_name ? `<div class="small muted">${esc(l.business_name)}</div>` : ''}</td>
        <td class="r money">${money(l.amount_approved)}</td><td class="r">${l.interest_rate}%</td><td class="r money"><b>${money(l.balance_owed)}</b></td>
        <td class="r"><button class="btn sm" data-adjust="${l.id}">Interest / adjust</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No active loans.</div>'}</div>
    <div class="section-title"><h2>Closed</h2></div>
    <div class="card">${done.length ? `<div class="table-wrap"><table><thead><tr><th>Loan</th><th>Borrower</th><th>Status</th><th class="r">Requested</th><th class="r">Lent</th></tr></thead><tbody>
      ${done.map((l) => `<tr><td>#${l.id}</td><td>${esc(l.student_name)}</td><td>${pill(l.status)}</td><td class="r money">${money(l.amount_requested)}</td><td class="r money">${money(l.amount_approved)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">None yet.</div>'}</div>`;
  const preview = (card) => {
    const a = Number(card.querySelector('[name=amount]').value) || 0, r = Number(card.querySelector('[name=rate]').value) || 0;
    card.querySelector('[data-preview]').textContent = `They will owe ${money(Math.round(a * (1 + r / 100) * 100))} in total (${money(Math.round(a * r))} interest).`;
  };
  view.querySelectorAll('[data-loan]').forEach((c) => { preview(c); c.oninput = () => preview(c); });
  view.onclick = async (e) => {
    const b = e.target.closest('[data-l]');
    if (b) {
      const card = b.closest('[data-loan]');
      b.disabled = true;
      try {
        await api('POST', `teacher/loans/${card.dataset.loan}/decision`, { status: b.dataset.l, amount: card.querySelector('[name=amount]').value, rate: card.querySelector('[name=rate]').value, note: card.querySelector('[name=note]').value });
        toast(b.dataset.l === 'approved' ? 'Loan approved and deposited' : 'Loan denied'); refresh();
      } catch (err) { toast(err.message, true); b.disabled = false; }
    }
    const adj = e.target.closest('[data-adjust]');
    if (adj) adjustLoan(data.loans.find((l) => l.id === +adj.dataset.adjust));
  };
}
function adjustLoan(l) {
  modal(`<h2>Loan #${l.id} · ${esc(l.student_name)}</h2>
    <p>Still owed: <b class="money">${money(l.balance_owed)}</b> · Rate ${l.interest_rate}%</p>
    <h3>Charge interest</h3><p class="small muted">Adds the rate to what is still owed (for example, once a week).</p>
    <form id="fi" class="row" style="align-items:flex-end"><div><label>Rate (%)</label><input name="rate" value="${l.interest_rate}" inputmode="decimal" style="max-width:120px"></div>
      <button class="btn primary" type="submit">Add interest</button></form>
    <h3 style="margin-top:18px">Set amount owed</h3>
    <form id="fs" class="row" style="align-items:flex-end"><div><label>Amount owed ($)</label><input name="amount" value="${dollars(l.balance_owed)}" inputmode="decimal" style="max-width:140px"></div>
      <button class="btn" type="submit">Set</button><button class="btn danger" type="button" id="forgive">Forgive loan</button></form>
    <div class="actions"><button class="btn" data-close>Close</button></div>`, {
    onOpen: (m, close) => {
      const done = (msg) => { close(); toast(msg); refresh(); };
      onSubmit(m.querySelector('#fi'), async (d) => { const r = await api('POST', `teacher/loans/${l.id}/adjust`, { action: 'interest', rate: d.rate }); done(`Now owes ${money(r.balance_owed)}`); });
      onSubmit(m.querySelector('#fs'), async (d) => { const r = await api('POST', `teacher/loans/${l.id}/adjust`, { action: 'set', amount: d.amount }); done(`Now owes ${money(r.balance_owed)}`); });
      m.querySelector('#forgive').onclick = async (e) => {
        if (!confirmInline(e.target)) return;
        try { await api('POST', `teacher/loans/${l.id}/adjust`, { action: 'forgive' }); done('Loan forgiven'); } catch (err) { toast(err.message, true); }
      };
    },
  });
}

// ---------------- Award / Charge ----------------
function targetPicker(id) {
  const students = data.students.filter((s) => s.active);
  const periods = [...new Set(students.map((s) => s.period || ''))];
  const biz = data.businesses.filter((b) => b.status === 'approved');
  return `<div class="picker" id="${id}">
    <label class="check"><input type="checkbox" value="all_students"> <b>All students</b> (${students.length})</label>
    <label class="check"><input type="checkbox" value="all_businesses"> <b>All open businesses</b> (${biz.length})</label>
    ${periods.map((p) => `<h4>${p ? 'Period ' + esc(p) : 'Students'} <a href="#" data-period="${esc(p)}" class="small" style="text-transform:none;letter-spacing:0">select all</a></h4>
      ${students.filter((s) => (s.period || '') === p).map((s) => `<label class="check"><input type="checkbox" value="student:${s.id}" data-p="${esc(p)}"> ${esc(s.name)} <span class="small muted money">${money(s.balance)}</span></label>`).join('')}`).join('')}
    ${biz.length ? `<h4>Businesses</h4>${biz.map((b) => `<label class="check"><input type="checkbox" value="business:${b.id}"> ${esc(b.name)} <span class="small muted money">${money(b.balance)}</span></label>`).join('')}` : ''}
  </div>`;
}
function pickedTargets(id) {
  const box = document.getElementById(id);
  return [...box.querySelectorAll('input:checked')].map((i) => {
    if (i.value.startsWith('all_')) return i.value;
    const [type, tid] = i.value.split(':');
    return { type, id: +tid };
  });
}
function wirePicker(id) {
  document.getElementById(id).addEventListener('click', (e) => {
    const a = e.target.closest('[data-period]');
    if (!a) return;
    e.preventDefault();
    const boxes = [...document.getElementById(id).querySelectorAll(`input[data-p="${CSS.escape(a.dataset.period)}"]`)];
    const on = !boxes.every((b) => b.checked);
    boxes.forEach((b) => (b.checked = on));
  });
}

function renderMoney() {
  view.innerHTML = `<h1>Award or Charge Money</h1>
    <div class="grid g2" style="align-items:start">
      <div class="card"><h2>💰 Award money</h2><p class="small muted">Pay students or businesses from the Bank — for jobs, good work, prizes, etc.</p>
        <form id="awardForm">
          <div class="grid g2"><div><label>Amount ($)</label><input name="amount" required inputmode="decimal"></div>
            <div><label>Reason</label><input name="memo" maxlength="200" placeholder="Paycheck"></div></div>
          <label>Who gets it?</label>${targetPicker('awardPick')}
          <button class="btn primary" type="submit" style="margin-top:12px">Award money</button>
        </form>
      </div>
      <div class="card"><h2>🏛️ Charge taxes or fees</h2><p class="small muted">Take money from students or businesses. Charges can make a balance go below $0.</p>
        <form id="chargeForm">
          <div class="grid g2">
            <div><label>Type</label><select name="kind"><option value="tax">Tax</option><option value="fee">Fee</option></select></div>
            <div><label>How much?</label><select name="mode"><option value="flat">Flat amount ($)</option><option value="percent">Percent of balance (%)</option></select></div>
            <div><label id="amtLabel">Amount ($)</label><input name="value" required inputmode="decimal"></div>
            <div><label>Reason</label><input name="memo" maxlength="200" placeholder="Property tax"></div>
          </div>
          <label>Who pays?</label>${targetPicker('chargePick')}
          <button class="btn danger" type="submit" style="margin-top:12px">Charge</button>
        </form>
      </div>
    </div>`;
  wirePicker('awardPick'); wirePicker('chargePick');
  const cf = document.getElementById('chargeForm');
  cf.mode.onchange = () => (document.getElementById('amtLabel').textContent = cf.mode.value === 'percent' ? 'Percent (%)' : 'Amount ($)');
  onSubmit(document.getElementById('awardForm'), async (d) => {
    const r = await api('POST', 'teacher/award', { amount: d.amount, memo: d.memo, targets: pickedTargets('awardPick') });
    toast(`Awarded ${money(Math.round(d.amount * 100))} to ${r.count} account${r.count === 1 ? '' : 's'}`); refresh();
  });
  onSubmit(cf, async (d) => {
    const body = { kind: d.kind, mode: d.mode, memo: d.memo, targets: pickedTargets('chargePick') };
    if (d.mode === 'percent') body.percent = d.value; else body.amount = d.value;
    const r = await api('POST', 'teacher/charge', body);
    toast(`Charged ${r.count} account${r.count === 1 ? '' : 's'} — ${money(r.total)} total`); refresh();
  });
}

// ---------------- Students ----------------
function renderStudents() {
  const now = Date.now();
  view.innerHTML = `<div class="section-title" style="margin-top:0"><h1>Students</h1><button class="btn" id="addRoster">＋ Add students from a roster</button></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Period</th><th>PIN</th><th class="r">Balance</th><th></th></tr></thead><tbody>
      ${data.students.map((s) => `<tr style="${s.active ? '' : 'opacity:.5'}"><td><b>${esc(s.name)}</b>${s.active ? '' : ' <span class="pill closed">off</span>'}</td>
        <td class="num small">${esc(s.username)}</td><td>${esc(s.period || '')}</td>
        <td>${s.pin_locked_until > now ? '<span class="pill denied">locked</span>' : s.has_pin ? '<span class="pill approved">set</span>' : '<span class="pill pending">none</span>'}</td>
        <td class="r money ${s.balance < 0 ? 'neg' : ''}">${money(s.balance)}</td>
        <td class="r"><button class="btn sm" data-manage="${s.id}">Manage</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No students yet. Students sign up with your class code, or add them from a roster.</td></tr>'}
    </tbody></table></div></div>`;
  document.getElementById('addRoster').onclick = () => modal(`<h2>Add students</h2>
    <p class="small muted">One student per line: <b>Name, username, password, period</b><br>You can paste straight from a spreadsheet (tabs work too).</p>
    <form><textarea name="roster" style="min-height:200px;font-family:var(--mono);font-size:.85rem" placeholder="Maria Lopez, mlopez, sun42, 3&#10;Jay Kim, jkim, tiger7, 3"></textarea>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Add students</button></div></form>`, {
    onOpen: (m, close) => onSubmit(m.querySelector('form'), async (d) => {
      const r = await api('POST', 'teacher/students', d);
      close();
      if (r.errors.length) modal(`<h2>Added ${r.created} student(s)</h2><p>These lines were skipped:</p><ul class="small">${r.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><div class="actions"><button class="btn" data-close>OK</button></div>`);
      else toast(`Added ${r.created} student(s)`);
      refresh();
    }),
  });
  view.onclick = (e) => {
    const b = e.target.closest('[data-manage]');
    if (b) manageStudent(studentById(+b.dataset.manage));
  };
}

function manageStudent(s) {
  modal(`<h2>${esc(s.name)}</h2>
    <div class="small muted">@${esc(s.username)} · Balance <b class="money">${money(s.balance)}</b></div>
    <h3 style="margin-top:16px">Quick money</h3>
    <form id="qm" class="row" style="align-items:flex-end">
      <div><label>Amount ($)</label><input name="amount" inputmode="decimal" required style="max-width:110px"></div>
      <div style="flex:1"><label>Reason</label><input name="memo" maxlength="200"></div>
      <button class="btn primary" type="submit" data-kind="award">Award</button>
      <button class="btn" type="button" id="qfee">Fee</button><button class="btn" type="button" id="qtax">Tax</button>
    </form>
    <h3 style="margin-top:18px">Account</h3>
    <form id="ed" class="row" style="align-items:flex-end">
      <div style="flex:2"><label>Name</label><input name="name" value="${esc(s.name)}" required></div>
      <div style="flex:1"><label>Period</label><input name="period" value="${esc(s.period || '')}"></div>
      <button class="btn" type="submit">Save</button></form>
    <form id="pw" class="row" style="align-items:flex-end">
      <div style="flex:1"><label>New password</label><input name="password" minlength="4" required></div>
      <button class="btn" type="submit">Set password</button></form>
    <div class="row" style="margin-top:14px">
      <button class="btn" id="rpin">Reset PIN</button>
      <button class="btn" id="upin">Unlock PIN</button>
      <button class="btn" id="hist">View transactions</button>
      <button class="btn ${s.active ? 'danger' : ''}" id="act">${s.active ? 'Turn off account' : 'Turn on account'}</button>
    </div>
    <div class="actions"><button class="btn" data-close>Close</button></div>`, {
    onOpen: (m, close) => {
      const act = async (body, msg) => { try { await api('POST', `teacher/student/${s.id}`, body); toast(msg); close(); refresh(); } catch (err) { toast(err.message, true); } };
      const qm = m.querySelector('#qm');
      onSubmit(qm, async (d) => { await api('POST', 'teacher/award', { amount: d.amount, memo: d.memo, targets: [{ type: 'student', id: s.id }] }); toast('Awarded'); close(); refresh(); });
      const charge = async (kind) => {
        if (!qm.reportValidity()) return;
        try { await api('POST', 'teacher/charge', { kind, mode: 'flat', amount: qm.amount.value, memo: qm.memo.value, targets: [{ type: 'student', id: s.id }] }); toast(`${kind === 'tax' ? 'Tax' : 'Fee'} charged`); close(); refresh(); }
        catch (err) { toast(err.message, true); }
      };
      m.querySelector('#qfee').onclick = () => charge('fee');
      m.querySelector('#qtax').onclick = () => charge('tax');
      onSubmit(m.querySelector('#ed'), (d) => act({ action: 'edit', ...d }, 'Saved'));
      onSubmit(m.querySelector('#pw'), (d) => act({ action: 'password', password: d.password }, 'Password changed'));
      m.querySelector('#rpin').onclick = () => act({ action: 'reset_pin' }, 'PIN cleared — the student can make a new one');
      m.querySelector('#upin').onclick = () => act({ action: 'unlock_pin' }, 'PIN unlocked');
      m.querySelector('#act').onclick = () => act({ action: s.active ? 'deactivate' : 'activate' }, 'Saved');
      m.querySelector('#hist').onclick = () => { close(); ledgerFilter = `student:${s.id}`; go('ledger'); };
    },
  });
}

// ---------------- Ledger ----------------
async function renderLedger() {
  view.innerHTML = `<div class="section-title" style="margin-top:0"><h1>Transactions</h1>
    <select id="lf" style="max-width:320px"><option value="">All accounts (latest 300)</option>
      <optgroup label="Students">${data.students.map((s) => `<option value="student:${s.id}">${esc(s.name)}</option>`).join('')}</optgroup>
      <optgroup label="Businesses">${data.businesses.map((b) => `<option value="business:${b.id}">${esc(b.name)}</option>`).join('')}</optgroup>
    </select></div>
    <p class="small muted">Refunding sends the money back where it came from. Refunding a sale removes it from the business's top sellers. Refunding a loan payment adds it back to what is owed.</p>
    <div class="card" id="ledgerBody"><div class="empty">Loading…</div></div>`;
  const sel = document.getElementById('lf');
  sel.value = ledgerFilter;
  const loadLedger = async () => {
    ledgerFilter = sel.value;
    const [type, id] = ledgerFilter.split(':');
    const r = await api('GET', 'teacher/transactions' + (type ? `?type=${type}&id=${id}&limit=1000` : ''));
    document.getElementById('ledgerBody').innerHTML = txTable(r.transactions, { refund: true });
  };
  sel.onchange = loadLedger;
  view.onclick = (e) => {
    const b = e.target.closest('[data-refund]');
    if (!b) return;
    modal(`<h2>Refund transaction #${b.dataset.refund}?</h2><p>The money will go back to where it came from.</p>
      <form><label>Note <span class="hint">(optional)</span></label><input name="memo" maxlength="200">
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn danger" type="submit">Refund</button></div></form>`, {
      onOpen: (m, close) => onSubmit(m.querySelector('form'), async (d) => {
        await api('POST', `teacher/refund/${b.dataset.refund}`, d);
        close(); toast('Refunded'); await loadLedger(); try { await load(); } catch {}
      }),
    });
  };
  try { await loadLedger(); } catch (err) { toast(err.message, true); }
}

// ---------------- Settings ----------------
function renderSettings() {
  const s = data.settings;
  view.innerHTML = `<h1>Settings</h1>
    <div class="card" style="max-width:640px"><form id="sf">
      <label>Bank name <span class="hint">(shown to students)</span></label><input name="bank_name" value="${esc(s.bank_name)}" maxlength="40">
      <label>Class code <span class="hint">(students need this to sign up)</span></label><input name="class_code" value="${esc(s.class_code)}" maxlength="30" style="text-transform:uppercase">
      <label>Starting balance for new students ($)</label><input name="starting_balance" value="${dollars(s.starting_balance)}" inputmode="decimal">
      <label class="check" style="margin-top:14px"><input type="checkbox" name="allow_signup" ${s.allow_signup === '1' ? 'checked' : ''}> Let students create their own accounts</label>
      <button class="btn primary" type="submit" style="margin-top:14px">Save settings</button>
    </form></div>
    <div class="card" style="max-width:640px"><h3>Student link</h3><p class="small">Students go to <b class="num">${esc(location.origin)}/</b> and choose <b>New account</b>.</p></div>`;
  onSubmit(document.getElementById('sf'), async (d) => {
    await api('POST', 'teacher/settings', { ...d, allow_signup: !!d.allow_signup });
    toast('Settings saved'); refresh();
  });
}
