// Leitura de ficheiros .xlsx / .csv e mapeamento de colunas para a importação em lote.
// Sem dependências: usa DecompressionStream (browsers atuais e Node 18+) e expressões regulares.

/* ---------------- ZIP (.xlsx é um ficheiro zip de XMLs) ---------------- */
async function unzip(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('O ficheiro não é um Excel (.xlsx) válido.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    files[name] = { method, data: new Uint8Array(buf, start, csize) };
    p += 46 + nlen + elen + clen;
  }
  return {
    has: (name) => name in files,
    async text(name) {
      const f = files[name];
      if (!f) return null;
      if (f.method === 0) return dec.decode(f.data);
      const stream = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return dec.decode(await new Response(stream).arrayBuffer());
    },
  };
}

/* ---------------- XML mínimo ---------------- */
const unxml = (s) => s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_, h, d, n) =>
  h ? String.fromCodePoint(parseInt(h, 16)) : d ? String.fromCodePoint(+d) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[n.toLowerCase()]);
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];
const T = (tag) => `<(?:\\w+:)?${tag}\\b`;
const texts = (xml) => [...xml.replace(new RegExp(`${T('rPh')}[\\s\\S]*?</(?:\\w+:)?rPh>`, 'g'), '')
  .matchAll(new RegExp(`${T('t')}[^>]*?(?:/>|>([\\s\\S]*?)</(?:\\w+:)?t>)`, 'g'))].map((m) => unxml(m[1] || '')).join('');

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readXlsx(buf) {
  const zip = await unzip(buf);
  const wb = await zip.text('xl/workbook.xml');
  if (!wb) throw new Error('O ficheiro não é um Excel (.xlsx) válido.');
  const rels = (await zip.text('xl/_rels/workbook.xml.rels')) || '';
  const relMap = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const shared = [];
  const ss = await zip.text('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(new RegExp(`${T('si')}[^>]*>([\\s\\S]*?)</(?:\\w+:)?si>`, 'g'))) shared.push(texts(m[1]));

  const sheets = [];
  for (const m of wb.matchAll(new RegExp(`${T('sheet')}\\b[^>]*>`, 'g'))) {
    const name = unxml(attr(m[0], 'name') || 'Folha');
    let target = relMap[attr(m[0], 'r:id')] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const xml = await zip.text(target);
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(new RegExp(`${T('row')}[^>]*?(?:/>|>([\\s\\S]*?)</(?:\\w+:)?row>)`, 'g'))) {
      const row = [];
      let auto = 0;
      for (const c of (r[1] || '').matchAll(new RegExp(`${T('c')}([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?c>)`, 'g'))) {
        const ref = attr(c[1], 'r');
        const idx = ref ? colIndex(ref) : auto;
        auto = idx + 1;
        const type = attr(c[1], 't');
        const inner = c[2] || '';
        const v = (inner.match(new RegExp(`${T('v')}[^>]*>([\\s\\S]*?)</(?:\\w+:)?v>`)) || [])[1];
        let val = null;
        if (type === 's') val = shared[+v] ?? '';
        else if (type === 'inlineStr') val = texts(inner);
        else if (type === 'b') val = v === '1';
        else if (type === 'str' || type === 'e') val = v != null ? unxml(v) : '';
        else if (v != null) val = Number(v);
        row[idx] = val;
      }
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

/* ---------------- CSV ---------------- */
function readCsv(buf) {
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // ficheiros gravados pelo Excel em PT
  return [{ name: 'CSV', rows: parseCsvText(text) }];
}

function parseCsvText(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * CSV sem aspas: «Caseking Iberia, Unipessoal Lda,Aceite,…» tem colunas a mais.
 * As vírgulas a mais estão quase sempre no nome (1.ª coluna) — juntam-se outra vez.
 */
function juntarVirgulasNoNome(rows) {
  const hi = rows.findIndex((r) => r && r.some((c) => c != null && String(c).trim() !== ''));
  if (hi < 0) return rows;
  const n = rows[hi].length;
  return rows.map((r, i) => {
    if (i <= hi || !r || r.length <= n) return r;
    const row = [...r];
    const extra = row.length - n;
    return [row.slice(0, extra + 1).map((c) => String(c ?? '').trim()).filter(Boolean).join(', '), ...row.slice(extra + 1)];
  });
}

/**
 * Excel com um CSV «colado» na coluna A (ex.: «Empresa,Status,Contacto,…» numa só célula).
 * O Excel parte essas linhas nos «;» (para a coluna B) e nas mudanças de linha dentro de aspas (linhas seguintes);
 * junta-se tudo outra vez e lê-se como CSV.
 */
function csvNaColunaA(rows) {
  const hi = rows.findIndex((r) => r && r.some((c) => c != null && String(c).trim() !== ''));
  if (hi < 0) return null;
  const h = rows[hi].filter((c) => c != null && String(c).trim() !== '');
  if (h.length !== 1 || typeof h[0] !== 'string' || (h[0].match(/[,;\t]/g) || []).length < 2) return null;
  const text = rows.slice(hi).map((r) => (r || []).filter((c) => c != null).map(String).join(';')).join('\n');
  return parseCsvText(text);
}

/** Lê o ficheiro e devolve [{name, headers, rows: [[...]]}] com a 1.ª linha não vazia como cabeçalho. */
export async function parseFile(fileName, buf) {
  const sheets = /\.csv$|\.txt$/i.test(fileName) ? readCsv(buf) : await readXlsx(buf);
  for (const s of sheets) {
    const csv = csvNaColunaA(s.rows);
    if (csv) { s.rows = csv; s.csvColado = true; }
    if (csv || /\.csv$|\.txt$/i.test(fileName)) s.rows = juntarVirgulasNoNome(s.rows);
  }
  return sheets.map((s) => {
    const nonEmpty = (r) => r && r.some((c) => c !== null && c !== undefined && String(c).trim() !== '');
    const hi = s.rows.findIndex(nonEmpty);
    if (hi < 0) return { name: s.name, headers: [], rows: [] };
    const headers = Array.from(s.rows[hi], (h, i) => (h == null || String(h).trim() === '' ? `Coluna ${i + 1}` : String(h).trim()));
    const rows = s.rows.slice(hi + 1).filter(nonEmpty);
    return { name: s.name, headers, rows, csvColado: !!s.csvColado };
  }).filter((s) => s.headers.length);
}

/* ---------------- Mapeamento ---------------- */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '');

// Entidades que podem ser importadas e campos excluídos do mapeamento (preenchidos pela aplicação)
export const IMPORT_TARGETS = ['alunos', 'empresas', 'colocacoes'];
const SKIP = ['ano_letivo', 'estado'];

// o estado das empresas pode vir do ficheiro (ex.: coluna «Status»: Aceite, Contactada, Não aceitou…)
export function importFields(schema, entity) {
  return schema.entities[entity].fields.filter((f) => f.type !== 'ref' && (!SKIP.includes(f.name) || (entity === 'empresas' && f.name === 'estado')));
}

/**
 * Propõe um mapeamento {entidade: {campo: índiceColuna}}.
 * Prioridade: mapeamento guardado (pelo nome do cabeçalho) > aliases do schema > nome/rótulo do campo.
 */
export function autoMap(schema, headers, saved = {}, { soEmpresas = false } = {}) {
  const H = headers.map(norm);
  // «Entidade - Morada», «Empresa - Telefone» → «morada», «telefone»
  const H2 = soEmpresas ? H.map((h) => h.replace(/^(entidade|entid|empresa)(?=.)/, '')) : H;
  const map = {};
  for (const ent of IMPORT_TARGETS) {
    map[ent] = {};
    for (const f of importFields(schema, ent)) {
      const savedHeader = saved[ent]?.[f.name];
      let idx = savedHeader != null ? headers.indexOf(savedHeader) : -1;
      if (idx < 0 && savedHeader !== null) { // null = o utilizador escolheu «ignorar»
        // sinónimos genéricos («Email», «Telefone»…) só numa lista de empresas, para não confundir com colunas dos alunos
        for (const alias of [...(f.aliases || []), ...(soEmpresas ? f.aliases_lote || [] : [])]) {
          idx = H.indexOf(norm(alias));
          if (idx < 0) idx = H2.indexOf(norm(alias));
          if (idx >= 0 && Object.values(map[ent]).includes(idx)) idx = -1; // cada coluna só num campo
          if (idx >= 0) break;
        }
      }
      if (idx >= 0) map[ent][f.name] = idx;
    }
  }
  return map;
}

/** Converte nº de série de data do Excel (ou texto dd/mm/aaaa) para AAAA-MM-DD. */
export function toIsoDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : s;
}

/** Constrói as linhas a enviar ao servidor: [{alunos:{...}, empresas:{...}, colocacoes:{...}}]. */
export function buildLines(schema, rows, map) {
  return rows.map((row) => {
    const line = {};
    for (const ent of IMPORT_TARGETS) {
      const obj = {};
      for (const f of importFields(schema, ent)) {
        const idx = map[ent]?.[f.name];
        if (idx == null) continue;
        let v = row[idx];
        if (v == null || String(v).trim() === '') continue;
        if (f.type === 'date') v = toIsoDate(v);
        else if (f.type === 'number') v = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
        else v = typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v).replace(/\s+/g, ' ').trim();
        obj[f.name] = v;
      }
      line[ent] = obj;
    }
    return line;
  });
}
