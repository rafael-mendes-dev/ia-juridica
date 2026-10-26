import { useEffect, useState } from 'react';
import { marked } from 'marked';
import { api } from './api.js';

export default function Leis() {
  const [q, setQ] = useState('');
  const [f, setF] = useState({ esfera: '', tipo: '', uf: '', ano: '' });
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  const [facets, setFacets] = useState(null);
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api('/leis/facets').then(setFacets).catch(() => {}); }, []);

  async function search(p = 1) {
    setLoading(true);
    const params = new URLSearchParams({ q, page: p, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
    try {
      setRes(await api('/leis?' + params));
      setPage(p);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { search(1); }, [f]);

  async function open(n) {
    setView({ norma: n, loading: true });
    try {
      const t = await api('/leis/texto?path=' + encodeURIComponent(n.path));
      setView({ norma: n, ...t });
    } catch (e) {
      setView({ norma: n, error: e.message });
    }
  }

  async function indexar(n) {
    await api('/leis/indexar', { method: 'POST', body: { path: n.path } });
    setRes((r) => ({ ...r, items: r.items.map((x) => (x.path === n.path ? { ...x, indexado: true } : x)) }));
  }

  const pages = res ? Math.ceil(res.total / 30) : 0;

  return (
    <div className="leis">
      <div className="toolbar">
        <form className="searchbox" onSubmit={(e) => { e.preventDefault(); search(1); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por tema, número (ex.: 8.078/90) ou nome…" />
          <button className="primary">Buscar</button>
        </form>
        <div className="filters">
          <select value={f.esfera} onChange={(e) => setF({ ...f, esfera: e.target.value })}>
            <option value="">Todas as esferas</option>
            {facets?.esferas.map((x) => <option key={x.esfera} value={x.esfera}>{x.esfera} ({x.c.toLocaleString('pt-BR')})</option>)}
          </select>
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
            <option value="">Todos os tipos</option>
            {facets?.tipos.map((x) => <option key={x.tipo} value={x.tipo}>{x.tipo} ({x.c.toLocaleString('pt-BR')})</option>)}
          </select>
          <select value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value })}>
            <option value="">Todas as UFs</option>
            {facets?.ufs.map((x) => <option key={x.uf} value={x.uf}>{x.uf}</option>)}
          </select>
          <input className="ano" value={f.ano} onChange={(e) => setF({ ...f, ano: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="Ano" />
        </div>
      </div>

      {res && !res.available && <div className="banner">O catálogo de leis ainda não foi baixado. Acompanhe o progresso no rodapé.</div>}
      {res?.available && <div className="muted small">{loading ? 'Buscando…' : `${res.total.toLocaleString('pt-BR')} resultado(s)`}</div>}

      <div className="results">
        {res?.items.map((n) => (
          <div key={n.path} className="norma">
            <div className="norma-head">
              <b>{n.titulo}</b>
              <span className="tag">{n.tipo}</span>
              {n.uf && <span className="tag">{n.uf}</span>}
              {n.revogada ? <span className="tag red">Revogada</span> : null}
              {n.indexado && <span className="tag green">Na base da IA</span>}
            </div>
            {n.ementa && <p>{n.ementa}</p>}
            <div className="row">
              <button onClick={() => open(n)}>Ver texto</button>
              {!n.indexado && <button onClick={() => indexar(n)}>Adicionar à base da IA</button>}
              <a href={'https://github.com/ctresb/leis/blob/main/' + n.path} target="_blank" rel="noreferrer">GitHub ↗</a>
            </div>
          </div>
        ))}
      </div>

      {pages > 1 && (
        <div className="pager">
          <button disabled={page <= 1} onClick={() => search(page - 1)}>‹ Anterior</button>
          <span>Página {page} de {pages.toLocaleString('pt-BR')}</span>
          <button disabled={page >= pages} onClick={() => search(page + 1)}>Próxima ›</button>
        </div>
      )}

      {view && (
        <div className="modal" onClick={() => setView(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <b>{view.norma.titulo}</b>
              <button className="ghost" onClick={() => setView(null)}>✕</button>
            </div>
            {view.loading && <p>Carregando…</p>}
            {view.error && <p className="error">{view.error}</p>}
            {view.body && (
              <>
                {view.meta?.fonte && <p className="small">Fonte oficial: <a href={view.meta.fonte} target="_blank" rel="noreferrer">{view.meta.fonte}</a></p>}
                <div className="md lawtext" dangerouslySetInnerHTML={{ __html: marked.parse(view.body.replace(/</g, '&lt;'), { async: false }) }} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
