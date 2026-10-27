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

// Descarrega um modelo da memória (o Ollama só aplica opções como num_gpu ao carregar)
export async function unload(model) {
  await call('/api/generate', { method: 'POST', body: { model, keep_alive: 0 } }).catch(() => {});
}

export async function embed(model, inputs) {
  const res = await call('/api/embed', { method: 'POST', body: { model, input: inputs, truncate: true } });
  return (await res.json()).embeddings;
}

// Chat em streaming. "think" liga o modo de raciocínio de modelos como qwen3 (mais lento);
// o texto pensado não é exibido, apenas sinalizado via onThinking. Blocos <think> no conteúdo são descartados.
export async function chat({ model, messages, numCtx, format, think = false, cpuOnly, maxTokens, signal, onToken, onThinking, onReset }) {
  const options = { num_ctx: numCtx, temperature: 0.2 };
  if (cpuOnly) options.num_gpu = 0;
  if (maxTokens) options.num_predict = maxTokens;
  if (!think && /qwen3/i.test(model)) {
    // o "think: false" do Ollama nem sempre é respeitado pelo qwen3; "/no_think" é o interruptor oficial do modelo
    messages = messages.map((m, i) => (i === messages.length - 1 && m.role === 'user' ? { ...m, content: m.content + ' /no_think' } : m));
  }
  const body = { model, messages, stream: true, format, think, options };
  let res;
  try {
    res = await call('/api/chat', { method: 'POST', body, signal });
  } catch (e) {
    // modelos sem suporte a raciocínio rejeitam o parâmetro "think"
    if (!/think/i.test(e.message)) throw e;
    delete body.think;
    res = await call('/api/chat', { method: 'POST', body, signal });
  }
  let full = '';
  let inThink = false;
  let pending = '';
  let thinking = false;
  await readNdjson(res, (p) => {
    if (p.error) throw new Error(p.error);
    if (p.message?.thinking && !thinking) {
      thinking = true;
      onThinking?.();
    }
    pending += p.message?.content || '';
    // processa a parte do buffer que não pode conter uma tag incompleta
    for (;;) {
      if (inThink) {
        const end = pending.indexOf('</think>');
        if (end < 0) { pending = pending.slice(-8); return; }
        pending = pending.slice(end + 8);
        inThink = false;
      } else {
        // "</think>" sem abertura: tudo que veio antes era raciocínio — descarta e avisa o cliente
        const stray = pending.indexOf('</think>');
        if (stray >= 0) {
          pending = pending.slice(stray + 8);
          full = '';
          onReset?.();
          continue;
        }
        const start = pending.indexOf('<think>');
        if (start >= 0) {
          emit(pending.slice(0, start));
          pending = pending.slice(start + 7);
          inThink = true;
          continue;
        }
        const safe = pending.length - 8; // guarda o suficiente para não partir "</think>" ao meio
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
