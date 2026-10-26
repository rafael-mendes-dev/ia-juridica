import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { api, streamChat } from './api.js';

function renderMarkdown(md) {
  const safe = md.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = marked.parse(safe, { async: false, breaks: true });
  return html.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g, (_, nums) =>
    nums.split(',').map((n) => `<sup class="cite" data-n="${n.trim()}">${n.trim()}</sup>`).join(''));
}

const EXAMPLES = [
  'Qual o prazo para desistir de uma compra feita pela internet?',
  'O que diz o art. 5º da Constituição sobre liberdade de expressão?',
  'Liste as leis federais sobre proteção de dados',
  'Houve alterações recentes na Lei Maria da Penha?',
];

export default function Chat({ status }) {
  const [convs, setConvs] = useState([]);
  const [convId, setConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [web, setWeb] = useState('auto');
  const [active, setActive] = useState(null); // índice da mensagem cujas fontes estão abertas
  const [hl, setHl] = useState(null);
  const abortRef = useRef(null);
  const endRef = useRef(null);

  const loadConvs = () => api('/conversations').then(setConvs).catch(() => {});
  useEffect(() => { loadConvs(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  async function openConv(id) {
    setConvId(id);
    const msgs = await api(`/conversations/${id}`);
    setMessages(msgs);
    const last = msgs.map((m, i) => (m.sources?.length ? i : -1)).filter((i) => i >= 0).pop();
    setActive(last ?? null);
  }

  function newConv() {
    abortRef.current?.abort();
    setConvId(null);
    setMessages([]);
    setActive(null);
  }

  async function delConv(id, e) {
    e.stopPropagation();
    await api(`/conversations/${id}`, { method: 'DELETE' });
    if (id === convId) newConv();
    loadConvs();
  }

  async function send(text) {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    setInput('');
    setBusy(true);
    const idx = messages.length + 1;
    setMessages((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '', sources: [], status: '…' }]);
    setActive(idx);
    const update = (fn) => setMessages((m) => m.map((x, i) => (i === idx ? fn(x) : x)));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamChat(
        { conversationId: convId, question, webOverride: web === 'auto' ? undefined : web === 'sim' },
        (ev, data) => {
          if (ev === 'conversation') setConvId(data.id);
          else if (ev === 'status') update((x) => ({ ...x, status: data }));
          else if (ev === 'sources') update((x) => ({ ...x, sources: data }));
          else if (ev === 'token') update((x) => ({ ...x, content: x.content + data, status: null }));
          else if (ev === 'error') update((x) => ({ ...x, error: data, status: null }));
          else if (ev === 'done') update((x) => ({ ...x, status: null }));
        },
        ctrl.signal,
      );
    } catch (e) {
      if (e.name !== 'AbortError') update((x) => ({ ...x, error: e.message, status: null }));
    } finally {
      update((x) => ({ ...x, status: null }));
      setBusy(false);
      loadConvs();
    }
  }

  function onCiteClick(e, i) {
    const el = e.target.closest('.cite');
    if (!el) return;
    setActive(i);
    const n = +el.dataset.n;
    setHl(n);
    setTimeout(() => document.getElementById(`src-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  const sources = active != null ? messages[active]?.sources || [] : [];

  return (
    <div className="chat">
      <aside className="convs">
        <button className="primary block" onClick={newConv}>+ Nova conversa</button>
        <div className="list">
          {convs.map((c) => (
            <div key={c.id} className={'conv' + (c.id === convId ? ' active' : '')} onClick={() => openConv(c.id)}>
              <span>{c.title}</span>
              <button className="ghost x" title="Apagar" onClick={(e) => delConv(c.id, e)}>×</button>
            </div>
          ))}
        </div>
      </aside>

      <section className="thread">
        <div className="messages">
          {!messages.length && (
            <div className="empty">
              <h2>Pergunte sobre a legislação brasileira</h2>
              <p>As respostas citam os trechos das leis usados como base. Tudo roda no seu computador.</p>
              <div className="examples">
                {EXAMPLES.map((e) => <button key={e} onClick={() => send(e)} disabled={!status?.ollama.version}>{e}</button>)}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.role === 'user' ? <div className="bubble">{m.content}</div> : (
                <div className="bubble" onClick={(e) => onCiteClick(e, i)}>
                  {m.status && <div className="thinking"><span className="spinner" /> {m.status}</div>}
                  {m.content && <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />}
                  {m.error && <div className="error">⚠️ {m.error}</div>}
                  {!!m.sources?.length && (
                    <button className="link small" onClick={() => setActive(i)}>
                      📎 {m.sources.length} fonte(s){active === i ? ' (exibindo)' : ''}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            value={input}
            placeholder="Digite sua pergunta jurídica…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
          />
          <div className="composer-bar">
            <label className="web-toggle" title="Pesquisa na internet">
              🌐
              <select value={web} onChange={(e) => setWeb(e.target.value)}>
                <option value="auto">Internet: automático</option>
                <option value="sim">Internet: sempre</option>
                <option value="nao">Internet: nunca</option>
              </select>
            </label>
            <span className="muted small">Modelo: {status?.settings.chatModel}</span>
            <div className="grow" />
            {busy
              ? <button type="button" onClick={() => abortRef.current?.abort()}>Parar</button>
              : <button className="primary" disabled={!input.trim()}>Enviar</button>}
          </div>
        </form>
      </section>

      <aside className="sources">
        <h3>Fontes</h3>
        {!sources.length && <p className="muted small">Os trechos usados na resposta aparecem aqui.</p>}
        {sources.map((s) => <SourceCard key={s.n} s={s} hl={hl === s.n} />)}
      </aside>
    </div>
  );
}

function SourceCard({ s, hl }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const kindLabel = { lei: 'Lei', upload: 'Arquivo', texto: 'Texto', web: 'Web', catalogo: 'Catálogo' }[s.kind] || s.kind;
  async function save() {
    await api('/docs/url', { method: 'POST', body: { url: s.url, title: s.title } });
    setSaved(true);
  }
  return (
    <div id={`src-${s.n}`} className={'source' + (hl ? ' hl' : '')}>
      <div className="source-head">
        <span className="num">{s.n}</span>
        <span className={`tag ${s.kind}`}>{kindLabel}</span>
        <b>{s.title}</b>
      </div>
      {s.heading && <div className="heading">{s.heading}</div>}
      {s.text && <div className={'excerpt' + (open ? ' open' : '')} onClick={() => setOpen(!open)}>{s.text}</div>}
      <div className="source-actions">
        {s.url && <a href={s.url} target="_blank" rel="noreferrer">Abrir original ↗</a>}
        {s.kind === 'web' && (saved ? <span className="muted small">Salvo na base ✓</span> : <button className="link small" onClick={save}>Salvar na base</button>)}
      </div>
    </div>
  );
}
