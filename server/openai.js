// Cliente mínimo da API da OpenAI (chat em streaming e embeddings), sem dependências
const API = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

// modelos de raciocínio (gpt-5, o1, o3, o4…) não aceitam temperature e gastam tokens pensando
const REASONING = /^(gpt-5|o\d)/i;

async function call(key, pathname, body, signal) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + pathname, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (res.ok) return res;
    const txt = await res.text().catch(() => '');
    let err = {};
    try { err = JSON.parse(txt).error || {}; } catch {}
    // limite de requisições: espera e tenta de novo
    if ((res.status === 429 && err.code !== 'insufficient_quota') || res.status >= 500) {
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
        continue;
      }
    }
    // parâmetro não suportado pelo modelo: remove e tenta de novo
    if (res.status === 400 && body && err.param && err.param in body && attempt < 4) {
      body = { ...body };
      delete body[err.param];
      continue;
    }
    const msg = res.status === 401 ? 'chave da OpenAI inválida'
      : err.code === 'insufficient_quota' ? 'sem créditos na conta da OpenAI'
      : err.message || txt || res.statusText;
    throw new Error(`OpenAI ${res.status}: ${msg}`);
  }
}

// Valida a chave listando os modelos disponíveis
export async function checkKey(key) {
  const res = await call(key, '/models', null, AbortSignal.timeout(15000));
  const { data = [] } = await res.json();
  return data.map((m) => m.id);
}

export async function embed(key, model, inputs) {
  const res = await call(key, '/embeddings', { model, input: inputs });
  const { data } = await res.json();
  return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function chat({ key, model, messages, format, think = false, maxTokens, signal, onToken, onThinking }) {
  const reasoning = REASONING.test(model);
  const body = { model, messages, stream: true };
  if (format === 'json') body.response_format = { type: 'json_object' };
  if (reasoning) {
    body.reasoning_effort = think ? 'medium' : 'low';
    onThinking?.();
  } else {
    body.temperature = 0.2;
    if (maxTokens) body.max_completion_tokens = maxTokens;
  }
  const res = await call(key, '/chat/completions', body, signal);
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for await (const part of res.body) {
    buf += decoder.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return full;
      const t = JSON.parse(data).choices?.[0]?.delta?.content;
      if (t) {
        full += t;
        onToken?.(t);
      }
    }
  }
  return full;
}
