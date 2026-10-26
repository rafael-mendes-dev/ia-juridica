import { spawn } from 'node:child_process';

// Roda backend e Vite juntos
const procs = ['dev:server', 'dev:web'].map((s) =>
  spawn('npm', ['run', s], { stdio: 'inherit', shell: true }),
);
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) stop(); }));
