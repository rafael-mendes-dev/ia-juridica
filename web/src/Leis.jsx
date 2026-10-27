import { useEffect, useState } from 'react';
import { marked } from 'marked';
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, Plus, Search, Check } from 'lucide-react';
import { api } from './api.js';
import { Alert, Badge, Modal, PageHeader, Spinner } from './ui.jsx';

export default function Leis() {
  const [q, setQ] = useState('');
  const [f, setF] = useState({ esfera: '', tipo: '', uf: '', ano: '' });
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  const [facets, setFacets] = useState(null);
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(null);

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
      setView({ norma: n, ...(await api('/leis/texto?path=' + encodeURIComponent(n.path))) });
    } catch (e) {
      setView({ norma: n, error: e.message });
    }
  }

  async function indexar(n) {
    setAdding(n.path);
    try {
      await api('/leis/indexar', { method: 'POST', body: { path: n.path } });
      setRes((r) => ({ ...r, items: r.items.map((x) => (x.path === n.path ? { ...x, indexado: true } : x)) }));
    } finally {
      setAdding(null);
    }
  }

  const pages = res ? Math.ceil(res.total / 30) : 0;
  const total = facets?.esferas.reduce((s, x) => s + x.c, 0);

  return (
    <div className="container">
      <PageHeader
        title="Legislação"
        subtitle={total ? `${total.toLocaleString('pt-BR')} normas federais, estaduais e municipais. Fonte: ctresb/leis.` : 'Catálogo de normas brasileiras.'}
      />

      <form className="search" onSubmit={(e) => { e.preventDefault(); search(1); }}>
        <Search size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tema, número (ex.: 8.078/90) ou sigla (CDC, CLT, LGPD)" />
        <button className="btn btn-primary">Buscar</button>
      </form>

      <div className="filters">
        <select value={f.esfera} onChange={(e) => setF({ ...f, esfera: e.target.value })}>
          <option value="">Todas as esferas</option>
          {facets?.esferas.map((x) => <option key={x.esfera} value={x.esfera}>{cap(x.esfera)} ({x.c.toLocaleString('pt-BR')})</option>)}
        </select>
        <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
          <option value="">Todos os tipos</option>
          {facets?.tipos.map((x) => <option key={x.tipo} value={x.tipo}>{x.tipo} ({x.c.toLocaleString('pt-BR')})</option>)}
        </select>
        <select value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value })}>
          <option value="">Todas as UFs</option>
          {facets?.ufs.map((x) => <option key={x.uf} value={x.uf}>{x.uf}</option>)}
        </select>
        <input className="filter-year" value={f.ano} onChange={(e) => setF({ ...f, ano: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="Ano" inputMode="numeric" />
        <span className="filters-count">
          {loading ? <Spinner /> : res?.available ? `${res.total.toLocaleString('pt-BR')} resultados` : ''}
        </span>
      </div>

      {res && !res.available && <Alert kind="warn">O catálogo ainda está sendo baixado. Acompanhe o progresso na barra lateral.</Alert>}

      <div className="list">
        {res?.items.map((n) => (
          <article key={n.path} className="row-card">
            <div className="row-card-main">
              <div className="row-card-title">
                <button className="title-link" onClick={() => open(n)}>{n.titulo}</button>
                <Badge>{n.tipo}</Badge>
                {n.uf && <Badge>{n.uf}</Badge>}
                {n.revogada ? <Badge tone="danger">Revogada</Badge> : null}
                {n.indexado && <Badge tone="success">Na base</Badge>}
              </div>
              {n.ementa && <p className="row-card-desc">{n.ementa}</p>}
            </div>
            <div className="row-card-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => open(n)}><BookOpen size={14} /> Ler</button>
              {n.indexado
                ? <span className="btn btn-ghost btn-sm is-done"><Check size={14} /> Indexada</span>
                : <button className="btn btn-ghost btn-sm" disabled={adding === n.path} onClick={() => indexar(n)}>
                    {adding === n.path ? <Spinner /> : <Plus size={14} />} Adicionar à base
                  </button>}
              <a className="btn btn-ghost btn-sm" href={'https://github.com/ctresb/leis/blob/main/' + n.path} target="_blank" rel="noreferrer" title="Ver no GitHub"><ExternalLink size={14} /></a>
            </div>
          </article>
        ))}
      </div>

      {pages > 1 && (
        <div className="pager">
          <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => search(page - 1)}><ChevronLeft size={14} /> Anterior</button>
          <span>Página {page} de {pages.toLocaleString('pt-BR')}</span>
          <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => search(page + 1)}>Próxima <ChevronRight size={14} /></button>
        </div>
      )}

      {view && (
        <Modal title={view.norma.titulo} onClose={() => setView(null)}>
          {view.loading && <div className="center-pad"><Spinner size={20} /></div>}
          {view.error && <Alert kind="error">{view.error}</Alert>}
          {view.body && (
            <>
              {view.meta?.ementa && <p className="reader-ementa">{view.meta.ementa}</p>}
              {view.meta?.fonte && (
                <p className="reader-source">Fonte oficial: <a href={view.meta.fonte} target="_blank" rel="noreferrer">{view.meta.fonte}</a></p>
              )}
              <div className="md reader" dangerouslySetInnerHTML={{ __html: marked.parse(view.body.replace(/</g, '&lt;'), { async: false }) }} />
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
