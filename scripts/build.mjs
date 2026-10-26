// Build completo:
//   dist/app/            → server.cjs + web/ (pacote atualizável, publicado como app-<versão>.zip)
//   dist/IAJuridica.exe  → launcher (Node SEA), instala dependências e baixa o app
// Uso: node scripts/build.mjs [--no-exe]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = process.env.GITHUB_REF_NAME || `v${pkg.version}`;
const run = (cmd, args) => execFileSync(process.platform === 'win32' && cmd === 'npx' ? 'npx.cmd' : cmd, args, { stdio: 'inherit', cwd: root, shell: cmd === 'npx' && process.platform === 'win32' });

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'app'), { recursive: true });

console.log('› Front-end (Vite)');
run('npx', ['vite', 'build', '--config', 'web/vite.config.js']);

console.log('› Servidor (esbuild)');
await build({
  entryPoints: [path.join(root, 'server/index.js')],
  outfile: path.join(dist, 'app/server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
  // import.meta.url é usado por algumas dependências; aponta para o próprio bundle
  define: { 'import.meta.url': 'IMPORT_META_URL' },
  banner: { js: 'const IMPORT_META_URL = require("url").pathToFileURL(__filename).href;' },
});

console.log('› Pacote do app');
const zip = path.join(dist, `app-${version}.zip`);
run('tar', ['-a', '-c', '-f', zip, '-C', path.join(dist, 'app'), '.']);

if (process.argv.includes('--no-exe')) process.exit(0);

console.log('› Executável (Node SEA)');
// repositório de onde o launcher baixa atualizações
const repo = process.env.GITHUB_REPOSITORY || pkg.repository?.replace(/^github:/, '');
if (!repo) throw new Error('Defina "repository": "github:dono/repo" no package.json');
fs.writeFileSync(path.join(dist, 'launcher.cjs'),
  fs.readFileSync(path.join(root, 'launcher/main.cjs'), 'utf8').replace("'OWNER/ia-juridica'", JSON.stringify(repo)));
const seaConfig = path.join(dist, 'sea-config.json');
fs.writeFileSync(seaConfig, JSON.stringify({
  main: path.join(dist, 'launcher.cjs'),
  output: path.join(dist, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
}));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
const exe = path.join(dist, 'IAJuridica.exe');
fs.copyFileSync(process.execPath, exe);
run('npx', ['postject', exe, 'NODE_SEA_BLOB', path.join(dist, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite']);
for (const f of ['launcher.cjs', 'sea-config.json', 'sea-prep.blob']) fs.rmSync(path.join(dist, f));
console.log(`\n✔ Pronto: ${exe}\n✔ ${zip}`);
