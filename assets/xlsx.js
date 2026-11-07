// Ficheiro Excel (.xlsx) simples, sem bibliotecas: uma folha por tabela, 1.ª linha em negrito e fixa, filtros.
import { zip } from './plano.js?v=20261107k';

const x = (t) => String(t ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (n) => { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const nomeFolha = (n, usados) => {
  let b = String(n).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Folha';
  let s = b, i = 2;
  while (usados.has(s.toLowerCase())) s = `${b.slice(0, 27)} (${i++})`;
  usados.add(s.toLowerCase());
  return s;
};

function folha(rows) {
  const ncol = Math.max(1, ...rows.map((r) => r.length));
  const larg = Array.from({ length: ncol }, (_, c) =>
    Math.min(60, Math.max(8, ...rows.slice(0, 300).map((r) => String(r[c] ?? '').split('\n')[0].length + 2))));
  const cell = (v, r, c) => {
    const ref = col(c) + (r + 1);
    const st = r === 0 ? ' s="1"' : '';
    if (v == null || v === '') return r === 0 ? `<c r="${ref}"${st}/>` : '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${larg.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, i, c)).join('')}</row>`).join('')}</sheetData>
${rows.length > 1 ? `<autoFilter ref="A1:${col(ncol - 1)}${rows.length}"/>` : ''}
</worksheet>`;
}

/** folhas = [{ nome, linhas: [[cabeçalho...], [valores...], ...] }] → Blob .xlsx */
export function gerarXlsx(folhas) {
  const usados = new Set();
  const fs = folhas.map((f) => ({ ...f, nome: nomeFolha(f.nome, usados) }));
  const enc = new TextEncoder();
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${fs.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
${fs.map((f, i) => `<sheet name="${x(f.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames>${fs.map((f, i) => (f.linhas.length > 1 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(f.nome).replace(/'/g, "''")}'!$A$1:$${col(Math.max(1, ...f.linhas.map((r) => r.length)) - 1)}$${f.linhas.length}</definedName>` : '')).join('')}</definedNames></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${fs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563A8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`],
    ...fs.map((f, i) => [`xl/worksheets/sheet${i + 1}.xml`, folha(f.linhas)]),
  ].map(([n, t]) => [n, enc.encode(t)]);
  return zip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
