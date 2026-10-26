const MAX = 1400;
const OVERLAP = 150;

// Extrai o front matter YAML simples do repositório de leis (campos "chave: valor")
export function parseFrontMatter(md) {
  const meta = {};
  let body = md;
  const m = md.match(/^(?:---\s*\n)+([\s\S]*?)\n---\s*\n/);
  if (m) {
    body = md.slice(m[0].length);
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([a-z_]+):\s*(.*)$/);
      if (!kv) continue;
      let v = kv[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) {
        try { v = JSON.parse(v); } catch { v = v.slice(1, -1); }
      } else if (v === 'true' || v === 'false') v = v === 'true';
      meta[kv[1]] = v;
    }
  }
  return { meta, body };
}

const ART_RE = /^\s*\**\s*Art\.?\s*(\d+[\w\-ºo°]*)/i;
const HEAD_RE = /^#{2,6}\s+(.*)/;

// Divide um texto legal em trechos por artigo, agrupando artigos curtos
export function chunkLegal(body) {
  const lines = body.split(/\r?\n/);
  const arts = [];
  let cur = null;
  let section = '';
  const preamble = [];
  for (const line of lines) {
    const h = line.match(HEAD_RE);
    if (h) {
      section = h[1].replace(/\*/g, '').trim();
      continue;
    }
    const a = line.match(ART_RE);
    if (a) {
      cur = { art: a[1].replace(/[ºo°]$/, ''), section, lines: [line] };
      arts.push(cur);
    } else if (cur) cur.lines.push(line);
    else preamble.push(line);
  }
  if (!arts.length) return chunkText(body);

  const out = [];
  const pre = preamble.join('\n').trim();
  if (pre) out.push(...chunkText(pre).map((c) => ({ ...c, heading: 'Preâmbulo' })));

  let group = null;
  const flush = () => {
    if (!group) return;
    const first = group.arts[0];
    const last = group.arts[group.arts.length - 1];
    const label = first === last ? `Art. ${first}` : `Arts. ${first} a ${last}`;
    out.push({ heading: group.section ? `${label} — ${group.section}` : label, text: group.text.trim() });
    group = null;
  };
  for (const a of arts) {
    const text = a.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > MAX) {
      flush();
      for (const part of splitLong(text)) {
        out.push({ heading: `Art. ${a.art}${a.section ? ' — ' + a.section : ''}`, text: part });
      }
      continue;
    }
    if (group && (group.text.length + text.length > MAX || group.section !== a.section)) flush();
    if (!group) group = { arts: [], text: '', section: a.section };
    group.arts.push(a.art);
    group.text += '\n\n' + text;
  }
  flush();
  return out;
}

// Trechos genéricos por parágrafo, com sobreposição
export function chunkText(text) {
  const paras = text.replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let buf = '';
  for (const p of paras) {
    if (p.length > MAX) {
      if (buf) { out.push(buf); buf = ''; }
      out.push(...splitLong(p));
      continue;
    }
    if (buf && buf.length + p.length > MAX) {
      out.push(buf);
      buf = buf.slice(-OVERLAP).replace(/^\S*\s/, '') + '\n\n' + p;
    } else buf = buf ? buf + '\n\n' + p : p;
  }
  if (buf) out.push(buf);
  return out.map((t) => ({ heading: null, text: t }));
}

function splitLong(text) {
  const parts = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + MAX, text.length);
    if (end < text.length) {
      const cut = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf('. ', end));
      if (cut > i + MAX / 2) end = cut + 1;
    }
    parts.push(text.slice(i, end).trim());
    if (end >= text.length) break;
    // recomeça um pouco antes do corte, em início de linha ou de palavra
    let next = end - OVERLAP;
    const nl = text.indexOf('\n', next);
    if (nl > 0 && nl < end) next = nl + 1;
    else {
      const sp = text.indexOf(' ', next);
      next = sp > 0 && sp < end ? sp + 1 : end;
    }
    i = Math.max(next, i + 1);
  }
  return parts.filter(Boolean);
}
