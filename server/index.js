import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { resolvePaths, RECOMMENDED, OPENAI_MODELS, DEFAULT_SETTINGS, LEIS_RAW, DEFAULT_PORT, APP_REPO } from './config.js';
import { openDb, getDb, getSettings, setSettings, hasCatalog } from './db.js';
import { searchCatalog, catalogFacets, getNorma, updateCatalog, catalogState } from './catalog.js';
import { parseFrontMatter } from './chunk.js';
import * as docs from './docs.js';
import * as ollama from './ollama.js';
import * as openai from './openai.js';
import * as llm from './llm.js';
import * as vectors from './vectors.js';
import { answer } from './chat.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

const pulls = {};

// Configurações enviadas ao front: a chave da OpenAI aparece apenas mascarada
function publicSettings() {
  const { openaiKey, ...s } = getSettings();
  return { ...s, openaiKey: openaiKey ? `${openaiKey.slice(0, 7)}…${openaiKey.slice(-4)}` : '' };
}

function applySettings(patch) {
  const before = getSettings();
  const s = setSettings(patch);
  if (s.cpuOnly !== before.cpuOnly && !llm.isOpenAI(s.chatModel)) ollama.unload(s.chatModel);
  if (s.embedModel !== before.embedModel) {
    vectors.loadIndex(s.embedModel);
    docs.embedMissing().catch(() => {});
  }
  return s;
}

export async function start({ dataDir, webDir, port = DEFAULT_PORT, version = 'dev', onReady } = {}) {
  const paths = resolvePaths(dataDir);
  openDb(paths);
  vectors.loadIndex(getSettings().embedModel);

  const app = new Hono();

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true, app: 'ia-juridica', version }));

  app.get('/api/status', async (c) => c.json({
    version,
    repo: APP_REPO,
    ollama: { version: await ollama.version() },
    openai: { key: !!getSettings().openaiKey },
    catalog: { ...catalogState, available: hasCatalog() },
    jobs: { current: docs.jobs.current, pending: docs.jobs.queue.length, errors: docs.jobs.log.slice(0, 5) },
    core: docs.coreStatus(),
    vectors: vectors.size(),
    pulls,
    settings: publicSettings(),
    system: { ram: os.totalmem(), cpus: os.cpus().length },
  }));

  app.get('/api/settings', (c) => c.json(publicSettings()));
  app.put('/api/settings', async (c) => {
    const { openaiKey, ...patch } = await c.req.json(); // a chave só muda pela rota própria
    applySettings(patch);
    return c.json(publicSettings());
  });

  // ---- Chave da OpenAI (fica só no banco local) ----
  app.put('/api/openai/key', async (c) => {
    const key = String((await c.req.json()).key || '').trim();
    if (!key) return c.json({ error: 'Informe a chave.' }, 400);
    try {
      await openai.checkKey(key);
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
    setSettings({ openaiKey: key });
    if (llm.isOpenAI(getSettings().embedModel)) docs.embedMissing().catch(() => {});
    return c.json(publicSettings());
  });
  app.delete('/api/openai/key', (c) => {
    // sem chave, volta para os modelos locais padrão
    const s = getSettings();
    applySettings({
      ...(llm.isOpenAI(s.chatModel) ? { chatModel: DEFAULT_SETTINGS.chatModel } : {}),
      ...(llm.isOpenAI(s.embedModel) ? { embedModel: DEFAULT_SETTINGS.embedModel } : {}),
    });
    setSettings({ openaiKey: '' });
    return c.json(publicSettings());
  });

  // ---- Modelos (Ollama) ----
  app.get('/api/models', async (c) => {
    let installed = [];
    let error = null;
    try { installed = await ollama.listModels(); } catch (e) { error = e.message; }
    return c.json({ installed, recommended: RECOMMENDED, openai: OPENAI_MODELS, pulls, error });
  });

  app.post('/api/models/pull', async (c) => {
    const { name } = await c.req.json();
    if (!name) return c.json({ error: 'Nome do modelo obrigatório' }, 400);
    if (pulls[name]?.state === 'baixando') return c.json(pulls[name]);
    pulls[name] = { state: 'baixando', status: 'iniciando', completed: 0, total: 0 };
    const layers = {};
    ollama.pull(name, (p) => {
      // o Ollama reporta o progresso por camada (digest); somamos todas
      if (p.digest && p.total) layers[p.digest] = { total: p.total, completed: p.completed || 0 };
      const all = Object.values(layers);
      Object.assign(pulls[name], {
        status: p.status,
        total: all.reduce((s, l) => s + l.total, 0),
        completed: all.reduce((s, l) => s + l.completed, 0),
      });
    }).then(() => {
      pulls[name] = { state: 'ok', status: 'concluído' };
      if (name.split(':')[0] === getSettings().embedModel.split(':')[0]) docs.embedMissing().catch(() => {});
    }).catch((e) => {
      pulls[name] = { state: 'erro', status: e.message };
    });
    return c.json(pulls[name]);
  });

  app.delete('/api/models/:name', async (c) => {
    await ollama.remove(c.req.param('name'));
    return c.json({ ok: true });
  });

  // ---- Chat ----
  app.post('/api/chat', async (c) => {
    const body = await c.req.json();
    return streamSSE(c, async (stream) => {
      const ctrl = new AbortController();
      stream.onAbort(() => ctrl.abort());
      // escritas enfileiradas: o pipeline não aguarda cada envio, então esperamos a fila antes de fechar o stream
      let queue = Promise.resolve();
      const send = (event, data) => {
        queue = queue.then(() => stream.writeSSE({ event, data: JSON.stringify(data) })).catch(() => {});
        return queue;
      };
      try {
        await answer(body, send, ctrl.signal);
      } catch (e) {
        if (!ctrl.signal.aborted) {
          console.error('Chat:', e);
          send('error', e.message);
        }
      }
      await queue;
    });
  });

  app.get('/api/conversations', (c) => c.json(
    getDb().prepare('SELECT * FROM conversations ORDER BY id DESC LIMIT 200').all(),
  ));
  app.get('/api/conversations/:id', (c) => {
    const rows = getDb().prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id').all(c.req.param('id'));
    return c.json(rows.map((m) => ({ ...m, sources: JSON.parse(m.sources || '[]') })));
  });
  app.delete('/api/conversations/:id', (c) => {
    getDb().prepare('DELETE FROM conversations WHERE id = ?').run(c.req.param('id'));
    return c.json({ ok: true });
  });

  // ---- Catálogo de leis ----
  app.get('/api/leis', (c) => {
    const q = c.req.query();
    const limit = 30;
    const page = Math.max(1, +q.page || 1);
    const res = searchCatalog({ q: q.q || '', tipo: q.tipo, esfera: q.esfera, uf: q.uf, ano: q.ano, limit, offset: (page - 1) * limit });
    const indexed = new Set(getDb().prepare("SELECT ref FROM docs WHERE kind = 'lei' AND status = 'indexado'").all().map((r) => r.ref));
    return c.json({ ...res, page, items: res.items.map((n) => ({ ...n, indexado: indexed.has(n.path) })) });
  });
  app.get('/api/leis/facets', (c) => c.json(catalogFacets()));
  app.get('/api/leis/texto', async (c) => {
    const p = c.req.query('path');
    if (!p || p.includes('..')) return c.json({ error: 'caminho inválido' }, 400);
    const res = await fetch(LEIS_RAW + p.split('/').map(encodeURIComponent).join('/'));
    if (!res.ok) return c.json({ error: `HTTP ${res.status}` }, 502);
    const { meta, body } = parseFrontMatter(await res.text());
    return c.json({ meta: { ...getNorma(p), ...meta }, body });
  });
  app.post('/api/leis/indexar', async (c) => {
    const { path: p } = await c.req.json();
    return c.json(await docs.ingestLaw(p));
  });
  app.post('/api/catalog/update', async (c) => {
    updateCatalog(paths, { force: true }).then(() => hasCatalog() && docs.ensureCoreLaws());
    return c.json(catalogState);
  });

  // ---- Base de conhecimento do usuário ----
  app.get('/api/docs', (c) => c.json(docs.listDocs(c.req.query('kind'))));
  app.get('/api/docs/:id/chunks', (c) => c.json(
    getDb().prepare('SELECT id, ord, heading, text, model IS NOT NULL embedded FROM chunks WHERE doc_id = ? ORDER BY ord').all(c.req.param('id')),
  ));
  app.delete('/api/docs/:id', (c) => {
    docs.deleteDoc(+c.req.param('id'));
    return c.json({ ok: true });
  });
  app.post('/api/docs/upload', async (c) => {
    const form = await c.req.parseBody({ all: true });
    const files = [form.files].flat().filter((f) => f && typeof f === 'object');
    const out = [];
    for (const f of files) {
      try {
        out.push(await docs.ingestUpload(f.name, await f.arrayBuffer()));
      } catch (e) {
        out.push({ title: f.name, status: 'erro', error: e.message });
      }
    }
    return c.json(out);
  });
  app.post('/api/docs/texto', async (c) => {
    const { title, text } = await c.req.json();
    if (!text?.trim()) return c.json({ error: 'Texto vazio' }, 400);
    return c.json(docs.ingestText(title?.trim() || text.trim().slice(0, 60), text));
  });
  app.post('/api/docs/url', async (c) => {
    const { url, title } = await c.req.json();
    return c.json(await docs.ingestUrl(url, title));
  });

  // ---- Front-end estático (produção) ----
  if (webDir && fs.existsSync(webDir)) {
    app.get('*', (c) => {
      let rel = decodeURIComponent(new URL(c.req.url).pathname);
      let file = path.join(webDir, rel);
      if (!file.startsWith(webDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(webDir, 'index.html');
      }
      const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' };
      if (rel.startsWith('/assets/')) headers['cache-control'] = 'public, max-age=31536000, immutable';
      return c.body(fs.readFileSync(file), 200, headers);
    });
  }

  const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
    console.log(`IA Jurídica rodando em http://localhost:${info.port}`);
    onReady?.(info);
  });

  // Tarefas de inicialização: catálogo → núcleo de leis → embeddings pendentes
  (async () => {
    await updateCatalog(paths);
    if (hasCatalog()) await docs.ensureCoreLaws();
    await docs.embedMissing();
  })().catch((e) => console.error('Inicialização:', e.message));
  // verifica novas versões do catálogo (catalog.json é pequeno); ao chegar a primeira, indexa o núcleo
  setInterval(async () => {
    const had = hasCatalog();
    await updateCatalog(paths).catch(() => {});
    if (!had && hasCatalog()) docs.ensureCoreLaws().then(() => docs.embedMissing()).catch(() => {});
  }, 30 * 60e3).unref();

  return server;
}
