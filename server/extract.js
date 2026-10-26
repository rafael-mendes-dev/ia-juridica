import path from 'node:path';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)\s*>|<br\s*\/?>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*(\n\s*)+/g, '\n\n')
    .trim();
}

// Extrai texto de arquivos enviados pelo usuário
export async function extractFile(filename, buffer) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    return text.join('\n\n');
  }
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    return value;
  }
  const text = new TextDecoder('utf-8').decode(buffer);
  if (ext === '.html' || ext === '.htm') return htmlToText(text);
  if (['.txt', '.md', '.markdown', '.csv', '.json', '.rtf', ''].includes(ext)) return text;
  throw new Error(`Formato não suportado: ${ext}. Use PDF, DOCX, TXT, MD ou HTML.`);
}
