import { getDb, getSettings } from './db.js';
import { LEIS_RAW, LEIS_BLOB, CORE_LAWS } from './config.js';
import { chunkLegal, chunkText, parseFrontMatter } from './chunk.js';
import { extractFile, htmlToText } from './extract.js';
import { getNorma, findNorma } from './catalog.js';
import * as ollama from './ollama.js';
import * as vectors from './vectors.js';

const BATCH = 16;

// Fila de tarefas em segundo plano, exibida no front
export const jobs = { current: null, queue: [], done: 0, total: 0, log: [] };
let running = false;

function enqueue(label, fn) {
  return new Promise((resolve, reject) => {
    jobs.queue.push({ label, fn, resolve, reject });
    jobs.total++;
    runQueue();
  });
}

async function runQueue() {
  if (running) return;
  running = true;
  while (jobs.queue.length) {
    const job = jobs.queue.shift();
    jobs.current = { label: job.label, progress: 0 };
    try {
      job.resolve(await job.fn((p) => { jobs.current.progress = p; }));
    } catch (e) {
      jobs.log.unshift({ label: job.label, error: e.message, at: Date.now() });
      jobs.log.length = Math.min(jobs.log.length, 20);
      job.reject(e);
    }
    jobs.done++;
  }
  jobs.current = null;
  jobs.done = jobs.total = 0;
  running = false;
}

export function docSourceUrl(doc) {
  if (doc.kind === 'lei') return LEIS_BLOB + doc.ref;
  if (doc.kind === 'web') return doc.ref;
  return null;
}

function upsertDoc(kind, ref, title, meta) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM docs WHERE kind = ? AND ref IS ?').get(kind, ref);
  if (existing) return existing;
  const r = db.prepare('INSERT INTO docs(kind, ref, title, meta) VALUES (?, ?, ?, ?)')
    .run(kind, ref, title, JSON.stringify(meta || {}));
  return db.prepare('SELECT * FROM docs WHERE id = ?').get(r.lastInsertRowid);
}

async function embedModelReady() {
  const { embedModel } = getSettings();
  try {
    const models = await ollama.listModels();
    return models.some((m) => m.name === embedModel || m.name === embedModel + ':latest') ? embedModel : null;
  } catch {
    return null;
  }
}

// Gera embeddings para os trechos ainda sem vetor do modelo atual
async function embedChunks(rows, model, onProgress) {
  const db = getDb();
  const upd = db.prepare('UPDATE chunks SET embedding = ?, model = ? WHERE id = ?');
  const title = new Map();
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const inputs = batch.map((r) => {
      if (!title.has(r.doc_id)) title.set(r.doc_id, db.prepare('SELECT title FROM docs WHERE id = ?').get(r.doc_id)?.title || '');
      return `${title.get(r.doc_id)}${r.heading ? ' — ' + r.heading : ''}\n${r.text}`;
    });
    const embs = await ollama.embed(model, inputs);
    db.exec('BEGIN');
    try {
      batch.forEach((r, j) => {
        const v = vectors.normalize(embs[j]);
        upd.run(vectors.toBlob(v), model, r.id);
        if (vectors.indexModel() === model) vectors.add(r.id, v);
      });
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    onProgress?.(Math.min(1, (i + batch.length) / rows.length));
  }
}

// Grava os trechos (busca textual disponível na hora) e agenda os embeddings em segundo plano
function storeChunks(doc, chunks) {
  const db = getDb();
  try {
    if (!chunks.length) throw new Error('Nenhum texto encontrado no documento.');
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(doc.id);
      const ins = db.prepare('INSERT INTO chunks(doc_id, ord, heading, text) VALUES (?, ?, ?, ?)');
      chunks.forEach((c, i) => ins.run(doc.id, i, c.heading, c.text));
      db.prepare("UPDATE docs SET status = 'indexado', error = NULL WHERE id = ?").run(doc.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (e) {
    db.prepare("UPDATE docs SET status = 'erro', error = ? WHERE id = ?").run(e.message, doc.id);
    throw e;
  }
  const saved = db.prepare('SELECT * FROM docs WHERE id = ?').get(doc.id);
  enqueue(`Embeddings: ${saved.title}`, async (progress) => {
    const model = await embedModelReady();
    if (!model) return;
    const rows = db.prepare('SELECT id, doc_id, heading, text FROM chunks WHERE doc_id = ? AND (model IS NOT ? OR embedding IS NULL) ORDER BY ord').all(doc.id, model);
    await embedChunks(rows, model, progress);
  }).catch(() => {});
  return saved;
}

const inflight = new Map();

// Baixa uma norma do repositório de leis e indexa
export function ingestLaw(path) {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM docs WHERE kind = 'lei' AND ref = ? AND status = 'indexado'").get(path);
  if (existing) return Promise.resolve(existing);
  if (inflight.has(path)) return inflight.get(path);
  const p = (async () => {
    const norma = getNorma(path);
    const res = await fetch(LEIS_RAW + path.split('/').map(encodeURIComponent).join('/'), { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Não foi possível baixar ${path} (HTTP ${res.status})`);
    const { meta, body } = parseFrontMatter(await res.text());
    const title = meta.titulo || norma?.titulo || (path === 'constituicao.md' ? 'Constituição Federal de 1988' : path);
    const doc = upsertDoc('lei', path, title, {
      tipo: meta.tipo || norma?.tipo, numero: meta.numero, data: meta.data, ementa: meta.ementa || norma?.ementa,
      situacao: meta.situacao, revogada: meta.revogada, fonte: meta.fonte, uf: meta.uf || norma?.uf,
    });
    return storeChunks(doc, chunkLegal(body));
  })().finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

function chunkAny(text) {
  return /\bArt\.\s*\d/.test(text) ? chunkLegal(text) : chunkText(text);
}

export async function ingestUpload(filename, buffer) {
  const bytes = buffer.byteLength; // o pdf.js transfere (esvazia) o buffer
  const text = await extractFile(filename, buffer);
  const doc = upsertDoc('upload', `${filename}#${Date.now()}`, filename, { bytes });
  return storeChunks(doc, chunkAny(text));
}

export function ingestText(title, text) {
  const doc = upsertDoc('texto', `texto#${Date.now()}`, title, {});
  return storeChunks(doc, chunkAny(text));
}

export async function fetchPageText(url, timeout = 10000) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) IAJuridica/1.0', 'accept-language': 'pt-BR,pt' },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (type.includes('pdf')) return { title: url, text: await extractFile('x.pdf', await res.arrayBuffer()) };
  const buf = await res.arrayBuffer();
  // muitos sites governamentais (ex.: planalto.gov.br) ainda usam latin1/windows-1252
  let html = new TextDecoder('utf-8').decode(buf);
  if ((html.match(/�/g) || []).length > 3) html = new TextDecoder('windows-1252').decode(buf);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  return { title: title ? htmlToText(title) : url, text: htmlToText(html) };
}

export async function ingestUrl(url, title) {
  const { title: pageTitle, text } = await fetchPageText(url);
  const doc = upsertDoc('web', url, title || pageTitle || url, {});
  return storeChunks(doc, chunkAny(text));
}

export function deleteDoc(id) {
  getDb().prepare('DELETE FROM docs WHERE id = ?').run(id);
  vectors.loadIndex(vectors.indexModel() || getSettings().embedModel);
}

export function listDocs(kind) {
  const db = getDb();
  const sql = `SELECT d.*, (SELECT count(*) FROM chunks c WHERE c.doc_id = d.id) chunks,
    (SELECT count(*) FROM chunks c WHERE c.doc_id = d.id AND c.model = ?) embedded
    FROM docs d ${kind ? 'WHERE d.kind = ?' : ''} ORDER BY d.created_at DESC`;
  const { embedModel } = getSettings();
  return (kind ? db.prepare(sql).all(embedModel, kind) : db.prepare(sql).all(embedModel))
    .map((d) => ({ ...d, meta: JSON.parse(d.meta || '{}'), url: docSourceUrl(d) }));
}

// Reprocessa embeddings faltantes (ex.: após baixar/trocar o modelo de embedding)
export async function embedMissing() {
  const model = await embedModelReady();
  if (!model) return;
  vectors.loadIndex(model);
  const rows = getDb().prepare('SELECT id, doc_id, heading, text FROM chunks WHERE model IS NOT ? OR embedding IS NULL ORDER BY doc_id, ord').all(model);
  if (!rows.length) return;
  return enqueue(`Gerando embeddings (${rows.length} trechos)`, (progress) => embedChunks(rows, model, progress));
}

// Indexa o núcleo de leis (CF + principais códigos) na primeira execução
export function ensureCoreLaws() {
  const out = [];
  for (const c of CORE_LAWS) {
    const n = findNorma(c);
    if (!n) continue;
    out.push(ingestLaw(n.path).catch((e) => console.error(c.alias, e.message)));
  }
  return Promise.all(out);
}

export function coreStatus() {
  const db = getDb();
  return CORE_LAWS.map((c) => {
    const n = findNorma(c);
    const d = n && db.prepare("SELECT status FROM docs WHERE kind = 'lei' AND ref = ?").get(n.path);
    return { alias: c.alias, path: n?.path || null, status: d?.status || (n ? 'pendente' : 'sem catálogo') };
  });
}
