// IAJuridica.exe — launcher (Node Single Executable Application).
// 1) baixa/atualiza o app a partir das releases do GitHub
// 2) instala e inicia o Ollama se necessário
// 3) sobe o servidor local e abre o navegador
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const REPO = 'OWNER/ia-juridica';
const PORT = 5178;
const BASE = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'IAJuridica');
const APP_DIR = path.join(BASE, 'app');
const DATA_DIR = process.env.IAJ_DATA_DIR || path.join(BASE, 'data');
const LOG = path.join(BASE, 'launcher.log');
const OLLAMA_URL = 'http://127.0.0.1:11434';

fs.mkdirSync(APP_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

function log(...a) {
  const line = `[${new Date().toLocaleString('pt-BR')}] ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch {}
}

async function fail(msg) {
  log('ERRO:', msg);
  console.log('\nPressione ENTER para fechar.');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(1));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ok(url, timeout = 1500) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    return r.ok ? r : null;
  } catch {
    return null;
  }
}

async function download(url, dest, label) {
  const res = await fetch(url, { headers: { 'user-agent': 'IAJuridica' } });
  if (!res.ok) throw new Error(`Download falhou (${res.status}): ${url}`);
  const total = +res.headers.get('content-length') || 0;
  let got = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => {
    got += c.length;
    if (total && Date.now() - last > 1000) {
      last = Date.now();
      process.stdout.write(`\r  ${label}: ${Math.round((got / total) * 100)}% (${(got / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB)   `);
    }
  });
  await pipeline(body, fs.createWriteStream(dest));
  if (total) process.stdout.write('\n');
}

function openBrowser(url) {
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

// ---------- Atualização do app ----------
function currentApp() {
  try {
    const cur = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'current.json'), 'utf8'));
    if (fs.existsSync(path.join(APP_DIR, cur.dir, 'server.cjs'))) return cur;
  } catch {}
  return null;
}

async function updateApp() {
  const cur = currentApp();
  let rel;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'user-agent': 'IAJuridica', accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
    rel = await r.json();
  } catch (e) {
    log('Não foi possível verificar atualizações:', e.message);
    return cur;
  }
  if (cur && cur.version === rel.tag_name) return cur;
  const asset = rel.assets.find((a) => /^app-.*\.zip$/.test(a.name));
  if (!asset) return cur;
  log(cur ? `Atualizando ${cur.version} → ${rel.tag_name}…` : `Baixando IA Jurídica ${rel.tag_name}…`);
  const zip = path.join(os.tmpdir(), asset.name);
  const dir = rel.tag_name.replace(/[^\w.-]/g, '_');
  const target = path.join(APP_DIR, dir);
  try {
    await download(asset.browser_download_url, zip, 'App');
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    execFileSync('tar', ['-xf', zip, '-C', target], { windowsHide: true });
    fs.rmSync(zip, { force: true });
    if (!fs.existsSync(path.join(target, 'server.cjs'))) throw new Error('pacote inválido');
    fs.writeFileSync(path.join(APP_DIR, 'current.json'), JSON.stringify({ version: rel.tag_name, dir }));
    // remove versões antigas
    for (const d of fs.readdirSync(APP_DIR)) {
      if (d !== dir && d !== 'current.json') fs.rmSync(path.join(APP_DIR, d), { recursive: true, force: true });
    }
    log('App atualizado para', rel.tag_name);
    return { version: rel.tag_name, dir };
  } catch (e) {
    log('Falha ao atualizar:', e.message);
    return cur;
  }
}

// ---------- Ollama ----------
function findOllama() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    return execFileSync('where', ['ollama'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim() || null;
  } catch {
    return null;
  }
}

async function ensureOllama() {
  if (await ok(OLLAMA_URL + '/api/version')) return true;
  let exe = findOllama();
  if (!exe) {
    log('Ollama não encontrado. Baixando instalador (~1 GB, só na primeira vez)…');
    const setup = path.join(os.tmpdir(), 'OllamaSetup.exe');
    try {
      await download('https://ollama.com/download/OllamaSetup.exe', setup, 'Ollama');
      log('Instalando Ollama…');
      execFileSync(setup, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'], { stdio: 'ignore' });
      fs.rmSync(setup, { force: true });
    } catch (e) {
      log('Falha ao instalar o Ollama:', e.message, '— instale manualmente em https://ollama.com/download');
      return false;
    }
    exe = findOllama();
  }
  if (!exe) return false;
  for (let i = 0; i < 10; i++) {
    if (await ok(OLLAMA_URL + '/api/version')) return true;
    await sleep(1000);
  }
  log('Iniciando o Ollama…');
  spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 30; i++) {
    if (await ok(OLLAMA_URL + '/api/version')) return true;
    await sleep(1000);
  }
  log('O Ollama não respondeu. A IA ficará indisponível até ele iniciar.');
  return false;
}

// ---------- Principal ----------
(async () => {
  console.log('==============================================');
  console.log('  IA Jurídica — assistente jurídico local');
  console.log('  Mantenha esta janela aberta enquanto usa.');
  console.log('==============================================\n');

  const url = `http://localhost:${PORT}`;
  const running = await ok(`http://127.0.0.1:${PORT}/api/health`);
  if (running && (await running.json()).app === 'ia-juridica') {
    log('Já está rodando. Abrindo o navegador…');
    openBrowser(url);
    setTimeout(() => process.exit(0), 1500);
    return;
  }

  const app = process.env.IAJ_APP_DIR
    ? { version: 'local', dir: process.env.IAJ_APP_DIR }
    : await updateApp();
  if (!app) return fail('Não foi possível baixar o aplicativo. Verifique sua conexão com a internet e tente novamente.');
  const appDir = path.isAbsolute(app.dir) ? app.dir : path.join(APP_DIR, app.dir);

  if (!process.env.IAJ_SKIP_OLLAMA) await ensureOllama();

  log(`Iniciando IA Jurídica ${app.version}…`);
  process.env.IAJ_REPO = REPO;
  const req = createRequire(path.join(appDir, 'server.cjs'));
  const { start } = req(path.join(appDir, 'server.cjs'));
  await start({
    dataDir: DATA_DIR,
    webDir: path.join(appDir, 'web'),
    port: PORT,
    version: app.version,
    onReady: () => {
      log(`Pronto! Acesse ${url}`);
      openBrowser(url);
    },
  });
})().catch((e) => fail(e.stack || e.message));
