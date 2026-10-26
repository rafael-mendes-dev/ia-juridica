import { htmlToText } from './extract.js';
import { fetchPageText } from './docs.js';
import { tokens } from './catalog.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const HEADERS = { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9' };

function cleanUrl(url) {
  url = url.replace(/&amp;/g, '&');
  const ddg = url.match(/[?&]uddg=([^&]+)/);
  if (ddg) url = decodeURIComponent(ddg[1]);
  const bing = url.match(/bing\.com\/ck\/a\?.*?[?&]u=a1([^&]+)/);
  if (bing) {
    try { url = Buffer.from(bing[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch {}
  }
  if (url.startsWith('//')) url = 'https:' + url;
  return url;
}

const isAd = (url) => /duckduckgo\.com\/(y\.js|duckduckgo-help-pages)|bing\.com\/aclick|^\/|^javascript:/.test(url);

// Extrai resultados quebrando o HTML em blocos que começam no marcador de cada resultado
function parseBlocks(html, start, linkRe, snippetRe) {
  return html.split(start).slice(1).map((b) => {
    const a = b.match(linkRe);
    if (!a) return null;
    const url = cleanUrl(a[1]);
    if (isAd(url)) return null;
    return { url, title: htmlToText(a[2]), snippet: htmlToText((b.match(snippetRe) || [])[1] || '') };
  }).filter(Boolean);
}

// Buscadores sem chave de API, tentados em ordem (o DuckDuckGo às vezes pede verificação anti-robô)
const ENGINES = [
  async (q) => {
    const res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST', headers: { ...HEADERS, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ q, kl: 'br-pt' }), signal: AbortSignal.timeout(10000),
    });
    if (res.status !== 200) return [];
    return parseBlocks(await res.text(), /(?=<a[^>]*class="result__a")/, /^<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/, /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
  },
  async (q) => {
    const res = await fetch('https://lite.duckduckgo.com/lite/?' + new URLSearchParams({ q, kl: 'br-pt' }), { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (res.status !== 200) return [];
    return parseBlocks(await res.text(), /(?=<a[^>]*class=['"]result-link['"])/, /^<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/, /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/);
  },
  async (q) => {
    const res = await fetch('https://www.bing.com/search?' + new URLSearchParams({ q, setlang: 'pt-BR', cc: 'BR' }), { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (res.status !== 200) return [];
    return parseBlocks(await res.text(), /(?=<li class="b_algo")/, /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/, /<p[^>]*>([\s\S]*?)<\/p>/);
  },
];

export async function webSearch(query, max = 6) {
  let lastErr;
  for (const engine of ENGINES) {
    try {
      const r = await engine(query);
      if (r.length) return r.slice(0, max);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

// Seleciona os parágrafos mais relevantes de uma página para a pergunta
function bestPassages(text, query, maxChars = 1800) {
  const q = new Set(tokens(query));
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 60);
  const scored = paras.map((p, i) => {
    const t = tokens(p);
    let s = 0;
    for (const x of t) if (q.has(x)) s++;
    return { p, i, s: s / Math.sqrt(t.length + 5) };
  }).sort((a, b) => b.s - a.s);
  const picked = [];
  let len = 0;
  for (const x of scored) {
    if (len + x.p.length > maxChars) continue;
    picked.push(x);
    len += x.p.length;
    if (len > maxChars * 0.8) break;
  }
  return picked.sort((a, b) => a.i - b.i).map((x) => x.p).join('\n\n');
}

export async function webContext(query, { pages = 3 } = {}) {
  const results = await webSearch(query);
  const out = await Promise.all(results.slice(0, pages + 2).map(async (r) => {
    try {
      const { text } = await fetchPageText(r.url, 8000);
      const passage = bestPassages(text, query);
      return passage ? { ...r, text: passage } : null;
    } catch {
      return r.snippet ? { ...r, text: r.snippet } : null;
    }
  }));
  return out.filter(Boolean).slice(0, pages);
}
