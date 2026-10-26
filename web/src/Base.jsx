import { useEffect, useRef, useState } from 'react';
import { api, fmtBytes } from './api.js';

const KINDS = { '': 'Tudo', upload: 'Arquivos', texto: 'Textos', web: 'Páginas web', lei: 'Leis' };

export default function Base() {
  const [docs, setDocs] = useState([]);
  const [kind, setKind] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState(null);
  const [drag, setDrag] = useState(false);
  const [chunks, setChunks] = useState(null);
  const fileRef = useRef();

  const load = () => api('/docs' + (kind ? '?kind=' + kind : '')).then(setDocs).catch(() => {});
  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [kind]);

  async function run(label, fn) {
    setMsg({ info: label });
    try {
      await fn();
      setMsg({ ok: 'Adicionado! Os embeddings são gerados em segundo plano (veja o rodapé).' });
      load();
    } catch (e) {
      setMsg({ error: e.message });
    }
  }

  function upload(files) {
    if (!files?.length) return;
    const form = new FormData();
    for (const f of files) form.append('files', f);
    run(`Enviando ${files.length} arquivo(s)…`, async () => {
      const out = await api('/docs/upload', { method: 'POST', form });
      const errs = out.filter((d) => d.status === 'erro');
      if (errs.length) throw new Error(errs.map((d) => `${d.title}: ${d.error}`).join('; '));
    });
  }

  async function del(d) {
    await api(`/docs/${d.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="base">
      <div className="cards3">
        <div
          className={'card drop' + (drag ? ' drag' : '')}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          onClick={() => fileRef.current.click()}
        >
          <h3>📄 Enviar arquivos</h3>
          <p className="muted">Arraste aqui ou clique. PDF, DOCX, TXT, MD, HTML.</p>
          <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.html,.htm" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        </div>
        <div className="card">
          <h3>✍️ Colar texto</h3>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (opcional)" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Cole aqui um contrato, parecer, súmula, anotação…" />
          <button className="primary" disabled={!text.trim()} onClick={() => run('Adicionando…', async () => {
            await api('/docs/texto', { method: 'POST', body: { title, text } });
            setTitle(''); setText('');
          })}>Adicionar</button>
        </div>
        <div className="card">
          <h3>🔗 Página da web</h3>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.planalto.gov.br/…" />
          <button className="primary" disabled={!/^https?:\/\//.test(url)} onClick={() => run('Baixando página…', async () => {
            await api('/docs/url', { method: 'POST', body: { url } });
            setUrl('');
          })}>Salvar na base</button>
        </div>
      </div>

      {msg && <div className={'banner ' + (msg.error ? 'red' : msg.ok ? 'green' : '')}>{msg.error || msg.ok || msg.info}</div>}

      <div className="tabs">
        {Object.entries(KINDS).map(([k, l]) => (
          <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>

      <table className="table">
        <thead><tr><th>Documento</th><th>Tipo</th><th>Trechos</th><th>Embeddings</th><th>Status</th><th /></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>
                <a onClick={() => api(`/docs/${d.id}/chunks`).then((c) => setChunks({ doc: d, items: c }))}>{d.title}</a>
                {d.meta?.bytes ? <span className="muted small"> · {fmtBytes(d.meta.bytes)}</span> : null}
              </td>
              <td>{KINDS[d.kind] || d.kind}</td>
              <td>{d.chunks}</td>
              <td>{d.chunks ? `${Math.round((d.embedded / d.chunks) * 100)}%` : '—'}</td>
              <td>{d.status === 'erro' ? <span className="error" title={d.error}>erro</span> : d.status}</td>
              <td><button className="ghost" title="Remover da base" onClick={() => del(d)}>🗑️</button></td>
            </tr>
          ))}
          {!docs.length && <tr><td colSpan={6} className="muted">Nada aqui ainda.</td></tr>}
        </tbody>
      </table>

      {chunks && (
        <div className="modal" onClick={() => setChunks(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><b>{chunks.doc.title}</b><button className="ghost" onClick={() => setChunks(null)}>✕</button></div>
            {chunks.items.map((c) => (
              <div key={c.id} className="chunk">
                <div className="muted small">#{c.ord + 1} {c.heading} {c.embedded ? '· ✓ embedding' : ''}</div>
                <pre>{c.text}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
