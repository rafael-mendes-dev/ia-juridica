import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SETTINGS } from './config.js';

let db;
let paths;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,            -- lei | upload | texto | web
  ref TEXT,                      -- caminho no repo de leis, nome do arquivo ou URL
  title TEXT NOT NULL,
  meta TEXT,                     -- JSON livre (tipo, número, data, ementa, fonte...)
  status TEXT DEFAULT 'pendente',-- pendente | indexado | erro
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(kind, ref)
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  model TEXT,
  embedding BLOB
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  heading, text, content='chunks', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, heading, text) VALUES (new.id, new.heading, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, heading, text) VALUES ('delete', old.id, old.heading, old.text);
END;
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  title TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sources TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

export function openDb(p) {
  paths = p;
  db = new DatabaseSync(p.userDb);
  db.exec(SCHEMA);
  attachCatalog();
  return db;
}

export function getDb() {
  return db;
}

export function hasCatalog() {
  try {
    return !!db.prepare("SELECT 1 FROM cat.sqlite_master WHERE name = 'normas'").get();
  } catch {
    return false;
  }
}

export function attachCatalog() {
  if (fs.existsSync(paths.catalogDb)) {
    try {
      db.exec(`ATTACH DATABASE '${paths.catalogDb.replaceAll("'", "''")}' AS cat`);
    } catch (e) {
      console.error('Falha ao abrir catálogo:', e.message);
    }
  }
}

export function detachCatalog() {
  try {
    db.exec('DETACH DATABASE cat');
  } catch {}
}

export function getSettings() {
  const rows = db.prepare('SELECT k, v FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.k] = JSON.parse(r.v);
  return s;
}

export function setSettings(patch) {
  const st = db.prepare('INSERT INTO settings(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  for (const [k, v] of Object.entries(patch)) {
    if (k in DEFAULT_SETTINGS) st.run(k, JSON.stringify(v));
  }
  return getSettings();
}
