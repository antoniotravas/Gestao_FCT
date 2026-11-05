// Plano de estágio (modelo «Plano_Andreo.pdf» da escola) gerado como documento Word (.docx), sem bibliotecas.
// O .docx é um ZIP com XML (WordprocessingML); é montado aqui no browser e descarregado.

export const OBJ_GERAIS = [
  'Aplicar a contextos reais de trabalho os conhecimentos e as competências adquiridos nas várias disciplinas que compõem o curso;',
  'Tomar consciência da dinâmica inerente ao mundo do trabalho;',
  'Assumir a responsabilidade pelos trabalhos realizados;',
  'Desenvolver hábitos saudáveis no domínio da sociabilização, solidariedade, respeito pelos outros e por si próprio;',
  'Cooperar no desempenho de tarefas coletivas;',
  'Aplicar a autonomia e a criatividade em contexto de trabalho;',
  'Compreender a importância da comunicação na gestão das relações interpessoais;',
  'Adaptar-se às normas de funcionamento de uma empresa / instituição;',
  'Apresentar-se adequadamente e manter uma postura consentânea com as regras de etiqueta e da entidade de acolhimento;',
  'Assumir a importância da pontualidade e assiduidade;',
  'Observar, reconhecer e executar as regras de higiene e segurança no trabalho.',
  'Avaliar criticamente sucessos e insucessos dos seus procedimentos;',
  'Assimilar a importância do conhecimento dos serviços a prestar;',
  'Gerar entusiasmo e convicção pelas atividades desenvolvidas com autoconfiança e espírito positivo.',
  'Compreender e ouvir atentamente os interlocutores;',
].join('\n');

export const OBJ_ESPECIFICOS = [
  'Criação, consulta e atualização de bases de dados',
  'Instalação de aplicações',
  'Reparação de hardware',
  'Instalação e manutenção de redes de computadores',
  'Gestão de utilizadores na rede',
  'Desenvolvimento e manutenção de software',
].join('\n');

const AVALIACAO = [
  { dom: '1. Saber e Saber Fazer\n(Competências Técnico-Profissionais)\n(50%)', n: 1, ind: [
    'Revela conhecimentos e competências teórico/práticas na execução das atividades previstas no plano individual de trabalho',
    'Mostra interesse e facilidade de adaptação a novas tarefas/conhecimentos',
    'Revela organização no trabalho, definindo prioridades e aplicando métodos adequados à concretização das tarefas solicitadas;',
    'Revela destreza na realização das tarefas, não pondo em causa a qualidade do trabalho realizado',
    'Usa linguagem e vocabulário técnico-científico adequados',
    'Revela autonomia e capacidade de iniciativa',
    'Aplica as normas de segurança e higiene, evitando acidentes que ponham em risco a sua segurança e/ou a dos outros'] },
  { dom: '2. Saber e Saber Estar\n(Competências Socioprofissionais)\n(30%)', n: 2, ind: [
    'Trabalha colaborativamente',
    'Revela integração na entidade de estágio',
    'Apresenta um bom relacionamento com as chefias, monitor (tutor), colegas, clientes e outros profissionais',
    'Cumpre o dever de sigilo profissional',
    'Apresenta-se de forma cuidada e demonstra ter comportamento adequado ao contexto de trabalho',
    'Cumpre as regras de pontualidade e assiduidade definidas'] },
  { dom: '3. Saber comunicar\n(20%)', n: 3, ind: [
    'Usa a linguagem escrita de forma correta, recorrendo a vocabulário técnico-científico específico da sua área de formação',
    'Descreve de forma correta as atividades realizadas e as metodologias aplicadas na empresa',
    'Apresenta iconografia (imagens) apelativa e articulada com o texto',
    'Respeita a estrutura definida para elaboração do relatório escrito',
    'Cumpre prazos'] },
];

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dataExtenso = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
};
const dmy = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const lines = (t) => String(t || '').split(/\r?\n/).map((s) => s.replace(/^\s*[-•●*]\s*/, '').trim()).filter(Boolean);
const join = (...a) => a.filter((x) => x != null && String(x).trim() !== '').join(', ');

/**
 * Junta os dados da base de dados e o conteúdo variável do plano.
 * ctx = { aluno, empresa, col (afetação), plano (conteúdo variável, pode ser {}), atividades: [], s (definições), p (perfil) }
 * Sem professor acompanhante na afetação, é o diretor de curso (dados do perfil).
 */
export function planoVars({ aluno = {}, empresa = {}, col = {}, plano = {}, atividades = [], s = {}, p = {} }) {
  const norm = (t) => String(t || '').trim().toLowerCase();
  const profDiretor = !norm(col.professor_acompanhante) || norm(col.professor_acompanhante) === norm(p.diretor_curso || s.diretor_curso);
  const nomeDiretor = p.diretor_curso || s.diretor_curso || '';
  const ano = col.ano_letivo || aluno.ano_letivo || s.ano_letivo || '';
  const ee = aluno.encarregado
    ? { nome: aluno.encarregado, morada: aluno.morada_encarregado, concelho: aluno.concelho_encarregado,
        cp: aluno.codigo_postal_encarregado, email: aluno.email_encarregado, tel: aluno.contacto_encarregado }
    : { nome: aluno.nome, morada: aluno.morada, concelho: aluno.concelho || aluno.localidade, // aluno maior de idade
        cp: aluno.codigo_postal, email: aluno.email, tel: aluno.telefone };
  const anoDoc = (plano.data_documento || col.data_inicio || '').slice(0, 4) || (ano.split('/')[1] || '').trim();
  const horasFct = col.horas_previstas ? String(Number(col.horas_previstas)) : s.horas_fct;
  const curso = s.curso || aluno.curso || '';
  return {
    escola: s.escola || '',
    curso,
    ano_letivo: ano.replace(/\s*\/\s*/, ' / '),
    horas_fct: horasFct || '',
    area_formacao: s.area_formacao || '',
    duracao_total: s.duracao_total || '', duracao_sociocultural: s.duracao_sociocultural || '',
    duracao_cientifica: s.duracao_cientifica || '', duracao_tecnica: s.duracao_tecnica || '',
    periodo: col.data_inicio && col.data_fim ? `de ${dataExtenso(col.data_inicio)} até ${dataExtenso(col.data_fim)}`
      : col.data_inicio ? `a partir de ${dataExtenso(col.data_inicio)}` : '',
    horario: plano.horario || col.horario || s.horario_fct || '',
    objetivos_gerais: lines(plano.objetivos_gerais || s.objetivos_gerais || OBJ_GERAIS),
    objetivos_especificos: lines(plano.objetivos_especificos || s.objetivos_especificos || OBJ_ESPECIFICOS),
    informacao_adicional: String(plano.informacao_adicional || '').trim(),
    local_data: plano.data_documento
      ? `${s.localidade_escola || ''}${s.localidade_escola ? ', ' : ''}${dataExtenso(plano.data_documento)}`
      : `${s.localidade_escola || '_______________'}, ________ de _________________ de ${anoDoc || '______'}`,
    ano_doc: anoDoc,
    aluno: { nome: aluno.nome, numero: aluno.numero, cc: aluno.cc, nascimento: dmy(aluno.data_nascimento),
      validade: dmy(aluno.validade_identificacao), morada: aluno.morada, concelho: aluno.concelho || aluno.localidade,
      cp: aluno.codigo_postal, email: aluno.email, tel: aluno.telefone },
    ee,
    prof: { nome: col.professor_acompanhante || nomeDiretor, morada: [s.morada_escola, s.escola && `(${s.escola})`].filter(Boolean).join(' '),
      concelho: s.concelho_escola, cp: s.codigo_postal_escola,
      email: col.email_professor || (profDiretor ? p.email_diretor : ''), tel: col.telefone_professor || (profDiretor ? p.telefone_diretor : ''),
      eDiretor: !norm(col.professor_acompanhante) },
    turma: aluno.turma || '',
    emp: { nome: empresa.nome, atividade: empresa.setor, nif: empresa.nif, natureza: empresa.natureza_juridica,
      tipo: empresa.tipo, morada: empresa.morada, concelho: empresa.localidade, cp: empresa.codigo_postal,
      email: empresa.email, tel: empresa.telefone },
    tutor: { nome: col.tutor || empresa.responsavel, cargo: col.cargo_tutor || empresa.cargo_responsavel,
      email: col.email_tutor || empresa.email_responsavel, tel: col.contacto_tutor || empresa.telefone_responsavel },
    atividades: atividades.map((a) => ({ descricao: a.descricao || '', mes: a.mes || '', observacoes: a.observacoes || '' })),
  };
}

/** Campos em falta (para avisar antes de gerar). Devolve [{ grupo, campo }]. */
export function planoEmFalta(v) {
  const chk = [
    ['Definições', 'Escola', v.escola], ['Definições', 'Curso', v.curso], ['Definições', 'Área de formação', v.area_formacao],
    ['Definições', 'Duração total', v.duracao_total], ['Definições', 'Morada da escola', v.prof.morada],
    ['Aluno', 'Nº processo', v.aluno.numero], ['Aluno', 'Identificação (CC)', v.aluno.cc], ['Aluno', 'Data de nascimento', v.aluno.nascimento],
    ['Aluno', 'Morada', v.aluno.morada], ['Aluno', 'Email', v.aluno.email], ['Aluno', 'Telemóvel', v.aluno.tel],
    ['Empresa', 'NIF', v.emp.nif], ['Empresa', 'Morada', v.emp.morada], ['Empresa', 'Atividade principal', v.emp.atividade],
    [v.prof.eDiretor ? 'Perfil' : 'Afetação', 'Professor acompanhante', v.prof.nome],
    [v.prof.eDiretor ? 'Perfil' : 'Afetação', v.prof.eDiretor ? 'O meu email' : 'Email do professor', v.prof.email],
    [v.prof.eDiretor ? 'Perfil' : 'Afetação', v.prof.eDiretor ? 'O meu telemóvel' : 'Telemóvel do professor', v.prof.tel],
    ['Afetação', 'Tutor', v.tutor.nome], ['Afetação', 'Período (datas de início e fim)', v.periodo],
  ];
  return chk.filter(([, , val]) => !val || !String(val).trim()).map(([grupo, campo]) => ({ grupo, campo }));
}

/* ======================= WordprocessingML ======================= */
const FONT = 'Tahoma';
const AZUL = 'DBE5F1';
const W = 9866; // largura útil (twips): A4 11906 − 2 × 1020

const x = (t) => String(t ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Texto (run). o = { b, i, u, sz (pt), color, font, caps } */
function r(text, o = {}) {
  const pr = [
    o.font ? `<w:rFonts w:ascii="${o.font}" w:hAnsi="${o.font}" w:cs="${o.font}"/>` : '',
    o.b ? '<w:b/>' : '', o.i ? '<w:i/>' : '', o.caps ? '<w:caps/>' : '',
    o.color ? `<w:color w:val="${o.color}"/>` : '',
    o.sz ? `<w:sz w:val="${Math.round(o.sz * 2)}"/><w:szCs w:val="${Math.round(o.sz * 2)}"/>` : '',
    o.u ? '<w:u w:val="single"/>' : '',
  ].join('');
  return String(text ?? '').split('\n').map((t, i) =>
    `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`).join('');
}
const tab = '<w:r><w:tab/></w:r>';
const fld = (instr, o = {}) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r('1', o)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

/** Parágrafo. o = { align, before, after (pt), line (240=simples), keepNext, pageBreak, ind (twips), hanging, bullet, tabs:[[pos,'right']], border } */
function p(runs = '', o = {}) {
  const pr = [
    o.style ? `<w:pStyle w:val="${o.style}"/>` : '',
    o.keepNext ? '<w:keepNext/>' : '', o.pageBreak ? '<w:pageBreakBefore/>' : '',
    o.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '',
    o.border || '',
    o.tabs ? `<w:tabs>${o.tabs.map(([pos, al]) => `<w:tab w:val="${al || 'left'}" w:pos="${pos}"/>`).join('')}</w:tabs>` : '',
    `<w:spacing w:before="${Math.round((o.before ?? 0) * 20)}" w:after="${Math.round((o.after ?? 0) * 20)}" w:line="${o.line ?? 252}" w:lineRule="auto"/>`,
    o.ind != null || o.hanging ? `<w:ind w:left="${o.ind ?? 0}"${o.hanging ? ` w:hanging="${o.hanging}"` : ''}/>` : '',
    o.align ? `<w:jc w:val="${o.align}"/>` : '',
  ].join('');
  return `<w:p><w:pPr>${pr}</w:pPr>${runs}</w:p>`;
}

/**
 * Tabela. cols = larguras (twips). rows = [{ cells: [...], h, exact, header, cant }]
 * célula = { c: conteúdo XML (parágrafos), span, shade, vAlign, vMerge: 'restart'|'continue', nob (sem bordas) }
 */
function tbl(cols, rows, o = {}) {
  const bd = o.noBorders ? 'nil' : 'single';
  const borders = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((k) => `<w:${k} w:val="${bd}" w:sz="4" w:space="0" w:color="${o.borderColor || '404040'}"/>`).join('')}</w:tblBorders>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${cols.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${o.center ? '<w:jc w:val="center"/>' : ''}
    ${borders}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="20" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:bottom w:w="20" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>
    <w:tblGrid>${cols.map((c) => `<w:gridCol w:w="${c}"/>`).join('')}</w:tblGrid>
    ${rows.map((row) => {
      let ci = 0;
      return `<w:tr><w:trPr>${row.cant !== false ? '<w:cantSplit/>' : ''}${row.header ? '<w:tblHeader/>' : ''}${row.h ? `<w:trHeight w:val="${row.h}" w:hRule="${row.exact ? 'exact' : 'atLeast'}"/>` : ''}</w:trPr>
      ${row.cells.map((cell) => {
        const span = cell.span || 1;
        const w = cols.slice(ci, ci + span).reduce((a, b) => a + b, 0);
        ci += span;
        return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}
          ${cell.vMerge ? `<w:vMerge${cell.vMerge === 'restart' ? ' w:val="restart"' : ''}/>` : ''}
          ${cell.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.shade}"/>` : ''}
          <w:vAlign w:val="${cell.vAlign || 'center'}"/></w:tcPr>${cell.c || p()}</w:tc>`;
      }).join('')}</w:tr>`;
    }).join('')}</w:tbl>`;
}

const cellP = (runs, o = {}) => p(runs, { before: 1, after: 1, ...o });
const lv = (label, value) => cellP(r(label + ': ', { b: true }) + r(value || ''));
const spacer = (pt = 6) => p('', { after: pt, line: 240 });

/** Bloco de identificação (secções 1 a 5): título + linhas «Rótulo: valor», uma ou duas por linha. */
function identBloco(titulo, linhas) {
  const cols = [5900, W - 5900];
  return tbl(cols, [
    { cells: [{ span: 2, c: cellP(r(titulo, { b: true, sz: 6.5 })) }] },
    ...linhas.map((l) => ({ h: 300, cells: l.length === 1 ? [{ span: 2, c: lv(...l[0]) }] : l.map((pair) => ({ c: lv(...pair) })) })),
  ]) + spacer(8);
}

function caixaTitulo(texto) {
  return tbl([W], [{ h: 380, cells: [{ shade: AZUL, c: cellP(r(texto, { b: true, sz: 10 }), { align: 'center' }) }] }]);
}

/* ---------- Páginas ---------- */
/** Ajusta uma imagem (w×h px) a uma caixa máxima (pt), mantendo as proporções. */
const caber = (im, maxW, maxH) => {
  const k = Math.min(maxW / im.w, maxH / im.h);
  return [im.w * k, im.h * k];
};

function capa(v, logos) {
  const AZUL_ESC = '1F3864', AZUL_MED = '2E74B5', CINZA = '595959';
  const logo = (k, rid, id, maxW, maxH, al) => {
    const im = logos[k];
    if (!im) return cellP('', { align: al });
    const [w, h] = caber(im, maxW, maxH);
    return cellP(img(rid, id, w, h, `capa-${k}`), { align: al });
  };
  const regua = '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="6" w:color="2E74B5"/></w:pBdr>';
  const lin = (k, val) => ({ h: 380, cells: [
    { shade: 'EEF3FA', c: cellP(r(k, { b: true, sz: 9, color: AZUL_ESC })) },
    { c: cellP(r(val || '', { sz: 10.5 })) }] });
  return tbl([W / 2, W / 2], [{ cells: [
      { c: logo('escola', 'rIdC1', 201, 95, 105, 'left') },
      { c: logo('rep', 'rIdC2', 202, 150, 60, 'right') }] }], { noBorders: true })
    + p('', { before: 36 })
    + p(r(v.escola.toUpperCase(), { b: true, sz: 14, color: AZUL_ESC }), { align: 'center', after: 4, border: regua })
    + p(r('Plano de Estágio', { sz: 34, color: AZUL_MED, font: 'Calibri Light' }), { align: 'center', before: 18, after: 0, line: 240 })
    + p(r('Formação em Contexto de Trabalho', { sz: 13, color: CINZA }), { align: 'center', after: 40 })
    + p(r('CURSO PROFISSIONAL DE', { b: true, sz: 10, color: CINZA }), { align: 'center', after: 4 })
    + p(r(v.curso, { b: true, sz: 18, color: AZUL_ESC }), { align: 'center', after: 10, line: 260 })
    + p(r('Duração da FCT: ', { sz: 11, color: CINZA }) + r(v.horas_fct ? `${v.horas_fct} horas` : '____ horas', { b: true, sz: 11, color: CINZA }), { align: 'center', after: 4 })
    + p(r('Ano letivo ', { sz: 12 }) + r(v.ano_letivo || '_____ / _____', { b: true, sz: 12 }), { align: 'center', after: 0 })
    + p('', { before: 60 })
    + tbl([2900, W - 2900], [
      lin('Aluno', v.aluno.nome), lin('Nº de processo', v.aluno.numero), lin('Turma', v.turma),
      lin('Entidade de acolhimento', v.emp.nome), lin('Professor acompanhante', v.prof.nome),
      lin('Período', v.periodo)], { borderColor: 'B4C6E7' });
}

function identificacao(v, novaPagina) {
  const a = v.aluno, e = v.ee, pr = v.prof, m = v.emp, t = v.tutor;
  return p(r(v.escola.toUpperCase(), { b: true, sz: 13 }), { align: 'center', before: 6, after: 6, pageBreak: novaPagina })
    + p(r(`CURSO PROFISSIONAL DE ${v.curso.toUpperCase()}`, { b: true, sz: 8 }), { align: 'center', after: 8 })
    + p(r(`DURAÇÃO DA FCT- ${v.horas_fct || '____'} HORAS`, { b: true, sz: 9 }), { align: 'center', after: 10 })
    + caixaTitulo('PLANO DE ESTÁGIO / ROTEIRO DE ATIVIDADES')
    + identBloco('1. IDENTIFICAÇÃO DO ALUNO', [
      [['Nome', a.nome]], [['Documento de Identificação nº', a.cc], ['Data de Nascimento', a.nascimento]],
      [['Validade', a.validade]], [['Morada', a.morada]], [['Concelho', a.concelho], ['Código Postal', a.cp]],
      [['Email', a.email], ['Telemóvel', a.tel]]])
    + identBloco('2. IDENTIFICAÇÃO DO REPRESENTANTE LEGAL DO ALUNO', [
      [['Nome', e.nome]], [['Morada', e.morada]], [['Concelho', e.concelho], ['Código Postal', e.cp]], [['E-mail', e.email], ['Telemóvel', e.tel]]])
    + identBloco('3. IDENTIFICAÇÃO DO PROFESSOR ACOMPANHANTE', [
      [['Nome', pr.nome]], [['Morada', pr.morada]], [['Concelho', pr.concelho], ['Código Postal', pr.cp]], [['E-mail', pr.email], ['Telemóvel', pr.tel]]])
    + identBloco('4. IDENTIFICAÇÃO DA ENTIDADE ENQUADRADORA/EMPRESA DE INTEGRAÇÃO', [
      [['Denominação social', m.nome]], [['Atividade principal', m.atividade], ['NIPC / NIF', m.nif]],
      [['Natureza jurídica', m.natureza], ['Tipo de Entidade', m.tipo]], [['Morada', m.morada]],
      [['Concelho', m.concelho], ['Código Postal', m.cp]], [['E-mail', m.email], ['Telefone', m.tel]]])
    + identBloco('5. IDENTIFICAÇÃO DO TUTOR / RESPONSÁVEL DA ENTIDADE ENQUADRADORA/EMPRESA DE INTEGRAÇÃO', [
      [['Nome', t.nome]], [['Profissão/Cargo', t.cargo]], [['E-mail', t.email], ['Telefone', t.tel]]]);
}

function roteiro(v) {
  const linha = (label, valor, suf = '') => p(r(label + ': ') + r(valor || '______', { b: true }) + r(suf), { after: 5 });
  const horas = (label, val) => linha(label, val, val ? ' horas' : '');
  const bul = (t) => p(r(t), { bullet: true, after: 2 });
  return p(r('6. ROTEIRO DE ATIVIDADES/PLANO DE ESTÁGIO', { b: true, sz: 7.5 }), { pageBreak: true, before: 6, after: 12 })
    + p(r('6.1. Área de Formação:', { b: true }), { ind: 240, after: 12 })
    + tbl([3000, W - 3000], [
      { cells: [{ c: cellP(r('ÁREA DE FORMAÇÃO', { b: true, sz: 10 })) }, { c: cellP(r('CURSO Profissional', { b: true, sz: 10 })) }] },
      { cells: [{ c: cellP(r(v.area_formacao), { align: 'center' }) }, { c: cellP(r(v.curso)) }] },
    ])
    + p('', { after: 10 })
    + p(r('6.2. Curso:', { b: true }), { ind: 240, after: 6 })
    + p(r('Designação') + r(`: Profissional de ${v.curso}`, { b: true }), { after: 5 })
    + horas('Duração Total', v.duracao_total)
    + horas('Duração Componente de Formação Sociocultural', v.duracao_sociocultural)
    + horas('Duração Componente de Formação Científica', v.duracao_cientifica)
    + horas('Duração Componente de Formação Técnica', v.duracao_tecnica)
    + horas('Duração Componente de Formação Prática em Contexto de Trabalho', v.horas_fct)
    + linha('Período da Formação em Contexto de Trabalho', v.periodo)
    + linha('Horário', v.horario)
    + p(r('6.3. Objetivos:', { b: true }), { ind: 240, before: 8, after: 10 })
    + p(r('OBJETIVOS GERAIS:', { b: true, u: true }), { after: 8, keepNext: true })
    + v.objetivos_gerais.map(bul).join('')
    + p(r('OBJETIVOS ESPECÍFICOS:', { b: true, u: true }), { before: 10, after: 8, keepNext: true })
    + v.objetivos_especificos.map(bul).join('');
}

function programaAtividades(v) {
  const cols = [420, 3800, 1900, W - 420 - 3800 - 1900];
  const n = Math.max(v.atividades.length, 11);
  const rows = [{ h: 420, header: true, cells: [
    { span: 2, c: cellP(r('Atividades', { b: true, sz: 8 }), { align: 'center' }) },
    { c: cellP(r('Mês', { b: true, sz: 8 }), { align: 'center' }) },
    { c: cellP(r('Observações', { b: true, sz: 8 }), { align: 'center' }) }] }];
  for (let i = 0; i < n + 2; i++) {
    const a = v.atividades[i] || {};
    rows.push({ h: 400, cells: [
      { c: cellP(r(i < n ? String(i + 1) : '', { sz: 8 })) }, { c: cellP(r(a.descricao, { sz: 8 })) },
      { c: cellP(r(a.mes, { sz: 8 }), { align: 'center' }) }, { c: cellP(r(a.observacoes, { sz: 8 })) }] });
  }
  const extra = v.informacao_adicional
    ? p(r('6.5. Informação adicional:', { b: true }), { before: 14, after: 6, keepNext: true })
      + v.informacao_adicional.split(/\r?\n/).map((l) => p(r(l), { after: 3 })).join('')
    : '';
  const ass = (lbl) => ({ h: 620, cells: [{ c: cellP(r(lbl, { b: true, sz: 8 }), { align: 'center' }) }, { c: cellP('') }] });
  return p(r('6.4. Roteiro de Atividades / Programa de atividades a desenvolver durante o estágio:', { b: true }), { pageBreak: true, before: 6, after: 8 })
    + tbl(cols, rows)
    + extra
    + p(r(v.local_data), { before: 20, after: 18 })
    + tbl([3000, W - 3000 - 200], [
      { h: 440, cells: [{ c: cellP('') }, { c: cellP(r('Assinaturas', { b: true, sz: 8 }), { align: 'center' }) }] },
      ass('O Aluno'), ass('O Professor Acompanhante'), ass('O Monitor')], { center: true })
    + p(r('O Representante legal do aluno', { b: true }) + r(': _________________________________________________________________'), { before: 22 });
}

function fichaAssiduidade(nLinhas) {
  const cols = [1600, 2100, 1400, 1400, 1683, W - 1600 - 2100 - 1400 - 1400 - 1683];
  const hd = (t) => ({ c: cellP(r(t, { b: true, sz: 8 }), { align: 'center' }) });
  const rows = [
    { header: true, h: 380, cells: [{ span: 6, shade: AZUL, c: cellP(r('FICHA DE ASSIDUIDADE', { b: true, sz: 9 }), { align: 'center' }) }] },
    { header: true, h: 440, cells: ['Data', 'Número de horas', 'Entrada', 'Saída', 'Assinatura do Formando', 'Assinatura do Responsável'].map(hd) },
  ];
  const dois = { c: cellP(r(':', { sz: 8 }), { align: 'center' }) };
  for (let i = 0; i < nLinhas; i++) rows.push({ h: 330, exact: true, cells: [{}, {}, dois, dois, {}, {}] });
  return p('', { pageBreak: true, line: 240 })
    + tbl(cols, rows)
    + spacer(10)
    + tbl([W], [{ h: 1800, cells: [{ vAlign: 'top', c: cellP(r('Caracterização da assiduidade e das faltas injustificadas', { b: true, sz: 8 })) }] }]);
}

function sumarios(nLinhas) {
  const cols = [420, 4800, 1500, W - 420 - 4800 - 1500];
  const rows = [
    { header: true, h: 380, cells: [{ span: 4, c: cellP(r('SUMÁRIOS DAS ATIVIDADES A DESENVOLVER DURANTE O ESTÁGIO', { b: true, sz: 9 }), { align: 'center' }) }] },
    { header: true, h: 380, cells: [{ span: 2, c: cellP(r('Atividades', { b: true, sz: 8 }), { align: 'center' }) },
      { c: cellP(r('Mês', { b: true, sz: 8 }), { align: 'center' }) }, { c: cellP(r('Observações', { b: true, sz: 8 }), { align: 'center' }) }] },
  ];
  for (let i = 0; i < nLinhas; i++) rows.push({ h: 900, cells: [{ c: cellP(r(String(i + 1), { sz: 8 })) }, {}, {}, {}] });
  return p('', { pageBreak: true, line: 240 }) + tbl(cols, rows);
}

function avaliacaoFinal(v) {
  const a = v.aluno, pr = v.prof, m = v.emp, t = v.tutor;
  const bloco = (titulo, linhas) => tbl([5200, W - 5200], [
    { cells: [{ span: 2, c: cellP(r(titulo, { b: true, sz: 6.5 }), { align: 'center' }) }] },
    ...linhas.map((l) => ({ h: 250, cells: l.length === 1 ? [{ span: 2, c: lv(...l[0]) }] : l.map((pair) => ({ c: lv(...pair) })) })),
  ]) + spacer(5);
  const cols = [1550, W - 1550 - 1300, 1300];
  const rows = [{ header: true, h: 300, cells: ['Domínios', 'Indicadores de desempenho', 'Classificações']
    .map((h) => ({ shade: AZUL, c: cellP(r(h, { b: true, sz: 7 }), { align: 'center' }) })) }];
  for (const d of AVALIACAO) {
    d.ind.forEach((ind, i) => rows.push({ h: 250, cells: [
      { vMerge: i === 0 ? 'restart' : 'continue', c: i === 0 ? cellP(r(d.dom, { sz: 7.5 }), { align: 'center' }) : cellP('') },
      { c: cellP(r(ind, { sz: 7 })) }, {}] }));
    rows.push({ h: 230, cells: [{ vMerge: 'continue', c: cellP('') },
      { shade: AZUL, c: cellP(r(`Classificação domínio ${d.n}`, { b: true, sz: 7 })) }, { shade: AZUL }] });
  }
  rows.push({ h: 320, cells: [{ span: 2, c: cellP(r('Classificação final ', { b: true, sz: 9 }) + r('(D1*50%+D2*30%+D3*20%)', { sz: 8 }), { align: 'center' }) }, {}] });
  const escala = [['0 – 6', 'Muito Insuficiente'], ['7 – 9', 'Insuficiente'], ['10 – 13', 'Suficiente'], ['14 – 17', 'Bom'], ['18 – 20', 'Muito Bom']];
  return p('', { pageBreak: true, line: 240 })
    + caixaTitulo('FICHA DE AVALIAÇÃO FINAL') + spacer(6)
    + bloco('IDENTIFICAÇÃO DO ALUNO', [[['Nome', a.nome]], [['Email', a.email], ['Telemóvel', a.tel]]])
    + bloco('IDENTIFICAÇÃO DO PROFESSOR ACOMPANHANTE', [[['Nome', pr.nome]], [['Email', pr.email], ['Telemóvel', pr.tel]]])
    + bloco('IDENTIFICAÇÃO DA ENTIDADE / MONITOR', [[['Entidade de Estágio', m.nome]], [['Nome', t.nome]], [['Email', t.email], ['Telemóvel', t.tel]]])
    + tbl(cols, rows)
    + spacer(8)
    + tbl([1566, ...Array(5).fill(1660)], [{ h: 360, cells: [
      { shade: AZUL, c: cellP(r('Escala de Avaliação', { b: true, sz: 7.5 }), { align: 'center' }) },
      ...escala.map(([n, l]) => ({ c: cellP(r(n, { b: true, sz: 7.5 }) + r('\n' + l, { sz: 7 }), { align: 'center' }) }))] }]);
}

function observacoesFinais(v) {
  const c3 = Math.floor(W / 3);
  const linhaAss = (t) => ({ c: cellP(r(t, { b: true, sz: 8 }), { align: 'center' }) + p('', { before: 30 }) + p(r('______________________________'), { align: 'center' }) });
  return p(r('OBSERVAÇÕES (AVALIAÇÃO GLOBAL):', { b: true }), { pageBreak: true, before: 6, after: 8 })
    + tbl([W], [{ h: 7600, cells: [{ vAlign: 'top', c: cellP('') }] }])
    + p('', { after: 24 })
    + tbl([c3, c3, W - 2 * c3], [{ h: 1200, cells: ['O (A) ALUNO (A)', 'O (A) MONITOR(A)', 'O PROFESSOR ACOMPANHANTE'].map(linhaAss) }], { noBorders: true })
    + p(r(`Em ____/ ____/ ${v.ano_doc || '______'}`), { before: 24 });
}

/* ---------- Cabeçalho, rodapé e restantes partes do pacote .docx ---------- */
const EMU = 12700; // por ponto
function img(rid, id, wPt, hPt, name) {
  const cx = Math.round(wPt * EMU), cy = Math.round(hPt * EMU);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${name}"/>
    <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
    <pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>
    <pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
    <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
    </pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function header(v, logos) {
  const [a1, a2] = (v.ano_letivo || ' / ').split(' / ');
  const centro = cellP(r('FORMAÇÃO PRÁTICA EM CONTEXTO DE TRABALHO', { b: true, sz: 10 }), { align: 'center' })
    + cellP(r('Ano Letivo: ', { sz: 10 }) + r(v.ano_letivo ? `${a1} / ${a2}` : '_____ / _____', { b: true, sz: 10 }), { align: 'center' });
  return `${XML}<w:hdr ${NS}>${tbl([1500, W - 1500 - 2100, 2100], [{ cells: [
    { c: cellP(logos.escola ? img('rIdL1', 101, ...caber(logos.escola, 60, 50.6), 'logo-escola') : '') },
    { c: centro, vAlign: 'top' },
    { c: cellP(logos.rep ? img('rIdL2', 102, ...caber(logos.rep, 95, 36), 'logo-republica') : '', { align: 'right' }) }] }], { noBorders: true })}${p('', { after: 0, line: 200 })}</w:hdr>`;
}
function footer(v) {
  return `${XML}<w:ftr ${NS}>${p(r('Aluno:', { b: true, font: 'Times New Roman', sz: 10.5 }) + tab + r(v.aluno.nome || '', { font: 'Times New Roman', sz: 10.5 })
    + tab + r('Nº Processo: ', { b: true, font: 'Times New Roman', sz: 10.5 }) + r(v.aluno.numero || '', { font: 'Times New Roman', sz: 10.5 }),
  { tabs: [[900, 'left'], [7300, 'left']], after: 0 })}${p(fld('PAGE', { sz: 9, font: 'Times New Roman' }), { align: 'center', after: 0 })}</w:ftr>`;
}

const STYLES = `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}" w:eastAsia="${FONT}"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="pt-PT"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

const NUMBERING = `${XML}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="●"/><w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="14"/></w:rPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

/**
 * Gera o .docx. v = planoVars(...); logos = { escola, rep } com { data: Uint8Array, ext: 'jpeg'|'png', w, h (px) } ou null;
 * op = { capa, assiduidade, linhasAssiduidade, sumarios, linhasSumarios, avaliacao }
 */
export function gerarPlanoDocx(v, logos = {}, op = {}) {
  const o = { capa: true, assiduidade: true, linhasAssiduidade: 64, sumarios: true, linhasSumarios: 46, avaliacao: true, ...op };
  const body = (o.capa ? capa(v, logos) : '')
    + identificacao(v, o.capa)
    + roteiro(v)
    + programaAtividades(v)
    + (o.assiduidade ? fichaAssiduidade(o.linhasAssiduidade) : '')
    + (o.sumarios ? sumarios(o.linhasSumarios) : '')
    + (o.avaliacao ? avaliacaoFinal(v) + observacoesFinais(v) : '');
  const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/>
    <w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1560" w:right="1020" w:bottom="1300" w:left="1020" w:header="230" w:footer="420" w:gutter="0"/>
    <w:pgNumType w:start="${o.capa ? 0 : 1}"/>${o.capa ? '<w:titlePg/>' : ''}</w:sectPr>`;
  const doc = `${XML}<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  const media = (k) => `media/logo-${k === 'rep' ? 'republica' : 'escola'}.${logos[k].ext}`;
  const rel = (id, k) => (logos[k] ? `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${media(k)}"/>` : '');
  const enc = new TextEncoder();
  const files = [
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ['docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${x(`Plano de Estágio — ${v.aluno.nome || ''}`)}</dc:title><dc:creator>Gestão FCT</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`],
    ['word/_rels/document.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
${rel('rIdC1', 'escola')}${rel('rIdC2', 'rep')}</Relationships>`],
    ['word/_rels/header1.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rel('rIdL1', 'escola')}${rel('rIdL2', 'rep')}</Relationships>`],
    ['word/document.xml', doc],
    ['word/styles.xml', STYLES],
    ['word/numbering.xml', NUMBERING],
    ['word/header1.xml', header(v, logos)],
    ['word/footer1.xml', footer(v)],
  ].map(([name, s]) => [name, enc.encode(s)]);
  for (const k of ['escola', 'rep']) if (logos[k]) files.push(['word/' + media(k), logos[k].data]);
  return zip(files);
}

/* ---------- ZIP (sem compressão — suficiente para o Word) ---------- */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (d) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function zip(files, type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let off = 0;
  const now = new Date();
  const dosT = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosD = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const [name, data] of files) {
    const nm = enc.encode(name), crc = crc32(data), sz = data.length;
    const lh = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, dosT, 2], [12, dosD, 2], [14, crc, 4], [18, sz, 4], [22, sz, 4], [26, nm.length, 2], [28, 0, 2]]
      .forEach(([o, v, n]) => (n === 4 ? lh.setUint32(o, v, true) : lh.setUint16(o, v, true)));
    const ch = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, dosT, 2], [14, dosD, 2], [16, crc, 4], [20, sz, 4], [24, sz, 4],
      [28, nm.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]]
      .forEach(([o, v, n]) => (n === 4 ? ch.setUint32(o, v, true) : ch.setUint16(o, v, true)));
    parts.push(new Uint8Array(lh.buffer), nm, data);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + sz;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, cdSize, 4], [16, off, 4], [20, 0, 2]]
    .forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type });
}
