// Escolhe o provedor pelo nome do modelo: "openai/<modelo>" usa a API da OpenAI, o resto vai para o Ollama
import { getSettings } from './db.js';
import * as ollama from './ollama.js';
import * as openai from './openai.js';

const PREFIX = 'openai/';

export const isOpenAI = (model) => typeof model === 'string' && model.startsWith(PREFIX);

function openaiKey() {
  const { openaiKey } = getSettings();
  if (!openaiKey) throw new Error('Cadastre a chave da OpenAI na aba Modelos para usar modelos GPT.');
  return openaiKey;
}

export function chat(opts) {
  if (!isOpenAI(opts.model)) return ollama.chat(opts);
  return openai.chat({ ...opts, key: openaiKey(), model: opts.model.slice(PREFIX.length) });
}

export function embed(model, inputs) {
  if (!isOpenAI(model)) return ollama.embed(model, inputs);
  return openai.embed(openaiKey(), model.slice(PREFIX.length), inputs);
}

// Modelo disponível para uso? (Ollama: instalado; OpenAI: chave cadastrada)
export async function available(model) {
  if (isOpenAI(model)) return !!getSettings().openaiKey;
  try {
    const models = await ollama.listModels();
    return models.some((m) => m.name === model || m.name === model + ':latest');
  } catch {
    return false;
  }
}
