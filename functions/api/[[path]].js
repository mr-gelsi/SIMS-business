// Student Business Game — API (Cloudflare Pages Function)
// Needs: a D1 database bound as "DB" and an environment variable "TEACHER_PASSWORD".
// All money is stored in cents.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, period TEXT DEFAULT '', pass_hash TEXT NOT NULL, pin_hash TEXT, balance INTEGER NOT NULL DEFAULT 0, pin_fails INTEGER NOT NULL DEFAULT 0, pin_locked_until INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, student_id INTEGER, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS businesses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slogan TEXT DEFAULT '', description TEXT DEFAULT '', logo TEXT DEFAULT '', join_code TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending', balance INTEGER NOT NULL DEFAULT 0, owner_id INTEGER NOT NULL, teacher_note TEXT DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS business_members (business_id INTEGER NOT NULL, student_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'partner', joined_at INTEGER NOT NULL, PRIMARY KEY (business_id, student_id));
CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', price INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, kind TEXT NOT NULL, from_type TEXT NOT NULL, from_id INTEGER, to_type TEXT NOT NULL, to_id INTEGER, amount INTEGER NOT NULL, memo TEXT DEFAULT '', ref_id INTEGER, refunded INTEGER NOT NULL DEFAULT 0, actor TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS tx_from ON transactions(from_type, from_id);
CREATE INDEX IF NOT EXISTS tx_to ON transactions(to_type, to_id);
CREATE TABLE IF NOT EXISTS sale_items (transaction_id INTEGER NOT NULL, item_id INTEGER, business_id INTEGER NOT NULL, name TEXT NOT NULL, qty INTEGER NOT NULL, price INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sale_items_biz ON sale_items(business_id);
CREATE TABLE IF NOT EXISTS grants (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, business_id INTEGER, amount_requested INTEGER NOT NULL, title TEXT DEFAULT '', society_impact TEXT NOT NULL, who_helped TEXT DEFAULT '', spend_plan TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', amount_awarded INTEGER NOT NULL DEFAULT 0, teacher_note TEXT DEFAULT '', created_at INTEGER NOT NULL, decided_at INTEGER);
CREATE TABLE IF NOT EXISTS loans (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, business_id INTEGER, amount_requested INTEGER NOT NULL, description TEXT NOT NULL, goals TEXT NOT NULL, projected_revenue INTEGER NOT NULL DEFAULT 0, repayment_plan TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', amount_approved INTEGER NOT NULL DEFAULT 0, interest_rate REAL NOT NULL DEFAULT 0, balance_owed INTEGER NOT NULL DEFAULT 0, teacher_note TEXT DEFAULT '', created_at INTEGER NOT NULL, decided_at INTEGER);
`;

const DEFAULT_SETTINGS = {
  class_code: 'BUSINESS',
  starting_balance: '10000', // cents ($100.00)
  allow_signup: '1',
  bank_name: 'Class Bank',
};

let schemaReady = false;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };
const now = () => Date.now();
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

// ---------- helpers ----------
function str(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}
function req(v, label, max = 2000) {
  const s = str(v, max);
  if (!s) fail(400, `${label} is required.`);
  return s;
}
function toCents(v, label = 'Amount', { allowZero = false } = {}) {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) fail(400, `${label} must be a number.`);
  const c = Math.round(n * 100);
  if (c < 0 || (!allowZero && c === 0)) fail(400, `${label} must be more than $0.`);
  if (c > 100000000) fail(400, `${label} is too large.`);
  return c;
}
const money = (c) => (c < 0 ? '-$' : '$') + (Math.abs(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function randomToken(bytes = 24) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomCode(len = 6) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return [...a].map((b) => alphabet[b % alphabet.length]).join('');
}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function hashSecret(secret, salt, iterations = 50000) {
  salt = salt || randomToken(16);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations }, key, 256);
  return `${iterations}$${salt}$${b64(bits)}`;
}
async function verifySecret(secret, stored) {
  if (!stored) return false;
  const [it, salt] = stored.split('$');
  const again = await hashSecret(secret, salt, Number(it));
  return again === stored;
}

async function ensureSchema(db) {
  if (schemaReady) return;
  const stmts = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s));
  await db.batch(stmts);
  schemaReady = true;
}

async function getSettings(db) {
  const rows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

async function getSession(request, db) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const s = await db.prepare('SELECT * FROM sessions WHERE token = ? AND expires > ?').bind(token, now()).first();
  if (!s) return null;
  if (s.role === 'student') {
    const st = await db.prepare('SELECT * FROM students WHERE id = ? AND active = 1').bind(s.student_id).first();
    if (!st) return null;
    s.student = st;
  }
  return s;
}
function needStudent(session) {
  if (!session || session.role !== 'student') fail(401, 'Please log in.');
  return session.student;
}
function needTeacher(session) {
  if (!session || session.role !== 'teacher') fail(401, 'Teacher login required.');
}

async function isMember(db, businessId, studentId) {
  return !!(await db.prepare('SELECT 1 AS x FROM business_members WHERE business_id = ? AND student_id = ?')
    .bind(businessId, studentId).first());
}

const TABLE = { student: 'students', business: 'businesses' };
const KIND_NAMES = { award: 'award', purchase: 'purchase', payout: 'owner payout', tax: 'tax', fee: 'fee', grant: 'grant', loan: 'loan', loan_payment: 'loan payment', expense: 'business expense' };

// Moves money between accounts and records it. "bank" is the teacher's unlimited account.
async function move(db, { kind, from, to, amount, memo = '', ref = null, allowNegative = false, actor = '' }) {
  if (!Number.isInteger(amount) || amount <= 0) fail(400, 'Amount must be more than $0.');
  const [fType, fId] = from;
  const [tType, tId] = to;
  if (fType !== 'bank') {
    const sql = allowNegative
      ? `UPDATE ${TABLE[fType]} SET balance = balance - ? WHERE id = ?`
      : `UPDATE ${TABLE[fType]} SET balance = balance - ? WHERE id = ? AND balance >= ?`;
    const stmt = allowNegative ? db.prepare(sql).bind(amount, fId) : db.prepare(sql).bind(amount, fId, amount);
    const r = await stmt.run();
    if (!r.meta || !r.meta.changes) fail(400, fType === 'student' ? 'Not enough money in that bank account.' : 'Not enough money in the business account.');
  }
  const stmts = [];
  if (tType !== 'bank') stmts.push(db.prepare(`UPDATE ${TABLE[tType]} SET balance = balance + ? WHERE id = ?`).bind(amount, tId));
  stmts.push(db.prepare(`INSERT INTO transactions (created_at, kind, from_type, from_id, to_type, to_id, amount, memo, ref_id, actor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(now(), kind, fType, fId ?? null, tType, tId ?? null, amount, str(memo, 300), ref, actor));
  const results = await db.batch(stmts);
  return results[results.length - 1].meta.last_row_id;
}

const TX_SELECT = `
SELECT t.*,
  CASE t.from_type WHEN 'student' THEN fs.name WHEN 'business' THEN fb.name ELSE 'Bank' END AS from_name,
  CASE t.to_type WHEN 'student' THEN ts.name WHEN 'business' THEN tb.name ELSE 'Bank' END AS to_name
FROM transactions t
LEFT JOIN students fs ON t.from_type = 'student' AND fs.id = t.from_id
LEFT JOIN businesses fb ON t.from_type = 'business' AND fb.id = t.from_id
LEFT JOIN students ts ON t.to_type = 'student' AND ts.id = t.to_id
LEFT JOIN businesses tb ON t.to_type = 'business' AND tb.id = t.to_id`;

async function accountTx(db, type, id, limit = 500) {
  return (await db.prepare(`${TX_SELECT} WHERE (t.from_type = ?1 AND t.from_id = ?2) OR (t.to_type = ?1 AND t.to_id = ?2)
    ORDER BY t.id DESC LIMIT ?3`).bind(type, id, limit).all()).results || [];
}

function publicStudent(s) {
  return { id: s.id, name: s.name, username: s.username, period: s.period, balance: s.balance, has_pin: !!s.pin_hash };
}

async function businessDetail(db, id) {
  const b = await db.prepare('SELECT * FROM businesses WHERE id = ?').bind(id).first();
  if (!b) fail(404, 'Business not found.');
  const members = (await db.prepare(`SELECT s.id, s.name, s.period, m.role FROM business_members m JOIN students s ON s.id = m.student_id
    WHERE m.business_id = ? ORDER BY m.role DESC, s.name`).bind(id).all()).results || [];
  const items = (await db.prepare('SELECT * FROM items WHERE business_id = ? AND active = 1 ORDER BY name').bind(id).all()).results || [];
  const top = (await db.prepare(`SELECT si.name, SUM(si.qty) AS qty, SUM(si.qty * si.price) AS revenue
    FROM sale_items si JOIN transactions t ON t.id = si.transaction_id
    WHERE si.business_id = ? AND t.refunded = 0 GROUP BY si.name ORDER BY qty DESC, revenue DESC LIMIT 10`).bind(id).all()).results || [];
  const tx = await accountTx(db, 'business', id, 500);
  const loans = (await db.prepare(`SELECT l.*, s.name AS student_name FROM loans l JOIN students s ON s.id = l.student_id
    WHERE l.business_id = ? ORDER BY l.id DESC`).bind(id).all()).results || [];
  const grants = (await db.prepare(`SELECT g.*, s.name AS student_name FROM grants g JOIN students s ON s.id = g.student_id
    WHERE g.business_id = ? ORDER BY g.id DESC`).bind(id).all()).results || [];
  return { business: b, members, items, top_items: top, transactions: tx, loans, grants };
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

// ----- public / auth -----
route('GET', 'info', async ({ db }) => {
  const s = await getSettings(db);
  return { bank_name: s.bank_name, allow_signup: s.allow_signup === '1' };
});

route('POST', 'register', async ({ db, body }) => {
  const s = await getSettings(db);
  if (s.allow_signup !== '1') fail(403, 'Sign-ups are closed. Ask your teacher.');
  if (str(body.class_code).toUpperCase() !== String(s.class_code).toUpperCase()) fail(400, 'That class code is not right.');
  const name = req(body.name, 'Your name', 60);
  const username = req(body.username, 'Username', 30).toLowerCase();
  if (!/^[a-z0-9._-]{2,30}$/.test(username)) fail(400, 'Username must be 2–30 letters or numbers (no spaces).');
  const password = String(body.password || '');
  if (password.length < 4) fail(400, 'Password must be at least 4 characters.');
  const exists = await db.prepare('SELECT id FROM students WHERE username = ?').bind(username).first();
  if (exists) fail(400, 'That username is taken. Try another.');
  const r = await db.prepare('INSERT INTO students (name, username, period, pass_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(name, username, str(body.period, 20), await hashSecret(password), now()).run();
  const id = r.meta.last_row_id;
  const start = parseInt(s.starting_balance, 10) || 0;
  if (start > 0) await move(db, { kind: 'award', from: ['bank'], to: ['student', id], amount: start, memo: 'Starting balance', actor: 'system' });
  const token = randomToken();
  await db.prepare('INSERT INTO sessions (token, role, student_id, expires) VALUES (?, ?, ?, ?)').bind(token, 'student', id, now() + 7 * 864e5).run();
  return { token };
});

route('POST', 'login', async ({ db, body }) => {
  const username = str(body.username, 30).toLowerCase();
  const st = await db.prepare('SELECT * FROM students WHERE username = ?').bind(username).first();
  if (!st || !(await verifySecret(String(body.password || ''), st.pass_hash))) fail(400, 'Username or password is not right.');
  if (!st.active) fail(403, 'This account is turned off. Ask your teacher.');
  const token = randomToken();
  await db.prepare('INSERT INTO sessions (token, role, student_id, expires) VALUES (?, ?, ?, ?)').bind(token, 'student', st.id, now() + 7 * 864e5).run();
  return { token };
});

route('POST', 'teacher/login', async ({ db, env, body }) => {
  const real = env.TEACHER_PASSWORD;
  if (!real) fail(500, 'The teacher password has not been set up in Cloudflare yet (TEACHER_PASSWORD).');
  if (String(body.password || '') !== String(real)) fail(400, 'Wrong teacher password.');
  const token = randomToken();
  await db.prepare('INSERT INTO sessions (token, role, student_id, expires) VALUES (?, ?, NULL, ?)').bind(token, 'teacher', now() + 12 * 36e5).run();
  await db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now()).run();
  return { token };
});

route('POST', 'logout', async ({ db, request }) => {
  const h = request.headers.get('authorization') || '';
  if (h.startsWith('Bearer ')) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(h.slice(7)).run();
  return { ok: true };
});

// ----- student -----
route('GET', 'me', async ({ db, session }) => {
  const st = needStudent(session);
  const businesses = (await db.prepare(`SELECT b.id, b.name, b.slogan, b.logo, b.status, b.balance, b.join_code, b.teacher_note, m.role
    FROM business_members m JOIN businesses b ON b.id = m.business_id WHERE m.student_id = ? ORDER BY b.name`).bind(st.id).all()).results || [];
  const tx = await accountTx(db, 'student', st.id, 500);
  const grants = (await db.prepare(`SELECT g.*, b.name AS business_name FROM grants g LEFT JOIN businesses b ON b.id = g.business_id
    WHERE g.student_id = ? ORDER BY g.id DESC`).bind(st.id).all()).results || [];
  const loans = (await db.prepare(`SELECT l.*, b.name AS business_name FROM loans l LEFT JOIN businesses b ON b.id = l.business_id
    WHERE l.student_id = ? OR l.business_id IN (SELECT business_id FROM business_members WHERE student_id = ?) ORDER BY l.id DESC`)
    .bind(st.id, st.id).all()).results || [];
  const s = await getSettings(db);
  return { student: publicStudent(st), businesses, transactions: tx, grants, loans, bank_name: s.bank_name };
});

route('POST', 'pin', async ({ db, session, body }) => {
  const st = needStudent(session);
  const pin = String(body.pin || '');
  if (!/^\d{4}$/.test(pin)) fail(400, 'Your PIN must be exactly 4 numbers.');
  if (st.pin_hash) {
    if (!(await verifySecret(String(body.password || ''), st.pass_hash))) fail(400, 'Enter your account password to change your PIN.');
  }
  await db.prepare('UPDATE students SET pin_hash = ?, pin_fails = 0, pin_locked_until = 0 WHERE id = ?')
    .bind(await hashSecret(pin, null, 10000), st.id).run();
  return { ok: true };
});

route('GET', 'roster', async ({ db, session }) => {
  if (!session) fail(401, 'Please log in.');
  const rows = (await db.prepare('SELECT id, name, period FROM students WHERE active = 1 ORDER BY period, name').all()).results || [];
  return { students: rows };
});

route('GET', 'directory', async ({ db, session }) => {
  if (!session) fail(401, 'Please log in.');
  const biz = (await db.prepare(`SELECT id, name, slogan, logo FROM businesses WHERE status = 'approved' ORDER BY name`).all()).results || [];
  const items = (await db.prepare(`SELECT i.business_id, i.name, i.description, i.price FROM items i
    JOIN businesses b ON b.id = i.business_id WHERE b.status = 'approved' AND i.active = 1 ORDER BY i.price`).all()).results || [];
  for (const b of biz) b.items = items.filter((i) => i.business_id === b.id);
  return { businesses: biz };
});

// ----- businesses -----
function cleanLogo(v) {
  const s = String(v || '');
  if (!s) return '';
  if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(s)) fail(400, 'Logo must be an image.');
  if (s.length > 400000) fail(400, 'Logo image is too big. Try a smaller picture.');
  return s;
}

route('POST', 'business', async ({ db, session, body }) => {
  const st = needStudent(session);
  const name = req(body.name, 'Business name', 60);
  const slogan = str(body.slogan, 120);
  const description = str(body.description, 1000);
  const logo = cleanLogo(body.logo);
  const items = Array.isArray(body.items) ? body.items.filter((i) => str(i.name)) : [];
  if (!items.length) fail(400, 'Add at least one item for sale.');
  const clean = items.slice(0, 40).map((i) => ({ name: req(i.name, 'Item name', 60), description: str(i.description, 300), price: toCents(i.price, `Price for ${str(i.name, 60)}`) }));
  let code;
  for (let tries = 0; tries < 10; tries++) {
    code = randomCode();
    if (!(await db.prepare('SELECT 1 AS x FROM businesses WHERE join_code = ?').bind(code).first())) break;
  }
  const r = await db.prepare(`INSERT INTO businesses (name, slogan, description, logo, join_code, status, owner_id, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`).bind(name, slogan, description, logo, code, st.id, now()).run();
  const id = r.meta.last_row_id;
  const stmts = [db.prepare('INSERT INTO business_members (business_id, student_id, role, joined_at) VALUES (?, ?, ?, ?)').bind(id, st.id, 'owner', now())];
  for (const i of clean) stmts.push(db.prepare('INSERT INTO items (business_id, name, description, price, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, i.name, i.description, i.price, now()));
  await db.batch(stmts);
  return { id, join_code: code };
});

route('POST', 'business/join', async ({ db, session, body }) => {
  const st = needStudent(session);
  const code = str(body.code, 20).toUpperCase().replace(/\s/g, '');
  const b = await db.prepare('SELECT * FROM businesses WHERE join_code = ?').bind(code).first();
  if (!b) fail(404, 'No business has that code.');
  if (b.status === 'closed' || b.status === 'rejected') fail(400, 'That business is not open.');
  if (await isMember(db, b.id, st.id)) fail(400, 'You are already a partner in this business.');
  await db.prepare('INSERT INTO business_members (business_id, student_id, role, joined_at) VALUES (?, ?, ?, ?)').bind(b.id, st.id, 'partner', now()).run();
  return { id: b.id, name: b.name, status: b.status };
});

async function memberBusiness(db, session, id, { needApproved = false } = {}) {
  if (!session) fail(401, 'Please log in.');
  if (session.role === 'student' && !(await isMember(db, id, session.student.id))) fail(403, 'You are not a partner in this business.');
  const b = await db.prepare('SELECT * FROM businesses WHERE id = ?').bind(id).first();
  if (!b) fail(404, 'Business not found.');
  if (needApproved && b.status !== 'approved') fail(400, 'This business needs a teacher-approved Business Permit first.');
  return b;
}
const actorOf = (session) => (session.role === 'teacher' ? 'teacher' : `student:${session.student.id}`);

route('GET', 'business/:id', async ({ db, session, params }) => {
  await memberBusiness(db, session, +params.id);
  return businessDetail(db, +params.id);
});

route('PUT', 'business/:id', async ({ db, session, params, body }) => {
  const b = await memberBusiness(db, session, +params.id);
  const name = body.name !== undefined ? req(body.name, 'Business name', 60) : b.name;
  const slogan = body.slogan !== undefined ? str(body.slogan, 120) : b.slogan;
  const description = body.description !== undefined ? str(body.description, 1000) : b.description;
  const logo = body.logo !== undefined ? cleanLogo(body.logo) : b.logo;
  await db.prepare('UPDATE businesses SET name = ?, slogan = ?, description = ?, logo = ? WHERE id = ?').bind(name, slogan, description, logo, b.id).run();
  return { ok: true };
});

route('POST', 'business/:id/items', async ({ db, session, params, body }) => {
  const b = await memberBusiness(db, session, +params.id);
  const r = await db.prepare('INSERT INTO items (business_id, name, description, price, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(b.id, req(body.name, 'Item name', 60), str(body.description, 300), toCents(body.price, 'Price'), now()).run();
  return { id: r.meta.last_row_id };
});

route('PUT', 'items/:id', async ({ db, session, params, body }) => {
  const it = await db.prepare('SELECT * FROM items WHERE id = ?').bind(+params.id).first();
  if (!it) fail(404, 'Item not found.');
  await memberBusiness(db, session, it.business_id);
  await db.prepare('UPDATE items SET name = ?, description = ?, price = ? WHERE id = ?')
    .bind(req(body.name, 'Item name', 60), str(body.description, 300), toCents(body.price, 'Price'), it.id).run();
  return { ok: true };
});

route('DELETE', 'items/:id', async ({ db, session, params }) => {
  const it = await db.prepare('SELECT * FROM items WHERE id = ?').bind(+params.id).first();
  if (!it) fail(404, 'Item not found.');
  await memberBusiness(db, session, it.business_id);
  await db.prepare('UPDATE items SET active = 0 WHERE id = ?').bind(it.id).run();
  return { ok: true };
});

// Cash register
route('POST', 'business/:id/sale', async ({ db, session, params, body }) => {
  const b = await memberBusiness(db, session, +params.id, { needApproved: true });
  const lines = Array.isArray(body.items) ? body.items : [];
  if (!lines.length) fail(400, 'Add at least one item to the sale.');
  const items = (await db.prepare('SELECT * FROM items WHERE business_id = ? AND active = 1').bind(b.id).all()).results || [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const sold = [];
  let total = 0;
  for (const l of lines) {
    const it = byId.get(Number(l.item_id));
    const qty = Math.floor(Number(l.qty));
    if (!it) fail(400, 'One of those items is no longer for sale.');
    if (!(qty >= 1 && qty <= 99)) fail(400, 'Quantity must be 1 to 99.');
    sold.push({ it, qty });
    total += it.price * qty;
  }
  const buyer = await db.prepare('SELECT * FROM students WHERE id = ? AND active = 1').bind(Number(body.buyer_id)).first();
  if (!buyer) fail(400, 'Pick the customer from the list.');
  if (!buyer.pin_hash) fail(400, `${buyer.name} has not created a bank PIN yet. They need to make one on their profile page.`);
  if (buyer.pin_locked_until > now()) {
    const mins = Math.ceil((buyer.pin_locked_until - now()) / 60000);
    fail(400, `${buyer.name}'s PIN is locked for ${mins} more minute(s) after too many wrong tries.`);
  }
  if (!(await verifySecret(String(body.pin || ''), buyer.pin_hash))) {
    const fails = buyer.pin_fails + 1;
    const lock = fails >= 5 ? now() + 10 * 60000 : 0;
    await db.prepare('UPDATE students SET pin_fails = ?, pin_locked_until = ? WHERE id = ?').bind(lock ? 0 : fails, lock, buyer.id).run();
    fail(400, lock ? 'Wrong PIN. Too many tries — this PIN is locked for 10 minutes.' : `Wrong PIN. (${5 - fails} tries left)`);
  }
  if (buyer.pin_fails) await db.prepare('UPDATE students SET pin_fails = 0 WHERE id = ?').bind(buyer.id).run();
  if (buyer.balance < total) fail(400, `Declined: ${buyer.name} only has ${money(buyer.balance)}. The total is ${money(total)}.`);
  const memo = sold.map((s) => `${s.qty}× ${s.it.name}`).join(', ');
  const txId = await move(db, { kind: 'purchase', from: ['student', buyer.id], to: ['business', b.id], amount: total, memo, actor: actorOf(session) });
  await db.batch(sold.map((s) => db.prepare('INSERT INTO sale_items (transaction_id, item_id, business_id, name, qty, price) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(txId, s.it.id, b.id, s.it.name, s.qty, s.it.price)));
  return { ok: true, total, transaction_id: txId, buyer: buyer.name };
});

route('POST', 'business/:id/payout', async ({ db, session, params, body }) => {
  const b = await memberBusiness(db, session, +params.id, { needApproved: true });
  const list = (Array.isArray(body.payouts) ? body.payouts : []).map((p) => ({ id: Number(p.student_id), amount: toCents(p.amount || 0, 'Payout', { allowZero: true }) })).filter((p) => p.amount > 0);
  if (!list.length) fail(400, 'Enter an amount for at least one owner.');
  const total = list.reduce((a, p) => a + p.amount, 0);
  if (total > b.balance) fail(400, `The business only has ${money(b.balance)}. You tried to pay out ${money(total)}.`);
  for (const p of list) if (!(await isMember(db, b.id, p.id))) fail(400, 'You can only pay out owners and partners of this business.');
  for (const p of list) await move(db, { kind: 'payout', from: ['business', b.id], to: ['student', p.id], amount: p.amount, memo: str(body.memo, 200) || `Payout from ${b.name}`, actor: actorOf(session) });
  return { ok: true, total };
});

route('POST', 'business/:id/expense', async ({ db, session, params, body }) => {
  const b = await memberBusiness(db, session, +params.id, { needApproved: true });
  const amount = toCents(body.amount);
  const memo = req(body.memo, 'What the expense was for', 200);
  await move(db, { kind: 'expense', from: ['business', b.id], to: ['bank'], amount, memo, actor: actorOf(session) });
  return { ok: true };
});

// ----- grants & loans -----
async function optionalBusiness(db, st, id) {
  if (!id) return null;
  if (!(await isMember(db, Number(id), st.id))) fail(400, 'You can only apply for a business you belong to.');
  return Number(id);
}

route('POST', 'grants', async ({ db, session, body }) => {
  const st = needStudent(session);
  const bizId = await optionalBusiness(db, st, body.business_id);
  const r = await db.prepare(`INSERT INTO grants (student_id, business_id, amount_requested, title, society_impact, who_helped, spend_plan, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(st.id, bizId, toCents(body.amount, 'Amount requested'), req(body.title, 'Project title', 100),
    req(body.society_impact, 'How your business will improve society', 3000), req(body.who_helped, 'Who it will help', 2000),
    req(body.spend_plan, 'How you will spend the grant', 2000), now()).run();
  return { id: r.meta.last_row_id };
});

route('POST', 'loans', async ({ db, session, body }) => {
  const st = needStudent(session);
  const bizId = await optionalBusiness(db, st, body.business_id);
  const r = await db.prepare(`INSERT INTO loans (student_id, business_id, amount_requested, description, goals, projected_revenue, repayment_plan, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(st.id, bizId, toCents(body.amount, 'Loan amount'), req(body.description, 'Business description', 3000),
    req(body.goals, 'Business goals', 3000), toCents(body.projected_revenue, 'Money you plan to make', { allowZero: true }),
    req(body.repayment_plan, 'How you will pay it back', 2000), now()).run();
  return { id: r.meta.last_row_id };
});

route('POST', 'loans/:id/pay', async ({ db, session, params, body }) => {
  const st = needStudent(session);
  const loan = await db.prepare('SELECT * FROM loans WHERE id = ?').bind(+params.id).first();
  if (!loan || loan.status !== 'active') fail(400, 'That loan is not active.');
  const mine = loan.student_id === st.id || (loan.business_id && (await isMember(db, loan.business_id, st.id)));
  if (!mine) fail(403, 'That is not your loan.');
  const amount = Math.min(toCents(body.amount, 'Payment'), loan.balance_owed);
  let from = ['student', st.id];
  if (body.from === 'business') {
    if (!loan.business_id) fail(400, 'This loan is not linked to a business.');
    from = ['business', loan.business_id];
  }
  await move(db, { kind: 'loan_payment', from, to: ['bank'], amount, memo: `Loan #${loan.id} payment`, ref: loan.id, actor: actorOf(session) });
  const left = loan.balance_owed - amount;
  await db.prepare('UPDATE loans SET balance_owed = ?, status = ? WHERE id = ?').bind(left, left <= 0 ? 'paid' : 'active', loan.id).run();
  return { ok: true, paid: amount, left };
});

// ----- teacher -----
route('GET', 'teacher/overview', async ({ db, session }) => {
  needTeacher(session);
  const students = (await db.prepare(`SELECT id, name, username, period, balance, active, pin_locked_until, (pin_hash IS NOT NULL) AS has_pin, created_at
    FROM students ORDER BY active DESC, period, name`).all()).results || [];
  const businesses = (await db.prepare(`SELECT b.*, s.name AS owner_name,
      (SELECT COUNT(*) FROM business_members m WHERE m.business_id = b.id) AS member_count,
      (SELECT GROUP_CONCAT(s2.name, ', ') FROM business_members m2 JOIN students s2 ON s2.id = m2.student_id WHERE m2.business_id = b.id) AS member_names,
      (SELECT COALESCE(SUM(amount),0) FROM transactions t WHERE t.kind = 'purchase' AND t.refunded = 0 AND t.to_type = 'business' AND t.to_id = b.id) AS revenue
    FROM businesses b JOIN students s ON s.id = b.owner_id ORDER BY CASE b.status WHEN 'pending' THEN 0 ELSE 1 END, b.name`).all()).results || [];
  const items = (await db.prepare('SELECT business_id, name, description, price FROM items WHERE active = 1').all()).results || [];
  for (const b of businesses) b.items = items.filter((i) => i.business_id === b.id);
  const grants = (await db.prepare(`SELECT g.*, s.name AS student_name, b.name AS business_name FROM grants g JOIN students s ON s.id = g.student_id
    LEFT JOIN businesses b ON b.id = g.business_id ORDER BY CASE g.status WHEN 'pending' THEN 0 ELSE 1 END, g.id DESC`).all()).results || [];
  const loans = (await db.prepare(`SELECT l.*, s.name AS student_name, b.name AS business_name FROM loans l JOIN students s ON s.id = l.student_id
    LEFT JOIN businesses b ON b.id = l.business_id ORDER BY CASE l.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, l.id DESC`).all()).results || [];
  const settings = await getSettings(db);
  return { students, businesses, grants, loans, settings };
});

route('GET', 'teacher/transactions', async ({ db, session, url }) => {
  needTeacher(session);
  const type = url.searchParams.get('type');
  const id = Number(url.searchParams.get('id'));
  const limit = Math.min(Number(url.searchParams.get('limit')) || 300, 2000);
  if (type && id) return { transactions: await accountTx(db, type, id, limit) };
  return { transactions: (await db.prepare(`${TX_SELECT} ORDER BY t.id DESC LIMIT ?`).bind(limit).all()).results || [] };
});

async function resolveTargets(db, targets) {
  const out = [];
  for (const t of Array.isArray(targets) ? targets : []) {
    if (t === 'all_students') {
      const rows = (await db.prepare('SELECT id FROM students WHERE active = 1').all()).results || [];
      rows.forEach((r) => out.push(['student', r.id]));
    } else if (t === 'all_businesses') {
      const rows = (await db.prepare(`SELECT id FROM businesses WHERE status = 'approved'`).all()).results || [];
      rows.forEach((r) => out.push(['business', r.id]));
    } else if (t && (t.type === 'student' || t.type === 'business')) {
      out.push([t.type, Number(t.id)]);
    }
  }
  const seen = new Set();
  return out.filter((t) => { const k = t.join(':'); if (seen.has(k)) return false; seen.add(k); return true; });
}

route('POST', 'teacher/award', async ({ db, session, body }) => {
  needTeacher(session);
  const amount = toCents(body.amount);
  const targets = await resolveTargets(db, body.targets);
  if (!targets.length) fail(400, 'Pick at least one student or business.');
  for (const t of targets) await move(db, { kind: 'award', from: ['bank'], to: t, amount, memo: str(body.memo, 200) || 'Teacher award', actor: 'teacher' });
  return { ok: true, count: targets.length };
});

route('POST', 'teacher/charge', async ({ db, session, body }) => {
  needTeacher(session);
  const kind = body.kind === 'tax' ? 'tax' : 'fee';
  const targets = await resolveTargets(db, body.targets);
  if (!targets.length) fail(400, 'Pick at least one student or business.');
  const percent = body.mode === 'percent';
  const pct = percent ? Number(body.percent) : 0;
  if (percent && !(pct > 0 && pct <= 100)) fail(400, 'Percent must be between 0 and 100.');
  const flat = percent ? 0 : toCents(body.amount);
  let count = 0, total = 0;
  for (const t of targets) {
    let amount = flat;
    if (percent) {
      const row = await db.prepare(`SELECT balance FROM ${TABLE[t[0]]} WHERE id = ?`).bind(t[1]).first();
      amount = Math.round(Math.max(0, row ? row.balance : 0) * pct / 100);
    }
    if (amount <= 0) continue;
    const label = kind === 'tax' ? 'Tax' : 'Fee';
    const memo = str(body.memo, 200) || (percent ? `${label} (${pct}%)` : label);
    await move(db, { kind, from: t, to: ['bank'], amount, memo, allowNegative: true, actor: 'teacher' });
    count++; total += amount;
  }
  return { ok: true, count, total };
});

route('POST', 'teacher/refund/:id', async ({ db, session, params, body }) => {
  needTeacher(session);
  const t = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(+params.id).first();
  if (!t) fail(404, 'Transaction not found.');
  if (t.kind === 'refund') fail(400, 'You cannot refund a refund.');
  if (t.refunded) fail(400, 'This transaction was already refunded.');
  const from = t.to_type === 'bank' ? ['bank'] : [t.to_type, t.to_id];
  const to = t.from_type === 'bank' ? ['bank'] : [t.from_type, t.from_id];
  if (from[0] === 'bank' && to[0] === 'bank') fail(400, 'Nothing to refund.');
  await db.prepare('UPDATE transactions SET refunded = 1 WHERE id = ?').bind(t.id).run();
  const id = await move(db, { kind: 'refund', from, to, amount: t.amount, memo: str(body.memo, 200) || `Refund of #${t.id} (${KIND_NAMES[t.kind] || t.kind}${t.memo ? ': ' + t.memo : ''})`.slice(0, 300), ref: t.id, allowNegative: true, actor: 'teacher' });
  if (t.kind === 'loan_payment' && t.ref_id) {
    await db.prepare(`UPDATE loans SET balance_owed = balance_owed + ?, status = 'active' WHERE id = ?`).bind(t.amount, t.ref_id).run();
  }
  if (t.kind === 'loan' && t.ref_id) {
    await db.prepare(`UPDATE loans SET balance_owed = 0, status = 'cancelled' WHERE id = ?`).bind(t.ref_id).run();
  }
  return { ok: true, refund_id: id };
});

route('POST', 'teacher/business/:id/decision', async ({ db, session, params, body }) => {
  needTeacher(session);
  const status = ['approved', 'rejected', 'pending', 'closed'].includes(body.status) ? body.status : fail(400, 'Bad status.');
  const r = await db.prepare('UPDATE businesses SET status = ?, teacher_note = ? WHERE id = ?').bind(status, str(body.note, 500), +params.id).run();
  if (!r.meta.changes) fail(404, 'Business not found.');
  return { ok: true };
});

route('POST', 'teacher/business/:id/remove-member', async ({ db, session, params, body }) => {
  needTeacher(session);
  const b = await db.prepare('SELECT * FROM businesses WHERE id = ?').bind(+params.id).first();
  if (!b) fail(404, 'Business not found.');
  if (Number(body.student_id) === b.owner_id) fail(400, 'You cannot remove the owner who created the business.');
  await db.prepare('DELETE FROM business_members WHERE business_id = ? AND student_id = ?').bind(b.id, Number(body.student_id)).run();
  return { ok: true };
});

route('POST', 'teacher/business/:id/new-code', async ({ db, session, params }) => {
  needTeacher(session);
  const code = randomCode();
  await db.prepare('UPDATE businesses SET join_code = ? WHERE id = ?').bind(code, +params.id).run();
  return { join_code: code };
});

async function depositTarget(db, studentId, businessId) {
  if (businessId) {
    const b = await db.prepare('SELECT status FROM businesses WHERE id = ?').bind(businessId).first();
    if (b && b.status === 'approved') return ['business', businessId];
  }
  return ['student', studentId];
}

route('POST', 'teacher/grants/:id/decision', async ({ db, session, params, body }) => {
  needTeacher(session);
  const g = await db.prepare('SELECT * FROM grants WHERE id = ?').bind(+params.id).first();
  if (!g) fail(404, 'Grant not found.');
  if (g.status !== 'pending') fail(400, 'This grant was already decided.');
  if (body.status === 'approved') {
    const amount = toCents(body.amount, 'Grant amount');
    const to = await depositTarget(db, g.student_id, g.business_id);
    await move(db, { kind: 'grant', from: ['bank'], to, amount, memo: `Grant: ${g.title}`, ref: g.id, actor: 'teacher' });
    await db.prepare(`UPDATE grants SET status = 'approved', amount_awarded = ?, teacher_note = ?, decided_at = ? WHERE id = ?`).bind(amount, str(body.note, 1000), now(), g.id).run();
  } else {
    await db.prepare(`UPDATE grants SET status = 'denied', teacher_note = ?, decided_at = ? WHERE id = ?`).bind(str(body.note, 1000), now(), g.id).run();
  }
  return { ok: true };
});

route('POST', 'teacher/loans/:id/decision', async ({ db, session, params, body }) => {
  needTeacher(session);
  const l = await db.prepare('SELECT * FROM loans WHERE id = ?').bind(+params.id).first();
  if (!l) fail(404, 'Loan not found.');
  if (l.status !== 'pending') fail(400, 'This loan was already decided.');
  if (body.status === 'approved') {
    const amount = toCents(body.amount, 'Loan amount');
    const rate = Number(body.rate || 0);
    if (!(rate >= 0 && rate <= 500)) fail(400, 'Interest rate must be 0–500%.');
    const owed = Math.round(amount * (1 + rate / 100));
    const to = await depositTarget(db, l.student_id, l.business_id);
    await move(db, { kind: 'loan', from: ['bank'], to, amount, memo: `Loan #${l.id} at ${rate}% interest`, ref: l.id, actor: 'teacher' });
    await db.prepare(`UPDATE loans SET status = 'active', amount_approved = ?, interest_rate = ?, balance_owed = ?, teacher_note = ?, decided_at = ? WHERE id = ?`)
      .bind(amount, rate, owed, str(body.note, 1000), now(), l.id).run();
  } else {
    await db.prepare(`UPDATE loans SET status = 'denied', teacher_note = ?, decided_at = ? WHERE id = ?`).bind(str(body.note, 1000), now(), l.id).run();
  }
  return { ok: true };
});

route('POST', 'teacher/loans/:id/adjust', async ({ db, session, params, body }) => {
  needTeacher(session);
  const l = await db.prepare('SELECT * FROM loans WHERE id = ?').bind(+params.id).first();
  if (!l || l.status !== 'active') fail(400, 'That loan is not active.');
  let owed = l.balance_owed;
  let rate = l.interest_rate;
  if (body.action === 'interest') {
    if (body.rate !== undefined && body.rate !== '') rate = Number(body.rate);
    if (!(rate >= 0 && rate <= 500)) fail(400, 'Interest rate must be 0–500%.');
    owed = Math.round(owed * (1 + rate / 100));
  } else if (body.action === 'set') {
    owed = toCents(body.amount, 'Amount owed', { allowZero: true });
  } else if (body.action === 'forgive') {
    owed = 0;
  } else fail(400, 'Unknown action.');
  await db.prepare('UPDATE loans SET balance_owed = ?, interest_rate = ?, status = ? WHERE id = ?').bind(owed, rate, owed <= 0 ? 'paid' : 'active', l.id).run();
  return { ok: true, balance_owed: owed };
});

route('POST', 'teacher/students', async ({ db, session, body }) => {
  needTeacher(session);
  const s = await getSettings(db);
  const start = parseInt(s.starting_balance, 10) || 0;
  const lines = String(body.roster || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const made = [], errors = [];
  for (const line of lines.slice(0, 300)) {
    const [name, username, password, period] = line.split(/\t|,/).map((x) => (x || '').trim());
    const u = (username || '').toLowerCase();
    if (!name || !/^[a-z0-9._-]{2,30}$/.test(u) || !password || password.length < 4) { errors.push(`${line} — needs: Name, username, password (4+), period`); continue; }
    if (await db.prepare('SELECT 1 AS x FROM students WHERE username = ?').bind(u).first()) { errors.push(`${u} — username already used`); continue; }
    const r = await db.prepare('INSERT INTO students (name, username, period, pass_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(name.slice(0, 60), u, (period || '').slice(0, 20), await hashSecret(password), now()).run();
    if (start > 0) await move(db, { kind: 'award', from: ['bank'], to: ['student', r.meta.last_row_id], amount: start, memo: 'Starting balance', actor: 'teacher' });
    made.push(u);
  }
  return { created: made.length, errors };
});

route('POST', 'teacher/student/:id', async ({ db, session, params, body }) => {
  needTeacher(session);
  const st = await db.prepare('SELECT * FROM students WHERE id = ?').bind(+params.id).first();
  if (!st) fail(404, 'Student not found.');
  if (body.action === 'reset_pin') await db.prepare('UPDATE students SET pin_hash = NULL, pin_fails = 0, pin_locked_until = 0 WHERE id = ?').bind(st.id).run();
  else if (body.action === 'unlock_pin') await db.prepare('UPDATE students SET pin_fails = 0, pin_locked_until = 0 WHERE id = ?').bind(st.id).run();
  else if (body.action === 'password') {
    const p = String(body.password || '');
    if (p.length < 4) fail(400, 'Password must be at least 4 characters.');
    await db.prepare('UPDATE students SET pass_hash = ? WHERE id = ?').bind(await hashSecret(p), st.id).run();
    await db.prepare('DELETE FROM sessions WHERE student_id = ?').bind(st.id).run();
  } else if (body.action === 'edit') {
    await db.prepare('UPDATE students SET name = ?, period = ? WHERE id = ?').bind(req(body.name, 'Name', 60), str(body.period, 20), st.id).run();
  } else if (body.action === 'deactivate' || body.action === 'activate') {
    await db.prepare('UPDATE students SET active = ? WHERE id = ?').bind(body.action === 'activate' ? 1 : 0, st.id).run();
    if (body.action === 'deactivate') await db.prepare('DELETE FROM sessions WHERE student_id = ?').bind(st.id).run();
  } else fail(400, 'Unknown action.');
  return { ok: true };
});

route('POST', 'teacher/settings', async ({ db, session, body }) => {
  needTeacher(session);
  const updates = {};
  if (body.class_code !== undefined) updates.class_code = req(body.class_code, 'Class code', 30).toUpperCase();
  if (body.starting_balance !== undefined) updates.starting_balance = String(toCents(body.starting_balance, 'Starting balance', { allowZero: true }));
  if (body.allow_signup !== undefined) updates.allow_signup = body.allow_signup ? '1' : '0';
  if (body.bank_name !== undefined) updates.bank_name = req(body.bank_name, 'Bank name', 40);
  await db.batch(Object.entries(updates).map(([k, v]) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v)));
  return { ok: true };
});

// ---------- entry ----------
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  try {
    if (!env.DB) fail(500, 'The database is not connected. In Cloudflare, add a D1 binding named DB to this Pages project.');
    const db = env.DB;
    await ensureSchema(db);
    const match = routes.find((r) => r.method === request.method && r.re.test(path));
    if (!match) fail(404, 'Not found.');
    const m = path.match(match.re);
    const params = {};
    match.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    let body = {};
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      try { body = await request.json(); } catch { body = {}; }
    }
    const session = await getSession(request, db);
    const result = await match.handler({ db, env, request, url, params, body, session });
    return json(result);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong on the server: ' + (e && e.message ? e.message : e) }, 500);
  }
}
