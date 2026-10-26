// Gera catalog.db (índice de todas as normas do repositório ctresb/leis) a partir de um clone local.
// Uso: node scripts/build-catalog.mjs <pasta-do-clone-leis> <saida-dir>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { parseFrontMatter } from '../server/chunk.js';

const [src = '../leis', outDir = 'dist-catalog'] = process.argv.slice(2);
const SKIP_DIRS = new Set(['.git', '.github', '.githooks', 'fonte', 'scripts', 'node_modules']);
const ROOT_FILES = new Set(['constituicao.md']);

fs.mkdirSync(outDir, { recursive: true });
const dbPath = path.join(outDir, 'catalog.db');
fs.rmSync(dbPath, { force: true });
const db = new DatabaseSync(dbPath);
db.exec(`
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;
CREATE TABLE normas (
  id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, titulo TEXT, tipo TEXT, numero TEXT, data TEXT, ano INTEGER,
  ementa TEXT, situacao TEXT, revogada INTEGER, esfera TEXT, uf TEXT, municipio TEXT, orgao TEXT, tamanho INTEGER
);
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
`);
const ins = db.prepare(`INSERT INTO normas (path, titulo, tipo, numero, data, ano, ementa, situacao, revogada, esfera, uf, municipio, orgao, tamanho)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(6144);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function classify(rel) {
  const p = rel.split('/');
  switch (p[0]) {
    case 'federal': return { esfera: 'federal' };
    case 'estaduais': return { esfera: 'estadual', uf: p[1]?.toUpperCase() };
    case 'municipais': return { esfera: 'municipal', uf: p[1]?.toUpperCase(), municipio: p[2] };
    case 'reguladores': return { esfera: 'regulador', orgao: p[1] };
    case 'jurisprudencia': return { esfera: 'jurisprudencia', orgao: p[1] };
    case 'tratados': return { esfera: 'tratado' };
    default: return { esfera: 'federal' };
  }
}

let count = 0;
function* walk(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
    } else if (e.name.endsWith('.md') && !e.name.startsWith('_') && (rel || ROOT_FILES.has(e.name))) {
      yield [path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name];
    }
  }
}

db.exec('BEGIN');
for (const [file, rel] of walk(src)) {
  const size = fs.statSync(file).size;
  if (rel === 'constituicao.md') {
    ins.run(rel, 'Constituição da República Federativa do Brasil de 1988', 'Constituição', null, '1988-10-05', 1988,
      'Constituição Federal de 1988 (texto compilado com emendas).', null, 0, 'federal', null, null, null, size);
    count++;
    continue;
  }
  const { meta } = parseFrontMatter(readHead(file));
  if (!meta.titulo && !meta.tipo) continue;
  const c = classify(rel);
  const data = meta.data ? String(meta.data) : null;
  ins.run(rel, meta.titulo || path.basename(rel, '.md'), meta.tipo || null, meta.numero ? String(meta.numero) : null, data,
    data ? parseInt(data.slice(0, 4), 10) || null : null, meta.ementa || null, meta.situacao || null,
    meta.revogada === true ? 1 : 0, c.esfera, meta.uf || c.uf || null, c.municipio || null, c.orgao || null, size);
  if (++count % 20000 === 0) console.log(count, 'normas…');
}
db.exec('COMMIT');

db.exec(`
CREATE INDEX normas_num ON normas(numero, ano);
CREATE INDEX normas_filtros ON normas(esfera, uf, tipo, ano);
CREATE VIRTUAL TABLE normas_fts USING fts5(titulo, ementa, tipo, numero, content='normas', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2');
INSERT INTO normas_fts(normas_fts) VALUES ('rebuild');
INSERT INTO normas_fts(normas_fts) VALUES ('optimize');
`);
const version = new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + Date.now().toString(36);
db.prepare('INSERT INTO meta VALUES (?, ?), (?, ?)').run('version', version, 'count', String(count));
db.exec('VACUUM');
db.close();

await pipeline(fs.createReadStream(dbPath), zlib.createGzip({ level: 9 }), fs.createWriteStream(dbPath + '.gz'));
const info = { version, count, size: fs.statSync(dbPath).size, gzSize: fs.statSync(dbPath + '.gz').size, built_at: new Date().toISOString() };
fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(info, null, 2));
console.log('Catálogo pronto:', info);
