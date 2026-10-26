import path from 'node:path';
import { start } from './index.js';

// Servidor de desenvolvimento: dados em ./.data, front servido pelo Vite (porta 5173)
start({ dataDir: path.resolve('.data'), version: 'dev' });
