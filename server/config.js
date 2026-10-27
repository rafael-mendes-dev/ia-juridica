import path from 'node:path';
import fs from 'node:fs';

// Repositório deste projeto (releases do app e do catálogo)
export const APP_REPO = process.env.IAJ_REPO || 'rafael-mendes-dev/ia-juridica';
// Repositório com o texto das leis
export const LEIS_REPO = 'ctresb/leis';
export const LEIS_RAW = `https://raw.githubusercontent.com/${LEIS_REPO}/main/`;
export const LEIS_BLOB = `https://github.com/${LEIS_REPO}/blob/main/`;

export const OLLAMA_URL = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
export const DEFAULT_PORT = 5178;

export const DEFAULT_SETTINGS = {
  chatModel: 'qwen3:4b-instruct',
  embedModel: 'embeddinggemma',
  webMode: 'auto', // auto | sempre | nunca
  numCtx: 8192,
  think: false,    // modo de raciocínio (qwen3 etc.): respostas melhores, porém bem mais lentas
  cpuOnly: false,  // algumas GPUs (ex.: AMD via Vulkan) ficam mais lentas que a própria CPU
};

// Modelos sugeridos na tela de modelos (tamanho aproximado do download)
export const RECOMMENDED = {
  chat: [
    { name: 'qwen3:4b-instruct', size: 2.5e9, note: 'Recomendado para começar: leve, rápido e bom em português. 8 GB de RAM.' },
    { name: 'qwen3:4b', size: 2.5e9, note: 'Versão que sempre "raciocina" antes: mais cuidadosa, porém várias vezes mais lenta.' },
    { name: 'qwen3:8b', size: 5.2e9, note: 'Respostas melhores. 16 GB de RAM ou GPU de 8 GB.' },
    { name: 'gemma3:4b', size: 3.3e9, note: 'Alternativa leve do Google.' },
    { name: 'gemma3:12b', size: 8.1e9, note: 'Mais preciso, exige 16 GB+ de RAM / GPU 12 GB.' },
    { name: 'llama3.2:3b', size: 2.0e9, note: 'Muito leve, respostas mais simples.' },
    { name: 'qwen3:14b', size: 9.3e9, note: 'Mais pesado e mais capaz. GPU 12 GB+.' },
  ],
  embed: [
    { name: 'embeddinggemma', size: 6.2e8, note: 'Recomendado: multilíngue, ótimo em português.' },
    { name: 'bge-m3', size: 1.2e9, note: 'Multilíngue, mais pesado, alta qualidade.' },
    { name: 'nomic-embed-text', size: 2.7e8, note: 'Muito leve, focado em inglês.' },
  ],
};

// Normas indexadas automaticamente na primeira execução (núcleo)
export const CORE_LAWS = [
  { alias: 'Constituição Federal', path: 'constituicao.md' },
  { alias: 'Código Civil', tipo: 'Lei Ordinária', numero: '10406', ano: 2002 },
  { alias: 'Código de Processo Civil', tipo: 'Lei Ordinária', numero: '13105', ano: 2015 },
  { alias: 'Código Penal', tipo: 'Decreto-Lei', numero: '2848', ano: 1940 },
  { alias: 'Código de Processo Penal', tipo: 'Decreto-Lei', numero: '3689', ano: 1941 },
  { alias: 'CLT', tipo: 'Decreto-Lei', numero: '5452', ano: 1943 },
  { alias: 'Código de Defesa do Consumidor', tipo: 'Lei Ordinária', numero: '8078', ano: 1990 },
  { alias: 'Código Tributário Nacional', tipo: 'Lei Ordinária', numero: '5172', ano: 1966 },
  { alias: 'ECA', tipo: 'Lei Ordinária', numero: '8069', ano: 1990 },
  { alias: 'Lei do Inquilinato', tipo: 'Lei Ordinária', numero: '8245', ano: 1991 },
  { alias: 'Lei Maria da Penha', tipo: 'Lei Ordinária', numero: '11340', ano: 2006 },
  { alias: 'LGPD', tipo: 'Lei Ordinária', numero: '13709', ano: 2018 },
  { alias: 'Juizados Especiais', tipo: 'Lei Ordinária', numero: '9099', ano: 1995 },
  { alias: 'Estatuto da Pessoa Idosa', tipo: 'Lei Ordinária', numero: '10741', ano: 2003 },
];

// Siglas/apelidos usados para expandir buscas no catálogo
export const ALIASES = {
  cf: 'Constituição Federal', crfb: 'Constituição Federal', constituicao: 'Constituição Federal',
  cc: 'Código Civil', cpc: 'Código de Processo Civil', cp: 'Código Penal',
  cpp: 'Código de Processo Penal', clt: 'CLT', cdc: 'Código de Defesa do Consumidor',
  ctn: 'Código Tributário Nacional', eca: 'ECA', lgpd: 'LGPD',
  'maria da penha': 'Lei Maria da Penha', inquilinato: 'Lei do Inquilinato',
  'estatuto do idoso': 'Estatuto da Pessoa Idosa',
};

export function resolvePaths(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    dataDir,
    userDb: path.join(dataDir, 'iajuridica.db'),
    catalogDb: path.join(dataDir, 'catalog.db'),
    catalogMeta: path.join(dataDir, 'catalog.json'),
  };
}
