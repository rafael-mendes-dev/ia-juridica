import { useEffect, useRef, useState } from 'react';
import { FileText, Link2, Trash2, Upload } from 'lucide-react';
import { api, fmtBytes } from './api.js';
import { Alert, Badge, Modal, PageHeader, Segmented, Spinner } from './ui.jsx';

const KINDS = [['', 'Tudo'], ['upload', 'Arquivos'], ['texto', 'Textos'], ['web', 'Páginas'], ['lei', 'Leis']];
const KIND_LABEL = { upload: 'Arquivo', texto: 'Texto', web: 'Página web', lei: 'Lei' };

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
    setMsg({ kind: 'info', text: label, busy: true });
    try {
      await fn();
      setMsg({ kind: 'success', text: 'Adicionado à base. A indexação semântica continua em segundo plano.' });
      load();
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
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
    <div className="container">
      <PageHeader title="Minha base" subtitle="Documentos, anotações e páginas que o assistente consulta junto com a legislação." />

      <div className="add-grid">
        <div
          className={'add-card dropzone' + (drag ? ' drag' : '')}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          onClick={() => fileRef.current.click()}
        >
          <span className="add-icon"><Upload size={18} /></span>
          <h3>Enviar arquivos</h3>
          <p>Arraste ou clique para selecionar. PDF, DOCX, TXT, MD e HTML.</p>
          <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.html,.htm" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        </div>

        <div className="add-card">
          <span className="add-icon"><FileText size={18} /></span>
          <h3>Colar texto</h3>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (opcional)" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Contrato, parecer, súmula, anotação…" />
          <button className="btn btn-primary" disabled={!text.trim()} onClick={() => run('Adicionando…', async () => {
            await api('/docs/texto', { method: 'POST', body: { title, text } });
            setTitle(''); setText('');
          })}>Adicionar</button>
        </div>

        <div className="add-card">
          <span className="add-icon"><Link2 size={18} /></span>
          <h3>Página da web</h3>
          <p>Salve uma notícia, decisão ou norma publicada online.</p>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.planalto.gov.br/…" />
          <button className="btn btn-primary" disabled={!/^https?:\/\//.test(url)} onClick={() => run('Baixando página…', async () => {
            await api('/docs/url', { method: 'POST', body: { url } });
            setUrl('');
          })}>Salvar</button>
        </div>
      </div>

      {msg && <Alert kind={msg.kind}>{msg.busy && <Spinner />} {msg.text}</Alert>}

      <div className="section-bar">
        <h2>Documentos</h2>
        <Segmented value={kind} onChange={setKind} options={KINDS} />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Documento</th><th>Tipo</th><th className="num">Trechos</th><th>Indexação</th><th /></tr></thead>
          <tbody>
            {docs.map((d) => {
              const pct = d.chunks ? Math.round((d.embedded / d.chunks) * 100) : 0;
              return (
                <tr key={d.id}>
                  <td>
                    <button className="title-link" onClick={() => api(`/docs/${d.id}/chunks`).then((c) => setChunks({ doc: d, items: c }))}>{d.title}</button>
                    {d.meta?.bytes ? <span className="cell-sub">{fmtBytes(d.meta.bytes)}</span> : null}
                  </td>
                  <td><Badge>{KIND_LABEL[d.kind] || d.kind}</Badge></td>
                  <td className="num">{d.chunks}</td>
                  <td>
                    {d.status === 'erro'
                      ? <Badge tone="danger">Erro</Badge>
                      : pct >= 100 ? <Badge tone="success">Completa</Badge>
                      : <span className="mini-progress"><span className="mp-track"><span className="mp-fill" style={{ width: pct + '%' }} /></span><em>{pct}%</em></span>}
                  </td>
                  <td className="actions"><button className="icon-btn" title="Remover da base" onClick={() => del(d)}><Trash2 size={15} /></button></td>
                </tr>
              );
            })}
            {!docs.length && <tr><td colSpan={5} className="empty-cell">Nenhum documento ainda.</td></tr>}
          </tbody>
        </table>
      </div>

      {chunks && (
        <Modal title={chunks.doc.title} onClose={() => setChunks(null)}>
          {chunks.items.map((c) => (
            <div key={c.id} className="chunk">
              <div className="chunk-meta">#{c.ord + 1}{c.heading ? ` · ${c.heading}` : ''}{c.embedded ? ' · indexado' : ''}</div>
              <pre>{c.text}</pre>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}
