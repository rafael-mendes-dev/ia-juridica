import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Cpu, FolderOpen, MessageSquare, Plus, Scale, Trash2 } from 'lucide-react';
import { api, fmtBytes, isOpenAI } from './api.js';
import { Alert } from './ui.jsx';
import Chat from './Chat.jsx';
import Leis from './Leis.jsx';
import Base from './Base.jsx';
import Modelos from './Modelos.jsx';

const TABS = [
  ['chat', MessageSquare, 'Assistente'],
  ['leis', BookOpen, 'Legislação'],
  ['base', FolderOpen, 'Minha base'],
  ['modelos', Cpu, 'Modelos'],
];

export default function App() {
  const [tab, setTab] = useState('chat');
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState(null);
  const [convs, setConvs] = useState([]);
  const [convId, setConvId] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [s, m] = await Promise.all([api('/status'), api('/models')]);
        if (alive) { setStatus(s); setModels(m); }
      } catch {
        if (alive) setStatus(null);
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const loadConvs = useCallback(() => api('/conversations').then(setConvs).catch(() => {}), []);
  useEffect(() => { loadConvs(); }, [loadConvs]);

  async function deleteConv(id, e) {
    e.stopPropagation();
    await api(`/conversations/${id}`, { method: 'DELETE' });
    if (id === convId) setConvId(null);
    loadConvs();
  }

  const installed = new Set((models?.installed || []).flatMap((m) => [m.name, m.name.replace(/:latest$/, '')]));
  const ok = (name) => (isOpenAI(name) ? status.openai.key : installed.has(name));
  const chatOk = status && ok(status.settings.chatModel);
  const embedOk = status && ok(status.settings.embedModel);
  // o Ollama só é necessário se algum modelo em uso for local
  const needsOllama = status && !(isOpenAI(status.settings.chatModel) && isOpenAI(status.settings.embedModel));
  const ollamaDown = needsOllama && !status.ollama.version;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Scale size={16} strokeWidth={2.2} /></span>
          <span>IA Jurídica</span>
        </div>

        <nav className="nav">
          {TABS.map(([id, Icon, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              <Icon size={17} /><span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="convs">
          <div className="convs-head">
            <span>Conversas</span>
            <button className="icon-btn" title="Nova conversa" onClick={() => { setConvId(null); setTab('chat'); }}>
              <Plus size={16} />
            </button>
          </div>
          <div className="convs-list">
            {convs.map((c) => (
              <div
                key={c.id}
                className={'conv' + (c.id === convId && tab === 'chat' ? ' active' : '')}
                onClick={() => { setConvId(c.id); setTab('chat'); }}
              >
                <span className="conv-title">{c.title}</span>
                <button className="icon-btn conv-del" title="Apagar conversa" onClick={(e) => deleteConv(c.id, e)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!convs.length && <p className="convs-empty">Suas conversas aparecem aqui.</p>}
          </div>
        </div>

        <SystemStatus status={status} />
      </aside>

      <main className="main">
        {status && (ollamaDown || !chatOk || !embedOk) && (
          <div className="top-alert">
            {ollamaDown ? (
              <Alert kind="error">O Ollama não está rodando. Abra o Ollama ou reinicie o IA Jurídica para usar o assistente.</Alert>
            ) : (
              <Alert kind="warn">
                Para começar, {(isOpenAI(status.settings.chatModel) || isOpenAI(status.settings.embedModel)) && !status.openai.key
                  ? <>cadastre sua <b>chave da OpenAI</b> ou escolha modelos locais</>
                  : <>baixe {!chatOk && <b>o modelo de conversa ({status.settings.chatModel})</b>}
                    {!chatOk && !embedOk && ' e '}
                    {!embedOk && <b>o modelo de busca ({status.settings.embedModel})</b>}</>}.{' '}
                <a onClick={() => setTab('modelos')}>Abrir Modelos</a>
              </Alert>
            )}
          </div>
        )}
        <div className="page page-chat" hidden={tab !== 'chat'}>
          <Chat status={status} convId={convId} setConvId={setConvId} onConvsChanged={loadConvs} />
        </div>
        {tab === 'leis' && <div className="page"><Leis /></div>}
        {tab === 'base' && <div className="page"><Base /></div>}
        {tab === 'modelos' && <div className="page"><Modelos status={status} models={models} /></div>}
      </main>
    </div>
  );
}

function SystemStatus({ status }) {
  if (!status) {
    return <div className="sys"><div className="sys-row"><span className="dot err" />Servidor offline</div></div>;
  }
  const { catalog, jobs, core, vectors, ollama, pulls } = status;
  const coreDone = core.filter((c) => c.status === 'indexado').length;
  const activePulls = Object.entries(pulls).filter(([, p]) => p.state === 'baixando');
  return (
    <div className="sys">
      <div className="sys-row"><span className={'dot ' + (ollama.version ? 'ok' : 'err')} />Ollama {ollama.version || 'offline'}</div>
      {status.openai.key && <div className="sys-row"><span className="dot ok" />OpenAI conectada</div>}
      <div className="sys-row">
        <span className={'dot ' + (catalog.available ? 'ok' : 'warn')} />
        {catalog.available
          ? `${(catalog.count || 0).toLocaleString('pt-BR')} normas`
          : catalog.state === 'baixando' ? `Baixando catálogo ${Math.round(catalog.progress * 100)}%` : 'Catálogo indisponível'}
      </div>
      <div className="sys-row muted">{coreDone}/{core.length} leis principais · {vectors.toLocaleString('pt-BR')} trechos</div>
      {jobs.current && (
        <div className="sys-job">
          <div className="sys-job-label">{jobs.current.label}{jobs.pending ? ` (+${jobs.pending})` : ''}</div>
          <div className="sys-bar"><div style={{ width: `${Math.round(jobs.current.progress * 100)}%` }} /></div>
        </div>
      )}
      {activePulls.map(([n, p]) => (
        <div key={n} className="sys-job">
          <div className="sys-job-label">Baixando {n} · {p.total ? `${fmtBytes(p.completed)} de ${fmtBytes(p.total)}` : p.status}</div>
          <div className="sys-bar"><div style={{ width: `${p.total ? Math.round((p.completed / p.total) * 100) : 0}%` }} /></div>
        </div>
      ))}
      <div className="sys-ver">v{status.version}</div>
    </div>
  );
}
