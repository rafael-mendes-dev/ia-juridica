import fs from 'node:fs';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { APP_REPO, ALIASES } from './config.js';
import { getDb, hasCatalog, attachCatalog, detachCatalog } from './db.js';

const STOP = new Set(('a o as os de da do das dos e em no na nos nas um uma para por com sem que qual quais ' +
  'sobre como ao aos à às se ou mais lei leis norma normas me minha meu sua seu é são ser foi quero saber ' +
  'liste listar mostre mostrar quais tem ter pode posso art artigo artigos').split(' '));

export function tokens(q) {
  return (q || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

// Monta uma expressão MATCH do FTS5 a partir de texto livre
export function ftsQuery(q, op = 'AND') {
  const t = tokens(q);
  if (!t.length) return null;
  return t.map((x) => `"${x}"*`).join(` ${op} `);
}

export function expandAliases(q) {
  const low = (q || '').toLowerCase();
  const extra = [];
  for (const [k, v] of Object.entries(ALIASES)) {
    if (new RegExp(`\\b${k}\\b`).test(low)) extra.push(v);
  }
  return extra;
}

// Busca no catálogo de normas (título, ementa, tipo, número) com filtros
export function searchCatalog({ q = '', tipo, esfera, uf, ano, limit = 30, offset = 0 } = {}) {
  if (!hasCatalog()) return { total: 0, items: [], available: false };
  const db = getDb();
  const where = [];
  const params = [];
  if (tipo) { where.push('n.tipo = ?'); params.push(tipo); }
  if (esfera) { where.push('n.esfera = ?'); params.push(esfera); }
  if (uf) { where.push('n.uf = ?'); params.push(uf.toUpperCase()); }
  if (ano) { where.push('n.ano = ?'); params.push(+ano); }

  const num = (q.match(/\b(\d{1,3}(?:\.\d{3})+|\d{2,6})(?:\s*\/\s*(\d{2,4}))?\b/) || []);
  const run = (match) => {
    const w = [...where];
    const p = [...params];
    let from = 'cat.normas n';
    let order = 'n.data DESC';
    if (match) {
      from = 'cat.normas_fts JOIN cat.normas n ON n.id = normas_fts.rowid';
      w.push('normas_fts MATCH ?');
      p.push(match);
      order = 'bm25(normas_fts, 10.0, 3.0, 1.0, 5.0)';
    }
    const sqlWhere = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const total = db.prepare(`SELECT count(*) c FROM ${from} ${sqlWhere}`).get(...p).c;
    const items = db.prepare(`SELECT n.* FROM ${from} ${sqlWhere} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...p, limit, offset);
    return { total, items };
  };

  let res = { total: 0, items: [] };
  // número de lei explícito ("8.078/90", "lei 8078")
  if (num[1]) {
    const n = num[1].replace(/\./g, '');
    const w = [...where, "replace(n.numero, '.', '') = ?"];
    const p = [...params, n];
    if (num[2]) {
      let y = +num[2];
      if (y < 100) y += y > 30 ? 1900 : 2000;
      w.push('n.ano = ?');
      p.push(y);
    }
    const items = db.prepare(`SELECT n.* FROM cat.normas n WHERE ${w.join(' AND ')} ORDER BY (n.esfera = 'federal') DESC, n.data DESC LIMIT ?`).all(...p, limit);
    res = { total: items.length, items };
  }
  if (!res.items.length) {
    const qx = [q, ...expandAliases(q)].join(' ');
    const and = ftsQuery(q, 'AND');
    if (and) res = run(and);
    if (!res.items.length && qx.trim()) {
      const or = ftsQuery(qx, 'OR');
      if (or) res = run(or);
    }
    if (!q.trim()) res = run(null);
  }
  return { ...res, available: true };
}

export function getNorma(path) {
  if (!hasCatalog()) return null;
  return getDb().prepare('SELECT * FROM cat.normas WHERE path = ?').get(path) || null;
}

export function findNorma({ tipo, numero, ano, path }) {
  if (path) return getNorma(path) || { path, titulo: path };
  if (!hasCatalog()) return null;
  return getDb().prepare(
    "SELECT * FROM cat.normas WHERE esfera = 'federal' AND tipo = ? AND replace(numero, '.', '') = ? AND ano = ? LIMIT 1",
  ).get(tipo, String(numero), ano) || null;
}

export function catalogFacets() {
  if (!hasCatalog()) return { tipos: [], ufs: [], esferas: [] };
  const db = getDb();
  return {
    tipos: db.prepare('SELECT tipo, count(*) c FROM cat.normas GROUP BY tipo ORDER BY c DESC').all(),
    ufs: db.prepare('SELECT uf, count(*) c FROM cat.normas WHERE uf IS NOT NULL GROUP BY uf ORDER BY uf').all(),
    esferas: db.prepare('SELECT esfera, count(*) c FROM cat.normas GROUP BY esfera ORDER BY c DESC').all(),
  };
}

// ---- Atualização do catálogo (release "catalog" do repositório do app) ----

export const catalogState = { state: 'idle', version: null, count: 0, progress: 0, error: null };

function releaseUrl(file) {
  return `https://github.com/${APP_REPO}/releases/download/catalog/${file}`;
}

export function readLocalCatalogMeta(paths) {
  try {
    return JSON.parse(fs.readFileSync(paths.catalogMeta, 'utf8'));
  } catch {
    return null;
  }
}

export async function updateCatalog(paths, { force = false } = {}) {
  if (catalogState.state === 'baixando') return catalogState;
  const local = readLocalCatalogMeta(paths);
  catalogState.version = local?.version || null;
  catalogState.count = local?.count || 0;
  if (APP_REPO.startsWith('OWNER/')) {
    catalogState.state = hasCatalog() ? 'ok' : 'ausente';
    return catalogState;
  }
  try {
    catalogState.state = 'verificando';
    const res = await fetch(releaseUrl('catalog.json'), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`catalog.json: HTTP ${res.status}`);
    const remote = await res.json();
    if (!force && local?.version === remote.version && hasCatalog()) {
      catalogState.state = 'ok';
      return catalogState;
    }
    catalogState.state = 'baixando';
    catalogState.progress = 0;
    const dl = await fetch(releaseUrl('catalog.db.gz'));
    if (!dl.ok) throw new Error(`catalog.db.gz: HTTP ${dl.status}`);
    const total = +dl.headers.get('content-length') || remote.gzSize || 0;
    let got = 0;
    const tmp = paths.catalogDb + '.tmp';
    const body = Readable.fromWeb(dl.body);
    body.on('data', (c) => {
      got += c.length;
      if (total) catalogState.progress = got / total;
    });
    await pipeline(body, zlib.createGunzip(), fs.createWriteStream(tmp));
    detachCatalog();
    fs.rmSync(paths.catalogDb, { force: true });
    fs.renameSync(tmp, paths.catalogDb);
    attachCatalog();
    fs.writeFileSync(paths.catalogMeta, JSON.stringify(remote));
    Object.assign(catalogState, { state: 'ok', version: remote.version, count: remote.count, error: null });
  } catch (e) {
    catalogState.error = e.message;
    catalogState.state = hasCatalog() ? 'ok' : 'erro';
    console.error('Atualização do catálogo falhou:', e.message);
  }
  return catalogState;
}
