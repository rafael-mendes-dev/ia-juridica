import { useState } from 'react';
import { api, fmtBytes } from './api.js';

const EMBED_HINT = /embed|bge|minilm|e5|gte|nomic/i;

export default function Modelos({ status, models }) {
  const [custom, setCustom] = useState('');
  const [err, setErr] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  if (!status || !models) return <p>Carregando…</p>;

  const settings = status.settings;
  const installed = models.installed;
  const isInstalled = (n) => installed.some((m) => m.name === n || m.name === n + ':latest');
  const ramGb = status.system.ram / 1024 ** 3;

  async function pull(name) {
    setErr(null);
    try { await api('/models/pull', { method: 'POST', body: { name } }); } catch (e) { setErr(e.message); }
  }
  async function remove(name) {
    setConfirmDel(null);
    try { await api(`/models/${encodeURIComponent(name)}`, { method: 'DELETE' }); } catch (e) { setErr(e.message); }
  }
  const set = (patch) => api('/settings', { method: 'PUT', body: patch }).catch((e) => setErr(e.message));

  const Pull = ({ name }) => {
    const p = models.pulls[name] || status.pulls[name];
    if (p?.state === 'baixando') {
      const pct = p.total ? (p.completed / p.total) * 100 : 0;
      return (
        <div className="progress" title={p.status}>
          <div style={{ width: pct + '%' }} />
          <span>{p.total ? `${pct.toFixed(0)}% · ${fmtBytes(p.completed)} / ${fmtBytes(p.total)}` : p.status}</span>
        </div>
      );
    }
    if (p?.state === 'erro') return <span className="error small" title={p.status}>Falhou · <a onClick={() => pull(name)}>tentar de novo</a></span>;
    return <button onClick={() => pull(name)}>⬇️ Baixar</button>;
  };

  const Rec = ({ list, kind }) => (
    <table className="table">
      <thead><tr><th>Modelo</th><th>Download</th><th>Observação</th><th /></tr></thead>
      <tbody>
        {list.map((m) => {
          const inst = isInstalled(m.name);
          const sel = kind === 'chat' ? settings.chatModel === m.name : settings.embedModel === m.name;
          return (
            <tr key={m.name} className={sel ? 'selected' : ''}>
              <td><b>{m.name}</b></td>
              <td>~{fmtBytes(m.size)}</td>
              <td className="small">{m.note}</td>
              <td className="right">
                {inst
                  ? sel ? <span className="tag green">Em uso</span>
                    : <button onClick={() => set(kind === 'chat' ? { chatModel: m.name } : { embedModel: m.name })}>Usar</button>
                  : <Pull name={m.name} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="modelos">
      {err && <div className="banner red">{err}</div>}
      {!status.ollama.version && <div className="banner red">Ollama offline: não é possível listar ou baixar modelos.</div>}
      <p className="muted">
        Seu computador: {ramGb.toFixed(0)} GB de RAM, {status.system.cpus} núcleos.
        {ramGb < 12 ? ' Prefira modelos de até ~4B parâmetros.' : ramGb < 24 ? ' Modelos de até ~8B devem rodar bem.' : ' Você pode usar modelos maiores (12B+).'}
      </p>

      <h3>Modelos de chat sugeridos</h3>
      <Rec list={models.recommended.chat} kind="chat" />

      <h3>Modelos de embedding (busca semântica)</h3>
      <p className="muted small">Ao trocar o modelo de embedding, toda a base é reprocessada em segundo plano.</p>
      <Rec list={models.recommended.embed} kind="embed" />

      <h3>Instalados no Ollama</h3>
      <table className="table">
        <thead><tr><th>Modelo</th><th>Tamanho</th><th>Parâmetros</th><th>Quantização</th><th /></tr></thead>
        <tbody>
          {installed.map((m) => {
            const embed = EMBED_HINT.test(m.name) || /bert/i.test(m.family || '');
            return (
              <tr key={m.name}>
                <td><b>{m.name}</b> {embed && <span className="tag">embedding</span>}</td>
                <td>{fmtBytes(m.size)}</td>
                <td>{m.params || '—'}</td>
                <td>{m.quant || '—'}</td>
                <td className="right row">
                  {!embed && settings.chatModel !== m.name && <button onClick={() => set({ chatModel: m.name })}>Usar no chat</button>}
                  {embed && settings.embedModel !== m.name.replace(/:latest$/, '') && <button onClick={() => set({ embedModel: m.name.replace(/:latest$/, '') })}>Usar p/ embedding</button>}
                  {confirmDel === m.name
                    ? <><button className="danger" onClick={() => remove(m.name)}>Confirmar</button><button onClick={() => setConfirmDel(null)}>Cancelar</button></>
                    : <button className="ghost" title="Apagar do disco" onClick={() => setConfirmDel(m.name)}>🗑️</button>}
                </td>
              </tr>
            );
          })}
          {!installed.length && <tr><td colSpan={5} className="muted">Nenhum modelo instalado ainda.</td></tr>}
        </tbody>
      </table>

      <h3>Outro modelo</h3>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) pull(custom.trim()); }}>
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="ex.: mistral-nemo:12b (veja ollama.com/library)" />
        <button className="primary" disabled={!custom.trim()}>Baixar</button>
      </form>
      {custom.trim() && (models.pulls[custom.trim()] || status.pulls[custom.trim()]) && <div style={{ marginTop: 8 }}><Pull name={custom.trim()} /></div>}

      <h3>Preferências</h3>
      <div className="row">
        <label>Pesquisa na internet (padrão):{' '}
          <select value={settings.webMode} onChange={(e) => set({ webMode: e.target.value })}>
            <option value="auto">Automática (a IA decide)</option>
            <option value="sempre">Sempre</option>
            <option value="nunca">Nunca</option>
          </select>
        </label>
        <label>Janela de contexto:{' '}
          <select value={settings.numCtx} onChange={(e) => set({ numCtx: +e.target.value })}>
            {[4096, 8192, 16384, 32768].map((n) => <option key={n} value={n}>{n.toLocaleString('pt-BR')} tokens</option>)}
          </select>
        </label>
      </div>
      <div className="prefs">
        <label>
          <input type="checkbox" checked={settings.think} onChange={(e) => set({ think: e.target.checked })} />
          {' '}Modo de raciocínio <span className="muted small">— o modelo "pensa" antes de responder (qwen3 e similares). Respostas melhores, porém bem mais lentas.</span>
        </label>
        <label>
          <input type="checkbox" checked={settings.cpuOnly} onChange={(e) => set({ cpuOnly: e.target.checked })} />
          {' '}Processar só na CPU <span className="muted small">— algumas placas de vídeo (principalmente AMD) ficam mais lentas que o processador. Teste as duas opções.</span>
        </label>
      </div>
    </div>
  );
}
