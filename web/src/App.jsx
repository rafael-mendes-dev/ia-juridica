import { useEffect, useState } from 'react';
import { api, fmtBytes } from './api.js';
import Chat from './Chat.jsx';
import Leis from './Leis.jsx';
import Base from './Base.jsx';
import Modelos from './Modelos.jsx';

const TABS = [
  ['chat', '💬', 'Chat'],
  ['leis', '📚', 'Leis'],
  ['base', '🗂️', 'Minha base'],
  ['modelos', '🧠', 'Modelos'],
];

export default function App() {
  const [tab, setTab] = useState('chat');
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState(null);

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

  const installed = new Set((models?.installed || []).flatMap((m) => [m.name, m.name.replace(/:latest$/, '')]));
  const chatOk = status && installed.has(status.settings.chatModel);
  const embedOk = status && installed.has(status.settings.embedModel);

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">⚖️ <span>IA Jurídica</span></div>
        {TABS.map(([id, icon, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <span className="icon">{icon}</span><span className="label">{label}</span>
          </button>
        ))}
        <div className="grow" />
        <div className="ver">v{status?.version || '…'}</div>
      </nav>
      <main className="main">
        {status && (!status.ollama.version || !chatOk || !embedOk) && (
          <div className="banner">
            {!status.ollama.version
              ? 'O Ollama não está rodando. Abra o Ollama (ou reinicie o IA Jurídica) para usar a IA.'
              : <>Configuração inicial: baixe {!chatOk && <b>um modelo de chat ({status.settings.chatModel})</b>}
                {!chatOk && !embedOk && ' e '}
                {!embedOk && <b>o modelo de embeddings ({status.settings.embedModel})</b>} na aba{' '}
                <a onClick={() => setTab('modelos')}>Modelos</a>.</>}
          </div>
        )}
        <div className="page" hidden={tab !== 'chat'}><Chat status={status} goto={setTab} /></div>
        {tab === 'leis' && <div className="page"><Leis /></div>}
        {tab === 'base' && <div className="page"><Base /></div>}
        {tab === 'modelos' && <div className="page"><Modelos status={status} models={models} /></div>}
      </main>
      <StatusBar status={status} />
    </div>
  );
}

function StatusBar({ status }) {
  if (!status) return <footer className="status err">Servidor offline</footer>;
  const { catalog, jobs, core, vectors, ollama } = status;
  const coreDone = core.filter((c) => c.status === 'indexado').length;
  return (
    <footer className="status">
      <span className={ollama.version ? 'ok' : 'err'}>● Ollama {ollama.version || 'offline'}</span>
      <span>
        Catálogo: {catalog.available
          ? `${(catalog.count || 0).toLocaleString('pt-BR')} normas`
          : catalog.state === 'baixando' ? `baixando ${Math.round(catalog.progress * 100)}%` : catalog.state}
      </span>
      <span>Núcleo: {coreDone}/{core.length} leis</span>
      <span>{vectors.toLocaleString('pt-BR')} trechos com embedding</span>
      {jobs.current && (
        <span className="job">⏳ {jobs.current.label} {Math.round(jobs.current.progress * 100)}%{jobs.pending ? ` (+${jobs.pending} na fila)` : ''}</span>
      )}
      {Object.entries(status.pulls).filter(([, p]) => p.state === 'baixando').map(([n, p]) => (
        <span key={n} className="job">⬇️ {n} {p.total ? `${fmtBytes(p.completed)} / ${fmtBytes(p.total)}` : p.status}</span>
      ))}
    </footer>
  );
}
