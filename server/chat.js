import { getDb, getSettings } from './db.js';
import { CORE_LAWS, ALIASES, LEIS_BLOB } from './config.js';
import { searchCatalog, findNorma } from './catalog.js';
import { ingestLaw } from './docs.js';
import { searchChunks, articleChunks } from './search.js';
import { webContext } from './web.js';
import * as llm from './llm.js';

const TIPOS = {
  'lei complementar': 'Lei Complementar', lc: 'Lei Complementar',
  'decreto-lei': 'Decreto-Lei', 'decreto lei': 'Decreto-Lei', dl: 'Decreto-Lei',
  lei: 'Lei Ordinária',
};

// Detecta referências explícitas a leis e artigos no texto
export function detectRefs(text) {
  const refs = [];
  const re = /\b(lei\s+complementar|decreto[\s-]lei|lei|lc|dl)\s*(?:federal\s*)?(?:n[º°o.]*\s*)?(\d{1,3}(?:\.\d{3})+|\d{2,6})(?:\s*(?:\/|,?\s*de)\s*(\d{4}|\d{2})\b)?/gi;
  let m;
  while ((m = re.exec(text))) {
    let ano = m[3] ? +m[3] : null;
    if (ano && ano < 100) ano += ano > 30 ? 1900 : 2000;
    refs.push({ tipo: TIPOS[m[1].toLowerCase().replace(/\s+/g, ' ')] || 'Lei Ordinária', numero: m[2].replace(/\./g, ''), ano });
  }
  const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const low = fold(text);
  for (const [k, alias] of Object.entries(ALIASES)) {
    if (new RegExp(`\\b${fold(k)}\\b`).test(low)) refs.push({ alias });
  }
  for (const c of CORE_LAWS) {
    if (low.includes(fold(c.alias))) refs.push({ alias: c.alias });
  }
  const arts = [...text.matchAll(/\bart(?:igo)?s?\.?\s*(\d+)/gi)].map((x) => x[1]);
  const incisos = [...text.matchAll(/\binc(?:iso|\.)?s?\s+([IVXLC]+)\b/gi)].map((x) => x[1].toUpperCase());
  const seen = new Set();
  return { refs: refs.filter((r) => { const k = JSON.stringify(r); return !seen.has(k) && seen.add(k); }), arts, incisos };
}

function resolveRef(ref) {
  if (ref.alias) {
    const core = CORE_LAWS.find((c) => c.alias === ref.alias);
    return core ? findNorma(core) : null;
  }
  const q = ref.ano ? `${ref.numero}/${ref.ano}` : ref.numero;
  const { items } = searchCatalog({ q, limit: 10 });
  return items.find((n) => n.esfera === 'federal' && n.tipo === ref.tipo) || items.find((n) => n.esfera === 'federal') || items[0] || null;
}

const PLAN_PROMPT = `Você planeja buscas para um assistente jurídico brasileiro. Leia a conversa e a última pergunta e responda SOMENTE com JSON no formato:
{"intencao":"responder"|"listar","busca":"...","esfera":"federal"|"estadual"|"municipal"|null,"uf":"SP"|null,"web":true|false,"consulta_web":"..."}
Exemplo: pergunta "posso devolver um produto comprado online?" →
{"intencao":"responder","busca":"direito de arrependimento compra fora do estabelecimento","esfera":"federal","uf":null,"web":false,"consulta_web":"direito de arrependimento compra online CDC art. 49"}
Regras:
- "listar": o usuário quer uma LISTA de leis/normas sobre um tema (ex.: "quais leis tratam de...", "liste as leis...").
- "busca": termos jurídicos para encontrar o texto legal relevante (sem palavras vazias).
- "web": true se envolve notícias, fatos recentes, jurisprudência, súmulas, alterações recentes/atualizações de leis, projetos de lei, ou algo que não está no texto da lei.`;

async function plan(question, history, { chatModel: model, numCtx, cpuOnly }) {
  const fallback = { intencao: /\b(liste|listar|quais (s[aã]o )?as leis|que leis)\b/i.test(question) ? 'listar' : 'responder', busca: question, web: /\b(not[ií]cia|recente|atualiza|alterad|jurisprud|s[uú]mula|stf|stj|projeto de lei|2025|2026)\b/i.test(question) };
  try {
    const ctx = history.slice(-4).map((m) => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content.slice(0, 400)}`).join('\n');
    const out = await llm.chat({
      model, numCtx, format: 'json', cpuOnly, maxTokens: 300,
      messages: [
        { role: 'system', content: PLAN_PROMPT },
        { role: 'user', content: `${ctx ? 'Conversa:\n' + ctx + '\n\n' : ''}Pergunta: ${question}` },
      ],
    });
    const p = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    const busca = typeof p.busca === 'string' && p.busca.length > 2 && !p.busca.includes('...') ? p.busca : question;
    return { ...fallback, ...p, busca, web: p.web ?? fallback.web };
  } catch {
    return fallback;
  }
}

const ANSWER_PROMPT = `Você é um assistente jurídico que responde em português do Brasil com base nas FONTES fornecidas.
- Use principalmente as fontes. Cite cada afirmação com o número da fonte entre colchetes, ex.: [1], [2].
- Ao citar artigos, mencione a lei e o artigo (ex.: "art. 49 do CDC [2]").
- Se as fontes não forem suficientes, diga claramente o que não foi encontrado; não invente números de lei ou artigos.
- Fontes da web podem estar desatualizadas ou ser opinião; sinalize isso quando relevante.
- Seja direto: responda primeiro a pergunta em 1–2 frases e depois detalhe só o necessário (em geral até ~200 palavras, a menos que o usuário peça mais).
- Ao final, lembre brevemente que a resposta é informativa e não substitui um advogado, apenas quando a pergunta for sobre um caso concreto.`;

function formatSources(sources) {
  return sources.map((s, i) => {
    const head = `[${i + 1}] ${s.title}${s.heading ? ' — ' + s.heading : ''}${s.kind === 'web' ? ' (web: ' + s.url + ')' : ''}`;
    // limita cada fonte para manter o prompt rápido de processar em CPU
    return `${head}\n${s.text.length > 1400 ? s.text.slice(0, 1400) + '…' : s.text}`;
  }).join('\n\n---\n\n');
}

function listAnswer(p, question) {
  const res = searchCatalog({ q: p.busca || question, esfera: p.esfera || undefined, uf: p.uf || undefined, limit: 25 });
  if (!res.available) return { text: 'O catálogo de leis ainda não foi baixado. Aguarde o download terminar (veja o status no rodapé).', items: [] };
  if (!res.items.length) return { text: `Não encontrei normas no catálogo para "${p.busca}". Tente outros termos na aba **Leis**.`, items: [] };
  const lines = res.items.map((n) => {
    const st = n.revogada ? ' _(revogada)_' : '';
    return `- **${n.titulo}**${st}${n.ementa ? ' — ' + n.ementa : ''}`;
  });
  return {
    text: `Encontrei **${res.total}** norma(s) para "${p.busca}"${res.total > res.items.length ? ` (mostrando ${res.items.length})` : ''}:\n\n${lines.join('\n')}\n\nVocê pode abrir qualquer uma na aba **Leis** ou me perguntar sobre ela.`,
    items: res.items,
  };
}

export async function answer({ conversationId, question, webOverride }, send, signal) {
  const db = getDb();
  const settings = getSettings();
  const model = settings.chatModel;

  if (!conversationId) {
    conversationId = db.prepare('INSERT INTO conversations(title) VALUES (?)').run(question.slice(0, 80)).lastInsertRowid;
  }
  send('conversation', { id: Number(conversationId) });
  const history = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id').all(conversationId);
  db.prepare('INSERT INTO messages(conversation_id, role, content) VALUES (?, ?, ?)').run(conversationId, 'user', question);

  send('status', 'Entendendo a pergunta…');
  const p = await plan(question, history, settings);
  send('plan', p);

  if (p.intencao === 'listar') {
    const { text, items } = listAnswer(p, question);
    const sources = items.map((n, i) => ({ n: i + 1, kind: 'catalogo', title: n.titulo, ref: n.path, text: n.ementa || '', url: LEIS_BLOB + n.path }));
    send('sources', sources);
    send('token', text);
    db.prepare('INSERT INTO messages(conversation_id, role, content, sources) VALUES (?, ?, ?, ?)').run(conversationId, 'assistant', text, JSON.stringify(sources));
    send('done', { sources });
    return;
  }

  // 1) Leis citadas explicitamente → garante que estão indexadas
  const { refs, arts, incisos } = detectRefs(question);
  const lawDocs = [];
  const seen = new Set();
  for (const ref of refs.slice(0, 4)) {
    const n = resolveRef(ref);
    if (!n || seen.has(n.path)) continue;
    seen.add(n.path);
    send('status', `Consultando ${n.titulo}…`);
    try {
      lawDocs.push(await ingestLaw(n.path));
    } catch (e) {
      send('status', `Falha ao baixar ${n.titulo}: ${e.message}`);
    }
  }

  // 2) Normas do catálogo relacionadas ao tema, baixadas sob demanda
  if (!lawDocs.length) {
    const cat = searchCatalog({ q: p.busca, esfera: p.esfera || 'federal', uf: p.uf || undefined, limit: 3 });
    for (const n of cat.items.slice(0, 2)) {
      if (n.revogada) continue;
      const known = db.prepare("SELECT 1 FROM docs WHERE kind = 'lei' AND ref = ? AND status = 'indexado'").get(n.path);
      if (known) continue;
      send('status', `Baixando ${n.titulo}…`);
      try { await ingestLaw(n.path); } catch {}
    }
  }

  send('status', 'Buscando trechos relevantes…');
  const query = `${p.busca} ${question}`;
  let chunks = [];
  for (const d of lawDocs) {
    if (arts.length) chunks.push(...articleChunks(d.id, arts, incisos));
    chunks.push(...await searchChunks(query, { k: arts.length ? 2 : 4, docIds: [d.id] }));
  }
  chunks.push(...await searchChunks(query, { k: 6 }));
  const uniq = new Map();
  for (const c of chunks) if (!uniq.has(c.id)) uniq.set(c.id, c);
  let sources = [...uniq.values()].slice(0, 5);

  // 3) Internet — também quando a lei citada veio incompleta do repositório (ex.: só a parte vetada/retificação)
  const countChunks = db.prepare('SELECT count(*) c FROM chunks WHERE doc_id = ?');
  const thin = lawDocs.filter((d) => countChunks.get(d.id).c < 8);
  const wantWeb = webOverride ?? (settings.webMode === 'sempre' || (settings.webMode === 'auto' && (p.web || thin.length > 0)));
  if (wantWeb) {
    send('status', thin.length ? `Texto de ${thin[0].title} parece incompleto na base — buscando na internet…` : 'Pesquisando na internet…');
    try {
      const cw = typeof p.consulta_web === 'string' && p.consulta_web.length > 8 && !/\.\.\.|buscador/i.test(p.consulta_web) ? p.consulta_web : null;
      const web = await webContext(thin.length ? `${thin[0].title} ${p.busca} planalto` : cw || `${p.busca} legislação`);
      sources.push(...web.map((w) => ({ kind: 'web', title: w.title, url: w.url, text: w.text })));
    } catch (e) {
      send('status', `Busca na internet indisponível: ${e.message}`);
    }
  }

  sources = sources.map((s, i) => ({ n: i + 1, ...s }));
  send('sources', sources);
  send('status', sources.length ? 'Escrevendo resposta…' : 'Nenhuma fonte encontrada, respondendo com cautela…');

  const messages = [
    { role: 'system', content: ANSWER_PROMPT },
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: `FONTES:\n\n${sources.length ? formatSources(sources) : '(nenhuma fonte encontrada)'}\n\nPERGUNTA: ${question}` },
  ];
  const text = await llm.chat({
    model, messages, numCtx: settings.numCtx, think: settings.think, cpuOnly: settings.cpuOnly, signal,
    onThinking: () => send('status', 'Raciocinando antes de responder…'),
    onReset: () => send('reset', null),
    onToken: (t) => send('token', t),
  });
  db.prepare('INSERT INTO messages(conversation_id, role, content, sources) VALUES (?, ?, ?, ?)')
    .run(conversationId, 'assistant', text, JSON.stringify(sources));
  send('done', { sources });
}
