-- Student Business Game database (Cloudflare D1)
-- The site creates these tables automatically on first use.
-- You can also paste this whole file into the D1 Console to create them by hand.
-- All money amounts are stored in cents (500 = $5.00).

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  period TEXT DEFAULT '',
  pass_hash TEXT NOT NULL,
  pin_hash TEXT,
  balance INTEGER NOT NULL DEFAULT 0,
  pin_fails INTEGER NOT NULL DEFAULT 0,
  pin_locked_until INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  student_id INTEGER,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slogan TEXT DEFAULT '',
  description TEXT DEFAULT '',
  logo TEXT DEFAULT '',
  join_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  balance INTEGER NOT NULL DEFAULT 0,
  owner_id INTEGER NOT NULL,
  teacher_note TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS business_members (
  business_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'partner',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (business_id, student_id)
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Every movement of money. Account types: student, business, bank
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  from_type TEXT NOT NULL,
  from_id INTEGER,
  to_type TEXT NOT NULL,
  to_id INTEGER,
  amount INTEGER NOT NULL,
  memo TEXT DEFAULT '',
  ref_id INTEGER,
  refunded INTEGER NOT NULL DEFAULT 0,
  actor TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS tx_from ON transactions(from_type, from_id);
CREATE INDEX IF NOT EXISTS tx_to ON transactions(to_type, to_id);

CREATE TABLE IF NOT EXISTS sale_items (
  transaction_id INTEGER NOT NULL,
  item_id INTEGER,
  business_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  price INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sale_items_biz ON sale_items(business_id);

CREATE TABLE IF NOT EXISTS grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  business_id INTEGER,
  amount_requested INTEGER NOT NULL,
  title TEXT DEFAULT '',
  society_impact TEXT NOT NULL,
  who_helped TEXT DEFAULT '',
  spend_plan TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  amount_awarded INTEGER NOT NULL DEFAULT 0,
  teacher_note TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  business_id INTEGER,
  amount_requested INTEGER NOT NULL,
  description TEXT NOT NULL,
  goals TEXT NOT NULL,
  projected_revenue INTEGER NOT NULL DEFAULT 0,
  repayment_plan TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  amount_approved INTEGER NOT NULL DEFAULT 0,
  interest_rate REAL NOT NULL DEFAULT 0,
  balance_owed INTEGER NOT NULL DEFAULT 0,
  teacher_note TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
