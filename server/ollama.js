import { OLLAMA_URL } from './config.js';

async function call(pathname, { method = 'GET', body, signal } = {}) {
  const res = await fetch(OLLAMA_URL + pathname, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    let msg = txt;
    try { msg = JSON.parse(txt).error || txt; } catch {}
    throw new Error(`Ollama ${res.status}: ${msg}`);
  }
  return res;
}

// Lê uma resposta NDJSON (streaming do Ollama) chamando onLine para cada objeto
async function readNdjson(res, onLine) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const part of res.body) {
    buf += decoder.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) await onLine(JSON.parse(line));
    }
  }
  if (buf.trim()) await onLine(JSON.parse(buf));
}

export async function version() {
  try {
    const res = await call('/api/version', { signal: AbortSignal.timeout(2000) });
    return (await res.json()).version;
  } catch {
    return null;
  }
}

export async function listModels() {
  const res = await call('/api/tags');
  const { models = [] } = await res.json();
  return models.map((m) => ({
    name: m.name,
    size: m.size,
    modified: m.modified_at,
    family: m.details?.family,
    params: m.details?.parameter_size,
    quant: m.details?.quantization_level,
  }));
}

export async function pull(model, onProgress, signal) {
  const res = await call('/api/pull', { method: 'POST', body: { model, stream: true }, signal });
  await readNdjson(res, (p) => {
    if (p.error) throw new Error(p.error);
    onProgress(p);
  });
}

export async function remove(model) {
  await call('/api/delete', { method: 'DELETE', body: { model } });
}

export async function embed(model, inputs) {
  const res = await call('/api/embed', { method: 'POST', body: { model, input: inputs, truncate: true } });
  return (await res.json()).embeddings;
}

// Chat em streaming; descarta blocos <think> de modelos de raciocínio
export async function chat({ model, messages, numCtx, format, signal, onToken }) {
  const res = await call('/api/chat', {
    method: 'POST',
    body: { model, messages, stream: true, format, options: { num_ctx: numCtx, temperature: 0.2 } },
    signal,
  });
  let full = '';
  let inThink = false;
  let pending = '';
  await readNdjson(res, (p) => {
    if (p.error) throw new Error(p.error);
    pending += p.message?.content || '';
    // processa a parte do buffer que não pode conter uma tag incompleta
    for (;;) {
      if (inThink) {
        const end = pending.indexOf('</think>');
        if (end < 0) { pending = pending.slice(-8); return; }
        pending = pending.slice(end + 8);
        inThink = false;
      } else {
        const start = pending.indexOf('<think>');
        if (start >= 0) {
          emit(pending.slice(0, start));
          pending = pending.slice(start + 7);
          inThink = true;
          continue;
        }
        const safe = pending.length - 7;
        if (safe > 0) {
          emit(pending.slice(0, safe));
          pending = pending.slice(safe);
        }
        return;
      }
    }
  });
  if (!inThink) emit(pending);
  return full;

  function emit(t) {
    if (!t) return;
    if (!full) t = t.replace(/^\s+/, '');
    if (!t) return;
    full += t;
    onToken?.(t);
  }
}
