import { getDb } from './db.js';

// Índice vetorial em memória (busca exata por produto interno de vetores normalizados).
// Para dezenas/centenas de milhares de trechos isso leva poucos milissegundos.
let model = null;
let dim = 0;
let ids = new Int32Array(0);
let vecs = new Float32Array(0);
let count = 0;

export function normalize(v) {
  const out = Float32Array.from(v);
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i] * out[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

export function toBlob(vec) {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

function fromBlob(blob) {
  const b = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

export function loadIndex(embedModel) {
  model = embedModel;
  count = 0;
  dim = 0;
  ids = new Int32Array(0);
  vecs = new Float32Array(0);
  const rows = getDb().prepare('SELECT id, embedding FROM chunks WHERE model = ? AND embedding IS NOT NULL').iterate(embedModel);
  for (const r of rows) add(r.id, fromBlob(r.embedding));
}

export function add(id, vec) {
  if (!dim) dim = vec.length;
  if (vec.length !== dim) return;
  if ((count + 1) * dim > vecs.length) {
    const cap = Math.max(1024, (count + 1) * 2);
    const nv = new Float32Array(cap * dim);
    nv.set(vecs.subarray(0, count * dim));
    vecs = nv;
    const ni = new Int32Array(cap);
    ni.set(ids.subarray(0, count));
    ids = ni;
  }
  vecs.set(vec, count * dim);
  ids[count++] = id;
}

export function indexModel() {
  return model;
}

export function size() {
  return count;
}

export function search(query, k = 8, allowed) {
  if (!count || query.length !== dim) return [];
  const top = [];
  for (let i = 0; i < count; i++) {
    if (allowed && !allowed.has(ids[i])) continue;
    let s = 0;
    const off = i * dim;
    for (let j = 0; j < dim; j++) s += vecs[off + j] * query[j];
    if (top.length < k) {
      top.push({ id: ids[i], score: s });
      top.sort((a, b) => b.score - a.score);
    } else if (s > top[k - 1].score) {
      top[k - 1] = { id: ids[i], score: s };
      top.sort((a, b) => b.score - a.score);
    }
  }
  return top;
}
