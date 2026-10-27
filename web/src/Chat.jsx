import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import {
  ArrowUp, BookOpen, ExternalLink, FileText, Globe, Library, PanelRightClose, PanelRightOpen,
  Quote, Scale, Search, ShieldCheck, Square, BookmarkPlus, Check,
} from 'lucide-react';
import { api, streamChat } from './api.js';
import { Segmented, Spinner } from './ui.jsx';

function renderMarkdown(md) {
  const safe = md.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = marked.parse(safe, { async: false, breaks: true });
  return html.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g, (_, nums) =>
    nums.split(',').map((n) => `<button type="button" class="cite" data-n="${n.trim()}">${n.trim()}</button>`).join(''));
}

const EXAMPLES = [
  [ShieldCheck, 'Direito do consumidor', 'Qual o prazo para desistir de uma compra feita pela internet?'],
  [Scale, 'Constituição', 'O que diz o art. 5º, inciso XI, da Constituição?'],
  [Library, 'Pesquisa de normas', 'Liste as leis federais sobre proteção de dados'],
  [Globe, 'Atualizações', 'Houve alterações recentes na Lei Maria da Penha?'],
];

// remove marcações markdown dos trechos exibidos (negrito, itálico, títulos)
function plain(t) {
  return t.replace(/\*\*|__/g, '').replace(/^#{1,6}\s+/gm, '').replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2');
}

const KIND = { lei: 'Lei', upload: 'Arquivo', texto: 'Texto', web: 'Web', catalogo: 'Catálogo' };
const KIND_ICON = { lei: BookOpen, upload: FileText, texto: FileText, web: Globe, catalogo: Library };

export default function Chat({ status, convId, setConvId, onConvsChanged }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [web, setWeb] = useState('auto');
  const [active, setActive] = useState(null); // mensagem cujas fontes estão no painel
  const [hl, setHl] = useState(null);
  const [panel, setPanel] = useState(true);
  const abortRef = useRef(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const ownConv = useRef(null); // conversa criada por este envio (não recarregar)

  useEffect(() => {
    if (convId && convId === ownConv.current) return;
    ownConv.current = null;
    abortRef.current?.abort();
    if (!convId) {
      setMessages([]);
      setActive(null);
      return;
    }
    api(`/conversations/${convId}`).then((msgs) => {
      setMessages(msgs);
      const last = msgs.map((m, i) => (m.sources?.length ? i : -1)).filter((i) => i >= 0).pop();
      setActive(last ?? null);
    });
  }, [convId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
  }, [input]);

  async function send(text) {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    setInput('');
    setBusy(true);
    const idx = messages.length + 1;
    setMessages((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '', sources: [], status: 'Iniciando…' }]);
    setActive(idx);
    const update = (fn) => setMessages((m) => m.map((x, i) => (i === idx ? fn(x) : x)));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamChat(
        { conversationId: convId, question, webOverride: web === 'auto' ? undefined : web === 'sim' },
        (ev, data) => {
          if (ev === 'conversation') { ownConv.current = data.id; setConvId(data.id); }
          else if (ev === 'status') update((x) => ({ ...x, status: data }));
          else if (ev === 'sources') update((x) => ({ ...x, sources: data }));
          else if (ev === 'token') update((x) => ({ ...x, content: x.content + data, status: null }));
          else if (ev === 'reset') update((x) => ({ ...x, content: '' }));
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
      onConvsChanged();
    }
  }

  function onCiteClick(e, i) {
    const el = e.target.closest('.cite');
    if (!el) return;
    setActive(i);
    setPanel(true);
    const n = +el.dataset.n;
    setHl(n);
    setTimeout(() => document.getElementById(`src-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  }

  const sources = active != null ? messages[active]?.sources || [] : [];
  const ready = !!status?.ollama.version;

  return (
    <div className={'chat' + (panel && sources.length ? ' with-panel' : '')}>
      <section className="thread">
        <div className="thread-top">
          {!!sources.length && (
            <button className="icon-btn" title={panel ? 'Ocultar fontes' : 'Mostrar fontes'} onClick={() => setPanel(!panel)}>
              {panel ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>
          )}
        </div>

        <div className="messages">
          <div className="column">
            {!messages.length && (
              <div className="welcome">
                <div className="welcome-mark"><Scale size={22} /></div>
                <h1>Como posso ajudar?</h1>
                <p>Pergunte sobre a legislação brasileira. Cada resposta indica os trechos de lei usados como base.</p>
                <div className="examples">
                  {EXAMPLES.map(([Icon, label, q]) => (
                    <button key={q} className="example" onClick={() => send(q)} disabled={!ready}>
                      <Icon size={16} />
                      <span className="example-label">{label}</span>
                      <span className="example-q">{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              m.role === 'user' ? (
                <div key={i} className="msg msg-user"><div className="bubble">{m.content}</div></div>
              ) : (
                <div key={i} className="msg msg-ai">
                  <div className="avatar"><Scale size={14} /></div>
                  <div className="msg-body" onClick={(e) => onCiteClick(e, i)}>
                    {m.status && <div className="msg-status"><Spinner /> {m.status}</div>}
                    {m.content && <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />}
                    {m.error && <div className="msg-error">{m.error}</div>}
                    {!!m.sources?.length && !m.status && (
                      <button className={'sources-chip' + (active === i && panel ? ' on' : '')} onClick={() => { setActive(i); setPanel(true); }}>
                        <Quote size={13} />
                        {m.sources.length} {m.sources.length === 1 ? 'fonte' : 'fontes'}
                        <span className="sources-chip-names">
                          {[...new Set(m.sources.map((s) => s.title))].slice(0, 2).join(' · ')}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )
            ))}
            <div ref={endRef} />
          </div>
        </div>

        <div className="composer-wrap">
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea
              ref={inputRef}
              value={input}
              placeholder="Pergunte sobre leis, artigos, prazos, direitos…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
            />
            <div className="composer-bar">
              <div className="composer-web" title="Pesquisa na internet">
                <Globe size={14} />
                <Segmented value={web} onChange={setWeb} options={[['auto', 'Auto'], ['sim', 'Sempre'], ['nao', 'Nunca']]} />
              </div>
              <span className="composer-model">{status?.settings.chatModel}</span>
              {busy ? (
                <button type="button" className="send-btn stop" title="Parar" onClick={() => abortRef.current?.abort()}><Square size={14} fill="currentColor" /></button>
              ) : (
                <button className="send-btn" title="Enviar" disabled={!input.trim() || !ready}><ArrowUp size={18} /></button>
              )}
            </div>
          </form>
          <p className="composer-note">Respostas informativas geradas localmente. Confira sempre a publicação oficial.</p>
        </div>
      </section>

      {panel && !!sources.length && (
        <aside className="sources">
          <div className="sources-head">
            <Search size={15} />
            <span>Fontes consultadas</span>
            <span className="count">{sources.length}</span>
          </div>
          <div className="sources-list">
            {sources.map((s) => <SourceCard key={s.n} s={s} hl={hl === s.n} />)}
          </div>
        </aside>
      )}
    </div>
  );
}

function SourceCard({ s, hl }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const Icon = KIND_ICON[s.kind] || FileText;
  async function save() {
    await api('/docs/url', { method: 'POST', body: { url: s.url, title: s.title } });
    setSaved(true);
  }
  return (
    <article id={`src-${s.n}`} className={'source' + (hl ? ' hl' : '')}>
      <div className="source-head">
        <span className="source-n">{s.n}</span>
        <div className="source-titles">
          <div className="source-title">{s.title}</div>
          <div className="source-meta"><Icon size={12} /> {KIND[s.kind] || s.kind}{s.heading ? ` · ${s.heading}` : ''}</div>
        </div>
      </div>
      {s.text && (
        <blockquote className={'excerpt' + (open ? ' open' : '')} onClick={() => setOpen(!open)}>{plain(s.text)}</blockquote>
      )}
      <div className="source-actions">
        {s.text && s.text.length > 280 && <button className="link-btn" onClick={() => setOpen(!open)}>{open ? 'Recolher' : 'Ver trecho completo'}</button>}
        {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="link-btn">Original <ExternalLink size={12} /></a>}
        {s.kind === 'web' && (saved
          ? <span className="link-btn done"><Check size={12} /> Salvo</span>
          : <button className="link-btn" onClick={save}><BookmarkPlus size={12} /> Salvar na base</button>)}
      </div>
    </article>
  );
}
