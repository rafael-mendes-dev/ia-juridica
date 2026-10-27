import { getDb, getSettings } from './db.js';
import { ftsQuery } from './catalog.js';
import { docSourceUrl } from './docs.js';
import * as llm from './llm.js';
import * as vectors from './vectors.js';

function chunkRows(ids) {
  if (!ids.length) return [];
  const rows = getDb().prepare(
    `SELECT c.id, c.doc_id, c.heading, c.text, d.title, d.kind, d.ref, d.meta
     FROM chunks c JOIN docs d ON d.id = c.doc_id WHERE c.id IN (${ids.map(() => '?').join(',')})`,
  ).all(...ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((r) => ({
    id: r.id, docId: r.doc_id, heading: r.heading, text: r.text, title: r.title,
    kind: r.kind, ref: r.ref, url: docSourceUrl(r), meta: JSON.parse(r.meta || '{}'),
  }));
}

function docFilter(docIds) {
  return docIds?.length ? ` AND c.doc_id IN (${docIds.map(Number).join(',')})` : '';
}

// Busca híbrida: vetores (semântica) + FTS5 (palavras), combinadas por Reciprocal Rank Fusion
export async function searchChunks(query, { k = 8, docIds } = {}) {
  const db = getDb();
  const ranks = new Map();
  const bump = (id, rank, w = 1) => ranks.set(id, (ranks.get(id) || 0) + w / (60 + rank));

  const match = ftsQuery(query, 'OR');
  if (match) {
    try {
      const rows = db.prepare(
        `SELECT c.id FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ?${docFilter(docIds)} ORDER BY bm25(chunks_fts, 2.0, 1.0) LIMIT 30`,
      ).all(match);
      rows.forEach((r, i) => bump(r.id, i));
    } catch (e) {
      console.error('FTS:', e.message);
    }
  }

  const { embedModel } = getSettings();
  if (vectors.size() && vectors.indexModel() === embedModel) {
    try {
      const [emb] = await llm.embed(embedModel, [query]);
      let allowed;
      if (docIds?.length) {
        allowed = new Set(db.prepare(`SELECT id FROM chunks c WHERE 1${docFilter(docIds)}`).all().map((r) => r.id));
      }
      vectors.search(vectors.normalize(emb), 30, allowed).forEach((r, i) => bump(r.id, i, 1.2));
    } catch (e) {
      console.error('Vetores:', e.message);
    }
  }

  const ids = [...ranks.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
  return chunkRows(ids);
}

// Trechos de artigos específicos ("art. 5º"), priorizando os que contêm os incisos pedidos ("inciso XI")
export function articleChunks(docId, arts, incisos = []) {
  const want = new Set(arts.map((a) => String(parseInt(a, 10))));
  const rows = getDb().prepare('SELECT id, heading, text FROM chunks WHERE doc_id = ? ORDER BY ord').all(docId);
  const hits = [];
  for (const r of rows) {
    const m = (r.heading || '').match(/^Arts?\.\s*(\d+)\D*?(?:a\s*(\d+))?/);
    if (!m) continue;
    const from = +m[1];
    const to = m[2] ? +m[2] : from;
    if ([...want].some((a) => +a >= from && +a <= to)) hits.push(r);
  }
  if (incisos.length) {
    const re = new RegExp(`(^|\\n)\\s*(${incisos.join('|')})\\s*[-–—]`);
    const withInciso = hits.filter((r) => re.test(r.text));
    // trecho do inciso + o início do artigo (caput)
    if (withInciso.length) return chunkRows([...new Set([...withInciso.slice(0, 2), hits[0]].map((r) => r.id))]);
  }
  return chunkRows(hits.slice(0, 4).map((r) => r.id));
}
