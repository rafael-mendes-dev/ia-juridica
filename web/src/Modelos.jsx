import { useState } from 'react';
import { Check, Download, HardDrive, KeyRound, MemoryStick, RotateCw, Trash2 } from 'lucide-react';
import { api, fmtBytes, isOpenAI, modelLabel } from './api.js';
import { Alert, Badge, PageHeader, Progress, Spinner, Switch } from './ui.jsx';

const EMBED_HINT = /embed|bge|minilm|e5|gte|nomic/i;

export default function Modelos({ status, models }) {
  const [custom, setCustom] = useState('');
  const [err, setErr] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [customGpt, setCustomGpt] = useState('');
  if (!status || !models) return <div className="container"><PageHeader title="Modelos" /></div>;

  const settings = status.settings;
  const installed = models.installed;
  const isInstalled = (n) => installed.some((m) => m.name === n || m.name === n + ':latest');
  const ramGb = status.system.ram / 1024 ** 3;
  const diskUsed = installed.reduce((s, m) => s + (m.size || 0), 0);

  async function pull(name) {
    setErr(null);
    try { await api('/models/pull', { method: 'POST', body: { name } }); } catch (e) { setErr(e.message); }
  }
  async function remove(name) {
    setConfirmDel(null);
    try { await api(`/models/${encodeURIComponent(name)}`, { method: 'DELETE' }); } catch (e) { setErr(e.message); }
  }
  const set = (patch) => api('/settings', { method: 'PUT', body: patch }).catch((e) => setErr(e.message));

  function PullState({ name }) {
    const p = models.pulls[name] || status.pulls[name];
    if (p?.state === 'baixando') {
      return <Progress value={p.total ? p.completed / p.total : 0} label={p.total ? `${fmtBytes(p.completed)} de ${fmtBytes(p.total)}` : 'Preparando…'} />;
    }
    if (p?.state === 'erro') {
      return <button className="btn btn-outline btn-sm" title={p.status} onClick={() => pull(name)}><RotateCw size={14} /> Tentar de novo</button>;
    }
    return <button className="btn btn-outline btn-sm" onClick={() => pull(name)}><Download size={14} /> Baixar</button>;
  }

  function ModelCards({ list, kind }) {
    return (
      <div className="model-grid">
        {list.map((m) => {
          const cloud = isOpenAI(m.name);
          const inst = cloud ? status.openai.key : isInstalled(m.name);
          const sel = (kind === 'chat' ? settings.chatModel : settings.embedModel) === m.name;
          return (
            <div key={m.name} className={'model-card' + (sel ? ' selected' : '')}>
              <div className="model-card-head">
                <code>{modelLabel(m.name)}</code>
                <span className="model-size" title="US$ por 1 milhão de tokens">{cloud ? `US$ ${m.price}` : fmtBytes(m.size)}</span>
              </div>
              <p>{m.note}</p>
              <div className="model-card-foot">
                {inst ? (
                  sel ? <Badge tone="accent"><Check size={12} /> Em uso</Badge>
                    : <button className="btn btn-outline btn-sm" onClick={() => set(kind === 'chat' ? { chatModel: m.name } : { embedModel: m.name })}>Usar este</button>
                ) : cloud ? <span className="model-installed">Cadastre a chave acima</span> : <PullState name={m.name} />}
                {inst && !sel && !cloud && <span className="model-installed">Instalado</span>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const customName = custom.trim();
  const customPull = customName && (models.pulls[customName] || status.pulls[customName]);

  return (
    <div className="container">
      <PageHeader title="Modelos" subtitle="Os modelos locais rodam no seu computador pelo Ollama, sem custo. Opcionalmente, use modelos GPT da OpenAI." />

      <div className="stat-row">
        <div className="stat"><MemoryStick size={16} /><div><b>{ramGb.toFixed(0)} GB</b><span>memória RAM</span></div></div>
        <div className="stat"><HardDrive size={16} /><div><b>{fmtBytes(diskUsed)}</b><span>em modelos instalados</span></div></div>
        <div className="stat stat-wide">
          <div><span>
            {ramGb < 12 ? 'Recomendado: modelos de até 4B parâmetros.'
              : ramGb < 24 ? 'Modelos de até 8B parâmetros devem rodar bem.'
              : 'Você pode usar modelos maiores (12B ou mais).'}
          </span></div>
        </div>
      </div>

      {err && <Alert kind="error">{err}</Alert>}
      {!status.ollama.version && <Alert kind="error">Ollama offline: não é possível listar ou baixar modelos.</Alert>}

      <section className="section">
        <h2>Modelo de conversa</h2>
        <p className="section-desc">Gera as respostas. Modelos maiores respondem melhor, mas são mais lentos.</p>
        <ModelCards list={models.recommended.chat} kind="chat" />
      </section>

      <section className="section">
        <h2>Modelo de busca semântica</h2>
        <p className="section-desc">Encontra trechos pelo significado. Ao trocar, toda a base é reindexada em segundo plano.</p>
        <ModelCards list={models.recommended.embed} kind="embed" />
      </section>

      <section className="section">
        <h2>OpenAI (opcional)</h2>
        <p className="section-desc">
          Use modelos GPT na conversa e/ou na busca. É pago por uso, cobrado na sua conta da OpenAI, e a pergunta e os trechos consultados são enviados à API.
          A chave fica salva só neste computador. Crie uma em platform.openai.com/api-keys.
        </p>
        <OpenAIKey status={status} settings={settings} onError={setErr} />
        <h3 className="subhead">Conversa</h3>
        <ModelCards list={models.openai.chat} kind="chat" />
        <h3 className="subhead">Busca semântica</h3>
        <ModelCards list={models.openai.embed} kind="embed" />
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (customGpt.trim()) set({ chatModel: 'openai/' + customGpt.trim() }); }}>
          <input value={customGpt} onChange={(e) => setCustomGpt(e.target.value)} placeholder="Outro modelo de conversa da OpenAI, ex.: gpt-4.1-nano" disabled={!status.openai.key} />
          <button className="btn btn-outline" disabled={!customGpt.trim() || !status.openai.key}>Usar na conversa</button>
        </form>
      </section>

      <section className="section">
        <h2>Instalados no Ollama</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Modelo</th><th className="num">Tamanho</th><th>Parâmetros</th><th>Quantização</th><th /></tr></thead>
            <tbody>
              {installed.map((m) => {
                const embed = EMBED_HINT.test(m.name) || /bert/i.test(m.family || '');
                const base = m.name.replace(/:latest$/, '');
                const inUse = settings.chatModel === m.name || settings.embedModel === base;
                return (
                  <tr key={m.name}>
                    <td><code>{m.name}</code> {embed && <Badge>busca</Badge>} {inUse && <Badge tone="accent">em uso</Badge>}</td>
                    <td className="num">{fmtBytes(m.size)}</td>
                    <td>{m.params || '—'}</td>
                    <td>{m.quant || '—'}</td>
                    <td className="actions">
                      {!inUse && (embed
                        ? <button className="btn btn-ghost btn-sm" onClick={() => set({ embedModel: base })}>Usar na busca</button>
                        : <button className="btn btn-ghost btn-sm" onClick={() => set({ chatModel: m.name })}>Usar na conversa</button>)}
                      {confirmDel === m.name ? (
                        <>
                          <button className="btn btn-danger btn-sm" onClick={() => remove(m.name)}>Apagar</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(null)}>Cancelar</button>
                        </>
                      ) : (
                        <button className="icon-btn" title="Apagar do disco" onClick={() => setConfirmDel(m.name)}><Trash2 size={15} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!installed.length && <tr><td colSpan={5} className="empty-cell">Nenhum modelo instalado.</td></tr>}
            </tbody>
          </table>
        </div>

        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (customName) pull(customName); }}>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Outro modelo do ollama.com/library, ex.: mistral-nemo:12b" />
          <button className="btn btn-outline" disabled={!customName}><Download size={14} /> Baixar</button>
        </form>
        {customPull && <div className="inline-progress"><PullState name={customName} /></div>}
      </section>

      <section className="section">
        <h2>Preferências</h2>
        <div className="prefs">
          <label className="pref-select">
            <span>Pesquisa na internet</span>
            <select value={settings.webMode} onChange={(e) => set({ webMode: e.target.value })}>
              <option value="auto">Automática</option>
              <option value="sempre">Sempre</option>
              <option value="nunca">Nunca</option>
            </select>
          </label>
          <label className="pref-select">
            <span>Janela de contexto</span>
            <select value={settings.numCtx} onChange={(e) => set({ numCtx: +e.target.value })}>
              {[4096, 8192, 16384, 32768].map((n) => <option key={n} value={n}>{n.toLocaleString('pt-BR')} tokens</option>)}
            </select>
          </label>
          <Switch
            checked={settings.think}
            onChange={(v) => set({ think: v })}
            label="Modo de raciocínio"
            hint="O modelo pensa antes de responder. Respostas mais cuidadosas, porém bem mais lentas."
          />
          <Switch
            checked={settings.cpuOnly}
            onChange={(v) => set({ cpuOnly: v })}
            label="Processar só na CPU"
            hint="Algumas placas de vídeo, principalmente AMD, ficam mais lentas que o processador. Teste as duas opções."
          />
        </div>
      </section>
    </div>
  );
}

function OpenAIKey({ status, settings, onError }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await api('/openai/key', { method: 'PUT', body: { key } });
      setKey('');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setConfirm(false);
    await api('/openai/key', { method: 'DELETE' }).catch((err) => onError(err.message));
  }

  if (status.openai.key) {
    return (
      <div className="key-row">
        <KeyRound size={16} />
        <span>Chave cadastrada <code>{settings.openaiKey}</code></span>
        {confirm ? (
          <>
            <button className="btn btn-danger btn-sm" onClick={remove}>Remover chave</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Cancelar</button>
          </>
        ) : <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(true)}>Remover</button>}
      </div>
    );
  }
  return (
    <form className="inline-form" onSubmit={save}>
      <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Cole sua chave da OpenAI (sk-...)" autoComplete="off" />
      <button className="btn btn-primary" disabled={!key.trim() || busy}>{busy ? <Spinner /> : <KeyRound size={14} />} Salvar chave</button>
    </form>
  );
}
