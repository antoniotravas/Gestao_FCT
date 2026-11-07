// Gestão FCT — interface (SPA sem dependências)
import { parseFile, autoMap, importFields, buildLines, IMPORT_TARGETS } from './import.js?v=20261107b';
import { planoVars, planoEmFalta, gerarPlanoDocx, OBJ_GERAIS, OBJ_ESPECIFICOS } from './plano.js?v=20261107b';
import { gerarXlsx } from './xlsx.js?v=20261107b';

const S = { schema: null, data: {}, settings: {}, idx: {}, eu: {}, cursos: [], curso_id: 0, diretor: {}, autores: {} };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const main = $('#main');
const dlg = $('#dlg');

const CLOSED_CONTACT = ['Aceite', 'Recusado', 'Concluído'];
const BADGE = {
  ok: ['Parceira', 'Aceite', 'Concluído', 'Assinado', 'Realizada', 'Aprovado', 'Concluída', 'Presente', 'Interessada'],
  warn: ['Em contacto', 'Pendente', 'Por enviar', 'Por fazer', 'Aguarda resposta', 'Enviado', 'Agendada', 'Adiada', 'Em análise', 'Em curso', 'Planeada', 'Atraso', 'Falta justificada', 'Prevista'],
  bad: ['Sem disponibilidade', 'Recusado', 'Devolvido', 'Anulado', 'Cancelada', 'Não aprovado', 'Interrompida', 'Falta'],
};

/* ---------------- Utilitários ---------------- */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return isoDate(d); };
const fmtDate = (v) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '');
const fmtDateTime = (v) => (v ? `${fmtDate(v)} ${v.slice(11, 16)}` : '');
const fmtNum = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 2 }));
const ent = (name) => S.schema.entities[name];
const rows = (name) => S.data[name] || [];
const get = (name, id) => S.idx[name]?.get(Number(id));

function badge(v) {
  if (!v) return '';
  const cls = Object.keys(BADGE).find((k) => BADGE[k].includes(v)) || '';
  return `<span class="badge ${cls}">${esc(v)}</span>`;
}

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = 'toast'), isError ? 5000 : 2500);
}

async function api(action, { e, id, body, ...extra } = {}) {
  const qs = new URLSearchParams({ a: action });
  if (e) qs.set('e', e);
  if (id) qs.set('id', id);
  for (const [k, v] of Object.entries(extra)) if (v != null) qs.set(k, v);
  const opts = body !== undefined
    ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FCT': '1' }, body: JSON.stringify(body) }
    : {};
  const res = await fetch('api.php?' + qs, { credentials: 'same-origin', ...opts });
  let json;
  try { json = await res.json(); } catch { throw new Error('Resposta inválida do servidor (o PHP está ativo?).'); }
  if (res.status === 401 && action !== 'login') { showLogin(false); throw new Error(json.erro); }
  if (!res.ok) throw new Error(json.erro || 'Erro ' + res.status);
  return json;
}

/** Texto que identifica um registo, a partir do modelo "display" do schema (resolve referências). */
function label(name, id, depth = 0) {
  const r = typeof id === 'object' ? id : get(name, id);
  if (!r) return id ? '(removido)' : '';
  const e = ent(name);
  return e.display.replace(/\{(\w+)\}/g, (_, k) => {
    const f = e.fields.find((x) => x.name === k);
    if (f?.type === 'ref') return depth < 2 ? label(f.ref, r[k], depth + 1) : '';
    if (f?.type === 'date') return fmtDate(r[k]);
    return r[k] ?? '';
  }).replace(/\s+/g, ' ').trim();
}

function fmtValue(f, v, linkRefs = true) {
  if (v == null || v === '') return '';
  switch (f.type) {
    case 'date': return fmtDate(v);
    case 'datetime-local': return fmtDateTime(v);
    case 'number': return fmtNum(v);
    case 'select': return f.name === 'estado' || f.name === 'resultado' ? badge(v) : esc(v);
    case 'email': return `<a href="mailto:${esc(v)}" onclick="event.stopPropagation()">${esc(v)}</a>`;
    case 'tel': return `<a href="tel:${esc(v)}" onclick="event.stopPropagation()">${esc(v)}</a>`;
    case 'ref': return linkRefs
      ? `<a href="#/ver/${f.ref}/${v}" onclick="event.stopPropagation()">${esc(label(f.ref, v))}</a>`
      : esc(label(f.ref, v));
    default: return esc(v);
  }
}

function defaultValue(f) {
  if (f.default === 'today') return today();
  if (f.default?.startsWith?.('setting:')) return S.settings[f.default.slice(8)] || '';
  return f.default ?? '';
}

async function reload() {
  const r = await api('all');
  S.data = r.data;
  S.settings = r.settings;
  S.perfil = r.perfil || {};
  S.diretor = r.diretor || {}; // diretor(a) do curso ativo: vai para o plano e para a ficha da empresa
  Object.assign(S, { eu: r.eu || {}, cursos: r.cursos || [], curso_id: r.curso_id || 0, autores: r.autores || {} });
  S.logos = r.logos || {};
  S.fases = r.fases || [];
  S.idx = {};
  for (const [name, list] of Object.entries(S.data)) S.idx[name] = new Map(list.map((x) => [x.id, x]));
}

/** Local onde o aluno estagia: morada própria da afetação ou, se vazia, a morada da sede da empresa. */
function localEstagio(c) {
  const emp = get('empresas', c.empresa_id) || {};
  const own = [c.morada_estagio, [c.codigo_postal_estagio, c.localidade_estagio].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (own || c.local_estagio) return { nome: c.local_estagio || emp.nome, morada: own, sede: false };
  return { nome: emp.nome, morada: [emp.morada, [emp.codigo_postal, emp.localidade].filter(Boolean).join(' ')].filter(Boolean).join(', '), sede: true };
}

const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/* ---------------- Formulário (diálogo) ---------------- */
function fieldInput(f, value) {
  const req = f.required ? 'required' : '';
  const v = esc(value ?? '');
  switch (f.type) {
    case 'textarea': return `<textarea name="${f.name}" ${req}>${v}</textarea>`;
    case 'select': return `<select name="${f.name}" ${req}><option value=""></option>${f.options
      .map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    case 'ref': {
      const opts = rows(f.ref).map((r) => [r.id, label(f.ref, r)]).sort((a, b) => a[1].localeCompare(b[1], 'pt'));
      return `<select name="${f.name}" ${req}><option value=""></option>${opts
        .map(([id, l]) => `<option value="${id}" ${Number(value) === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    }
    case 'number': return `<input type="number" step="any" name="${f.name}" value="${v}" ${req}
      ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}>`;
    case 'datetime-local': return `<input type="datetime-local" name="${f.name}" value="${esc((value || '').slice(0, 16))}" ${req}>`;
    default: return `<input type="${f.type}" name="${f.name}" value="${v}" ${req}>`;
  }
}

function openForm(name, record = null, preset = {}) {
  const e = ent(name);
  const isNew = !record;
  const values = isNew
    ? Object.fromEntries(e.fields.map((f) => [f.name, preset[f.name] ?? defaultValue(f)]))
    : record;
  dlg.innerHTML = `<form method="dialog">
    <h2>${isNew ? 'Novo' : 'Editar'}: ${esc(e.singular)}</h2>
    <div class="form-grid">${e.fields.map((f) => `
      <label class="${f.type === 'textarea' || f.type === 'ref' ? 'wide' : ''}">
        <span>${esc(f.label)} ${f.required ? '<span class="req">*</span>' : ''}</span>
        ${fieldInput(f, values[f.name])}
      </label>`).join('')}
    </div>
    <p class="erro" id="form-err"></p>
    <div class="dlg-actions">
      <button type="button" class="btn" value="cancel" id="dlg-cancel">Cancelar</button>
      <button type="submit" class="btn primary">Guardar</button>
    </div></form>`;
  const hook = FORM_HOOKS[name];
  hook?.setup?.($('form', dlg), { isNew, record, preset });
  $('#dlg-cancel', dlg).onclick = () => dlg.close();
  $('form', dlg).onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const body = Object.fromEntries(e.fields.map((f) => [f.name, fd.get(f.name)]));
    if (!isNew) body.id = record.id;
    try {
      const saved = await api('save', { e: name, body });
      await hook?.afterSave?.(saved, ev.target, { isNew, record, preset });
      dlg.close();
      await reload();
      toast('Guardado.');
      if (isNew && openForm.goToNew) location.hash = `#/ver/${name}/${saved.id}`;
      else render();
    } catch (err) { $('#form-err', dlg).textContent = err.message; }
  };
  openForm.goToNew = isNew && !Object.keys(preset).length && name !== 'contactos';
  dlg.showModal();
  $('input, select, textarea', dlg)?.focus();
}

async function removeRecord(name, id, after) {
  const e = ent(name);
  const kids = S.schema.children[name] || [];
  const n = kids.reduce((s, k) => s + rows(k.entity).filter((r) => r[k.field] === id).length, 0);
  const warn = n ? `\n\nAtenção: serão também apagados ${n} registo(s) associado(s).` : '';
  if (!confirm(`Apagar ${e.singular.toLowerCase()} «${label(name, id)}»?${warn}`)) return;
  try {
    await api('delete', { e: name, id, body: {} });
    await reload();
    toast('Apagado.');
    after ? after() : render();
  } catch (err) { toast(err.message, true); }
}

/* ---------------- Tabelas ---------------- */
function table(name, list, { hide = [], extraCols = [] } = {}) {
  const e = ent(name);
  const cols = e.fields.filter((f) => f.list && !hide.includes(f.name));
  if (!list.length) return '<p class="empty">Sem registos.</p>';
  // No telemóvel, os cartões das afetações mostram só aluno e empresa (o resto vê-se ao abrir a afetação).
  const compacto = name === 'colocacoes' ? ' class="compacto-m"' : '';
  return `<div class="table-wrap"><table${compacto}><thead><tr>
    ${cols.map((f) => `<th>${esc(f.label)}</th>`).join('')}${extraCols.map((c) => `<th>${esc(c.label)}</th>`).join('')}
    </tr></thead><tbody>${list.map((r) => `<tr class="click" data-go="#/ver/${name}/${r.id}">
      ${cols.map((f) => `<td data-f="${f.name}" class="${f.type === 'textarea' || f.type === 'text' ? 'clip' : ''}">${fmtValue(f, r[f.name])}</td>`).join('')}
      ${extraCols.map((c) => `<td>${c.render(r)}</td>`).join('')}
    </tr>`).join('')}</tbody></table></div>`;
}

function bindRows(root = main) {
  $$('tr[data-go]', root).forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.go)));
}

const extraColsFor = (name) => {
  if (name === 'colocacoes') return [{ label: 'Plano', render: (r) => (planoDe(r.id) ? '<span class="badge ok">📘 preparado</span>' : '<span class="sub">—</span>') }];
  if (name === 'protocolos') return [{ label: 'Documento', render: (r) => {
    const f = protUltimo(r.id);
    return f ? `<a href="${ficheiroUrl(f)}" onclick="event.stopPropagation()" title="Descarregar ${esc(f.nome)}">📎 ${FASE_ICON[S.fases.indexOf(f.fase)] || ''} ${esc(f.fase)}</a>
      <div class="sub">${protFicheiros(r.id).length} ficheiro(s)</div>` : '<span class="sub">sem ficheiros</span>';
  } }];
  if (name === 'tarefas') return [{ label: '', render: (r) => (r.estado !== 'Feita' ? dueBadge(r.data_limite) : '') }];
  if (name === 'empresas') return [
    { label: 'Último contacto', render: (r) => { const l = empContacts(r.id)[0]; return l ? `${fmtDate(l.data)}<div class="sub">${relDays(l.data)}</div>` : '<span class="sub">—</span>'; } },
    { label: 'Pendente', render: (r) => { const p = empPending(r.id)[0]; return p ? `${pendBadge(p)} ${dueBadge(p.data_followup)}` : ''; } },
  ];
  return [];
};

/* ---------------- Vistas ---------------- */
function viewDashboard() {
  const t = today();
  const limit = addDays(t, 14);
  const alunos = rows('alunos').filter(inYear);
  const alunosColocados = new Set(rows('colocacoes').filter((c) => inYear(c) && c.estado !== 'Interrompida').map((c) => c.aluno_id));
  const semColocacao = alunos.filter((a) => !alunosColocados.has(a.id));
  const followups = rows('contactos')
    .filter((c) => isPending(c) && c.data_followup && c.data_followup <= addDays(t, 7)).sort(byDue);
  const protPend = rows('protocolos').filter((p) => ['Por enviar', 'Enviado', 'Devolvido'].includes(p.estado));
  const events = [
    ...rows('entrevistas').filter((x) => x.estado === 'Agendada')
      .map((x) => ({ when: x.data_hora, txt: `Entrevista: ${label('entrevistas', x)}`, go: `#/ver/entrevistas/${x.id}` })),
    ...rows('reunioes').filter((x) => x.estado === 'Agendada')
      .map((x) => ({ when: x.data_hora, txt: `Reunião ${x.tipo || ''}: ${label('colocacoes', x.colocacao_id)}`, go: `#/ver/reunioes/${x.id}` })),
  ].filter((x) => x.when && x.when.slice(0, 10) <= limit).sort((a, b) => a.when.localeCompare(b.when));
  const ativas = rows('colocacoes').filter((c) => c.estado === 'Em curso');
  const tarefas = tarefasAbertas().slice(0, 10);

  const card = (num, lbl, href) => `<a class="card" href="${href}"><div class="num">${num}</div><div class="lbl">${lbl}</div></a>`;
  const ev = (list, empty) => list.length ? `<ul class="events">${list.join('')}</ul>` : `<p class="empty">${empty}</p>`;

  return `<div class="page-head"><div><h1>Painel</h1>
      <div class="sub">${esc([S.settings.curso, S.settings.ano_letivo].filter(Boolean).join(' · ') || 'Configure o curso e ano letivo em Definições')}</div></div></div>
    <div class="grid cards">
      ${card(alunos.length, `alunos · <b>${semColocacao.length}</b> sem afetação`, '#/lista/alunos')}
      ${card(rows('empresas').filter((e) => e.estado === 'Parceira').length, `empresas parceiras (de ${rows('empresas').length})`, '#/lista/empresas')}
      ${card(rows('contactos').filter(isPending).length, `pendentes com empresas${pendingDueCount() ? ` · <b class="overdue">${pendingDueCount()} p/ hoje ou atrasados</b>` : ''}`, '#/pendentes')}
      ${card(tarefasAbertas().length, `tarefas por fazer${tarefasDue() ? ` · <b class="overdue">${tarefasDue()} p/ hoje ou atrasadas</b>` : ''}`, '#/lista/tarefas')}
      ${card(protPend.length, 'protocolos por assinar', '#/lista/protocolos')}
      ${card(ativas.length, 'estágios em curso', '#/lista/colocacoes')}
    </div>
    <div class="grid two">
      <div class="panel"><h2>Próximos 14 dias</h2>
        ${ev(events.map((x) => `<li><span class="when ${x.when < t ? 'overdue' : ''}">${fmtDateTime(x.when)}</span><a href="${x.go}">${esc(x.txt)}</a></li>`), 'Sem entrevistas nem reuniões agendadas.')}
      </div>
      <div class="panel"><div class="section-head"><h2>Pendentes com empresas (7 dias)</h2><a class="btn small" href="#/pendentes">Ver todos</a></div>
        ${ev(followups.map((c) => `<li><span class="when ${c.data_followup < t ? 'overdue' : ''}">${fmtDate(c.data_followup)}</span>
          <span><a href="#/ver/empresas/${c.empresa_id}">${esc(label('empresas', c.empresa_id))}</a> — ${esc(c.proximo_passo || c.assunto || '')} ${pendBadge(c)}</span></li>`), 'Nada pendente para os próximos 7 dias.')}
      </div>
      <div class="panel"><div class="section-head"><h2>☑️ Tarefas</h2><a class="btn small" href="#/lista/tarefas">Ver todas</a></div>
        ${ev(tarefas.map((x) => `<li><span class="when ${x.data_limite && x.data_limite < t ? 'overdue' : ''}">${x.data_limite ? fmtDate(x.data_limite) : 'sem prazo'}</span>
          <span><a href="#/ver/tarefas/${x.id}">${esc(x.titulo)}</a> <button class="btn small" data-done="${x.id}" title="Marcar como feita">✓ Feita</button></span></li>`), 'Sem tarefas por fazer.')}
      </div>
      <div class="panel"><h2>Estágios em curso</h2>
        ${ativas.length ? `<table><tbody>${ativas.map((c) => `<tr class="click" data-go="#/ver/colocacoes/${c.id}"><td>${esc(label('colocacoes', c))}</td>
            <td class="nowrap">${fmtDate(c.data_inicio)}${c.data_fim ? ' → ' + fmtDate(c.data_fim) : ''}</td></tr>`).join('')}</tbody></table>`
          : '<p class="empty">Nenhum estágio em curso.</p>'}
      </div>
      <div class="panel"><h2>Alunos sem afetação</h2>
        ${ev(semColocacao.map((a) => `<li><a href="#/ver/alunos/${a.id}">${esc(label('alunos', a))}</a> <span class="sub">${esc([a.turma, a.entidade_proposta && 'proposta: ' + a.entidade_proposta].filter(Boolean).join(' · '))}</span></li>`), alunos.length ? 'Todos os alunos têm empresa atribuída.' : 'Ainda não há alunos. Use <a href="#/importar">Importar</a> para carregar um ficheiro Excel.')}
      </div>
      <div class="panel"><h2>Protocolos pendentes</h2>
        ${ev(protPend.map((p) => `<li>${badge(p.estado)} <a href="#/ver/protocolos/${p.id}">${esc(label('protocolos', p))}</a></li>`), 'Sem protocolos pendentes.')}
      </div>
    </div>`;
}

/* Tarefas do professor (com lembretes por email) */
const tarefasAbertas = () => rows('tarefas').filter((x) => x.estado !== 'Feita')
  .sort((a, b) => (a.data_limite || '9999').localeCompare(b.data_limite || '9999'));
const tarefasDue = () => tarefasAbertas().filter((x) => x.data_limite && x.data_limite <= today()).length;
function bindDashboard() {
  bindRows();
  $$('[data-done]').forEach((b) => (b.onclick = () => quickSave('tarefas', { id: +b.dataset.done, estado: 'Feita' }, 'Tarefa concluída.')));
}

function viewList(name) {
  const e = ent(name);
  if (!e || e.hidden) return '<p>Página não encontrada.</p>';
  const estado = e.fields.find((f) => f.name === 'estado');
  const q = listState(name);
  const anos = hasYear(name) ? [...new Set(rows(name).map((r) => r.ano_letivo).filter(Boolean))].sort().reverse() : [];
  return `<div class="page-head"><h1>${e.icon} ${esc(e.label)}</h1>
      <div class="actions">${name === 'empresas' ? `<button class="btn" id="view-toggle">${q.view === 'quadro' ? '☰ Ver lista' : '▦ Ver quadro'}</button>` : ''}
      ${name === 'empresas' ? '<a class="btn" href="#/importar/empresas">📥 Importar</a>' : ''}
      ${name === 'alunos' ? '<a class="btn" href="#/importar/alunos">📥 Importar alunos</a>' : ''}
      <button class="btn" id="csv">⬇️ Excel</button>
      <button class="btn primary" id="new">+ ${esc(e.singular)}</button></div></div>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Pesquisar…" value="${esc(q.q)}">
      ${anos.length ? `<select id="fa"><option value="">Todos os anos letivos</option>${anos.map((a) => `<option ${a === q.ano ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>` : ''}
      ${estado ? `<select id="fe"><option value="">Todos os estados</option>${estado.options.map((o) => `<option ${o === q.estado ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : ''}
    </div>
    <div class="panel" id="list"></div>`;
}
viewList.state = {};
const hasYear = (name) => ent(name).fields.some((f) => f.name === 'ano_letivo');
function listState(name) {
  return (viewList.state[name] ||= { q: '', estado: '', ano: hasYear(name) ? S.settings.ano_letivo || '' : '' });
}
/** Registo pertence ao ano letivo ativo (definições)? Registos sem ano contam sempre. */
const inYear = (r) => !S.settings.ano_letivo || !r.ano_letivo || r.ano_letivo === S.settings.ano_letivo;

function filteredRows(name) {
  const e = ent(name);
  const st = listState(name);
  const terms = st.q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows(name).filter((r) => {
    if (st.estado && r.estado !== st.estado) return false;
    if (st.ano && r.ano_letivo && r.ano_letivo !== st.ano) return false;
    if (!terms.length) return true;
    const hay = e.fields.map((f) => (f.type === 'ref' ? label(f.ref, r[f.name]) : r[f.name] ?? '')).join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

function bindList(name) {
  const st = listState(name);
  const draw = () => {
    const list = filteredRows(name);
    if (name === 'empresas' && st.view === 'quadro') {
      $('#list').innerHTML = empresasBoard(list);
      bindBoard();
      return;
    }
    $('#list').innerHTML = table(name, list, { extraCols: extraColsFor(name) })
      + `<div class="count">${list.length} de ${rows(name).length} registo(s)</div>`;
    bindRows();
  };
  if ($('#view-toggle')) $('#view-toggle').onclick = () => { st.view = st.view === 'quadro' ? 'lista' : 'quadro'; render(); };
  $('#q').oninput = (ev) => { st.q = ev.target.value; draw(); };
  if ($('#fe')) $('#fe').onchange = (ev) => { st.estado = ev.target.value; draw(); };
  if ($('#fa')) $('#fa').onchange = (ev) => { st.ano = ev.target.value; draw(); };
  $('#new').onclick = () => openForm(name);
  $('#csv').onclick = () => exportExcel(name, filteredRows(name));
  draw();
}

/* ---------- Exportação para Excel ---------- */
function descarregar(blob, nome) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
/** Valor de um campo pronto para o Excel (referências pelo nome, datas dd/mm/aaaa, números como números). */
function valorExcel(f, v) {
  if (v == null || v === '') return '';
  if (f.type === 'ref') return label(f.ref, v);
  if (f.type === 'date') return fmtDate(v);
  if (f.type === 'datetime-local') return fmtDateTime(v);
  if (f.type === 'number') return Number(v);
  return v;
}
function folhaEntidade(name, list) {
  const e = ent(name);
  const extra = name === 'protocolos' ? [['Documentos carregados', (r) => protFicheiros(r.id).map((f) => `${f.fase}: ${f.nome}`).join('\n')]] : [];
  return { nome: e.label, linhas: [
    [...e.fields.map((f) => f.label), ...extra.map(([l]) => l)],
    ...list.map((r) => [...e.fields.map((f) => valorExcel(f, r[f.name])), ...extra.map(([, fn]) => fn(r))]),
  ] };
}
function exportExcel(name, list) {
  descarregar(gerarXlsx([folhaEntidade(name, list)]), `${ent(name).label} ${today()}.xlsx`);
}
/** Tudo: listagem breve (ano letivo ativo) + uma folha por tabela. */
function exportarTudo() {
  const folhas = [{ nome: 'Listagem breve', linhas: [LISTAGEM_COLS.map(([l]) => l), ...listagemBreve(S.settings.ano_letivo || '').map((r) => LISTAGEM_COLS.map(([, k]) => r[k] ?? ''))] }];
  for (const name of Object.keys(S.schema.entities)) folhas.push(folhaEntidade(name, rows(name)));
  descarregar(gerarXlsx(folhas), `Gestão FCT - todos os dados ${today()}.xlsx`);
  toast('Exportação descarregada.');
}

/* ---------- Ficha da empresa para conferência de dados (PDF pela impressão, ou TXT) ---------- */
const FICHA_CAMPOS = [
  ['Denominação social', 'nome'], ['NIF / NIPC', 'nif'], ['Natureza jurídica', 'natureza_juridica'], ['Tipo de entidade', 'tipo'],
  ['Atividade principal', 'setor'], ['Morada da sede', 'morada'], ['Código postal', 'codigo_postal'], ['Localidade / Concelho', 'localidade'],
  ['Telefone', 'telefone'], ['Email', 'email'], ['Website', 'website'],
  ['Representante legal', 'representante_legal'], ['Cargo do representante legal', 'cargo_representante'],
  ['Pessoa de contacto principal', 'responsavel'], ['Cargo', 'cargo_responsavel'], ['Email da pessoa de contacto', 'email_responsavel'],
  ['Telefone da pessoa de contacto', 'telefone_responsavel'], ['Vagas para estagiários', 'vagas'],
];
const ficha = { estagiarios: false };
function fichaDados(id) {
  const e = get('empresas', id);
  if (!e) return null;
  const pessoas = rows('pessoas').filter((x) => x.empresa_id === e.id).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const estag = rows('colocacoes').filter((c) => c.empresa_id === e.id && inYear(c) && c.estado !== 'Interrompida')
    .map((c) => ({ aluno: get('alunos', c.aluno_id)?.nome || '', inicio: fmtDate(c.data_inicio), fim: fmtDate(c.data_fim), tutor: c.tutor || '' }));
  const P = S.diretor || {};
  return { e, pessoas, estag, P, s: S.settings };
}
function fichaTxt(d) {
  const { e, pessoas, estag, P, s } = d;
  const w = Math.max(...FICHA_CAMPOS.map(([l]) => l.length)) + 2;
  const linha = '='.repeat(72);
  const L = [
    (s.escola || '').toUpperCase(), 'FICHA DE DADOS DA ENTIDADE DE ACOLHIMENTO — CONFERÊNCIA',
    `Formação em Contexto de Trabalho · Ano letivo ${s.ano_letivo || ''} · ${fmtDate(today())}`, linha, '',
    'Pedimos que confirme os dados abaixo. Se algum estiver incorreto ou em falta,',
    'escreva a correção à frente (ou responda ao email com as alterações).', '',
    'DADOS DA ENTIDADE', '-'.repeat(72),
    ...FICHA_CAMPOS.map(([l, k]) => `${(l + ':').padEnd(w)}${e[k] != null && e[k] !== '' ? (k === 'vagas' ? fmtNum(e[k]) : e[k]) : '______________________'}`),
    '', 'PESSOAS DE CONTACTO / TUTORES', '-'.repeat(72),
    ...(pessoas.length ? pessoas.flatMap((x, i) => [`${i + 1}. ${x.nome}${x.cargo ? ' — ' + x.cargo : ''}${x.tutor === 'Sim' ? ' (tutor)' : ''}`,
      `   Telefone: ${x.telefone || '________'}   Email: ${x.email || '________'}`]) : ['(sem pessoas registadas — indique, por favor, quem será o tutor)']),
  ];
  if (ficha.estagiarios && estag.length) L.push('', `ESTAGIÁRIOS ${s.ano_letivo || ''}`, '-'.repeat(72),
    ...estag.map((x) => `- ${x.aluno}${x.inicio ? ` (${x.inicio}${x.fim ? ' a ' + x.fim : ''})` : ''}${x.tutor ? ' · tutor: ' + x.tutor : ''}`));
  L.push('', 'Correções / observações:', '', '_'.repeat(72), '', '_'.repeat(72), '', '_'.repeat(72), '', linha,
    `Contacto: ${[P.diretor_curso, 'Diretor(a) de curso' + (s.curso ? ' — ' + s.curso : '')].filter(Boolean).join(', ')}`,
    [P.email_diretor, P.telefone_diretor].filter(Boolean).join(' · '), s.escola || '');
  return L.join('\r\n');
}
function viewFicha(id) {
  const d = fichaDados(id);
  if (!d) return '<p>Empresa não encontrada.</p>';
  const { e, pessoas, estag, P, s } = d;
  const v = (k) => (e[k] != null && e[k] !== '' ? esc(k === 'vagas' ? fmtNum(e[k]) : e[k]) : '<span class="vazio">em falta</span>');
  return `<div class="page-head no-print"><div><div class="sub"><a href="#/ver/empresas/${e.id}">← ${esc(e.nome)}</a></div>
      <h1>📄 Ficha para conferência</h1><div class="sub">Envie à empresa para confirmar os dados. Para PDF: Imprimir → «Guardar como PDF».</div></div>
      <div class="actions"><label class="sub" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fc-est" style="width:auto" ${ficha.estagiarios ? 'checked' : ''}> incluir estagiários (${estag.length})</label>
        <button class="btn" id="fc-txt">⬇️ TXT</button><button class="btn primary" onclick="window.print()">🖨️ Imprimir / PDF</button></div></div>
    <div class="doc-ficha">
      <div class="df-head"><img src="api.php?a=logo&k=escola&v=${S.logos.escola?.v || 0}" alt="">
        <div><b>${esc(s.escola || '')}</b><div>Formação em Contexto de Trabalho · Ano letivo ${esc(s.ano_letivo || '')}</div></div>
        <img src="api.php?a=logo&k=republica&v=${S.logos.republica?.v || 0}" alt=""></div>
      <h2>Ficha de dados da entidade de acolhimento</h2>
      <p class="df-intro">Pedimos que confirme os dados abaixo. Se algum estiver incorreto ou em falta, indique a correção na coluna da direita
        (ou responda ao email com as alterações). Obrigado pela colaboração.</p>
      <h3>Dados da entidade</h3>
      <table class="df"><thead><tr><th style="width:32%">Campo</th><th>Registado</th><th style="width:30%">Correção</th></tr></thead>
        <tbody>${FICHA_CAMPOS.map(([l, k]) => `<tr><td>${esc(l)}</td><td>${v(k)}</td><td></td></tr>`).join('')}</tbody></table>
      <h3>Pessoas de contacto / tutores</h3>
      ${pessoas.length ? `<table class="df"><thead><tr><th>Nome</th><th>Cargo</th><th>Telefone</th><th>Email</th><th>Tutor</th></tr></thead>
        <tbody>${pessoas.map((x) => `<tr><td>${esc(x.nome)}</td><td>${esc(x.cargo || '')}</td><td>${esc(x.telefone || '')}</td><td>${esc(x.email || '')}</td><td>${esc(x.tutor || '')}</td></tr>`).join('')}
        <tr class="nova"><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>`
        : '<p class="df-intro">Sem pessoas registadas — indique, por favor, quem será o tutor (nome, cargo, telefone e email).</p>'}
      ${ficha.estagiarios && estag.length ? `<h3>Estagiários ${esc(s.ano_letivo || '')}</h3><table class="df"><thead><tr><th>Aluno</th><th>Período</th><th>Tutor</th></tr></thead>
        <tbody>${estag.map((x) => `<tr><td>${esc(x.aluno)}</td><td>${esc([x.inicio, x.fim].filter(Boolean).join(' a '))}</td><td>${esc(x.tutor)}</td></tr>`).join('')}</tbody></table>` : ''}
      <h3>Correções / observações</h3><div class="df-obs"></div>
      <div class="df-foot">${esc([P.diretor_curso, 'Diretor(a) de curso' + (s.curso ? ' — ' + s.curso : '')].filter(Boolean).join(', '))}<br>
        ${esc([P.email_diretor, P.telefone_diretor].filter(Boolean).join(' · '))}<br>${esc(s.localidade_escola || '')}, ${fmtDate(today())}</div>
    </div>`;
}
function bindFicha(id) {
  const d = fichaDados(id);
  if (!d) return;
  $('#fc-est').onchange = (ev) => { ficha.estagiarios = ev.target.checked; render(); };
  $('#fc-txt').onclick = () => descarregar(new Blob(['﻿' + fichaTxt(fichaDados(id))], { type: 'text/plain;charset=utf-8' }),
    `Ficha de dados - ${d.e.nome.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80)}.txt`);
  document.title = `Ficha de dados - ${d.e.nome}`; // nome sugerido ao guardar em PDF
  addEventListener('hashchange', () => (document.title = 'Gestão FCT'), { once: true });
}

/* ---------- Listagem breve: aluno, contacto, empresa, tutor e contacto ---------- */
const LISTAGEM_COLS = [['Aluno', 'aluno'], ['Nº', 'numero'], ['Turma', 'turma'], ['Telemóvel do aluno', 'tel_aluno'], ['Email do aluno', 'email_aluno'],
  ['Empresa', 'empresa'], ['Telefone da empresa', 'tel_empresa'], ['Tutor', 'tutor'], ['Contacto do tutor', 'tel_tutor'], ['Email do tutor', 'email_tutor'],
  ['Professor acompanhante', 'professor'], ['Estado', 'estado']];
function listagemBreve(ano) {
  const ord = { 'Em curso': 0, Planeada: 1, 'Concluída': 2, Interrompida: 3 };
  return rows('alunos').filter((a) => !ano || !a.ano_letivo || a.ano_letivo === ano)
    .sort((a, b) => (a.turma || '').localeCompare(b.turma || '', 'pt') || a.nome.localeCompare(b.nome, 'pt'))
    .map((a) => {
      const c = rows('colocacoes').filter((x) => x.aluno_id === a.id && (!ano || !x.ano_letivo || x.ano_letivo === ano))
        .sort((x, y) => (ord[x.estado] ?? 9) - (ord[y.estado] ?? 9) || y.id - x.id)[0];
      const e = c ? get('empresas', c.empresa_id) || {} : {};
      return { aluno: a.nome, alunoId: a.id, numero: a.numero, turma: a.turma, tel_aluno: a.telefone, email_aluno: a.email,
        empresa: e.nome || (a.entidade_proposta ? `(proposta: ${a.entidade_proposta})` : ''), empresaId: e.id, colId: c?.id,
        tel_empresa: e.telefone, tutor: c ? c.tutor || e.responsavel : '', tel_tutor: c ? c.contacto_tutor || e.telefone_responsavel : '',
        email_tutor: c ? c.email_tutor || e.email_responsavel : '', professor: c ? c.professor_acompanhante || '' : '', estado: c ? c.estado : 'Sem afetação' };
    });
}
const lst = { ano: null, q: '' };
function viewListagem() {
  const ano = lst.ano ?? S.settings.ano_letivo ?? '';
  const anos = [...new Set(rows('alunos').map((a) => a.ano_letivo).filter(Boolean))].sort().reverse();
  return `<div class="page-head"><div><h1>📋 Listagem breve</h1>
      <div class="sub">Aluno, contacto, empresa, tutor e contacto — uma linha por aluno.</div></div>
      <div class="actions no-print"><button class="btn" onclick="window.print()">🖨️ Imprimir</button>
        <button class="btn" id="lst-xlsx">⬇️ Excel (esta listagem)</button>
        <button class="btn primary" id="lst-all">📊 Exportar todas as tabelas</button></div></div>
    <div class="toolbar no-print"><input type="search" id="lst-q" placeholder="Pesquisar…" value="${esc(lst.q)}">
      <select id="lst-ano"><option value="">Todos os anos letivos</option>${anos.map((a) => `<option ${a === ano ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
    <div class="panel" id="lst-list"></div>`;
}
function bindListagem() {
  const ano = () => lst.ano ?? S.settings.ano_letivo ?? '';
  const filtrar = () => {
    const t = lst.q.toLowerCase().split(/\s+/).filter(Boolean);
    return listagemBreve(ano()).filter((r) => t.every((w) => LISTAGEM_COLS.map(([, k]) => r[k] ?? '').join(' ').toLowerCase().includes(w)));
  };
  const tel = (v) => (v ? `<a href="tel:${esc(v)}">${esc(v)}</a>` : '');
  const mail = (v) => (v ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : '');
  const draw = () => {
    const l = filtrar();
    $('#lst-list').innerHTML = l.length ? `<div class="table-wrap"><table class="listagem"><thead><tr><th>Aluno</th><th>Contacto do aluno</th><th>Empresa</th><th>Tutor</th><th>Contacto do tutor</th></tr></thead>
      <tbody>${l.map((r) => `<tr>
        <td><a href="#/ver/alunos/${r.alunoId}"><b>${esc(r.aluno)}</b></a><div class="sub">${esc([r.numero && 'nº ' + r.numero, r.turma].filter(Boolean).join(' · '))}</div></td>
        <td>${tel(r.tel_aluno)}<div class="sub">${mail(r.email_aluno)}</div></td>
        <td>${r.empresaId ? `<a href="#/ver/empresas/${r.empresaId}">${esc(r.empresa)}</a>` : `<span class="sub">${esc(r.empresa) || '—'}</span>`}
          <div class="sub">${tel(r.tel_empresa)} ${r.colId ? badge(r.estado) : '<span class="badge bad">Sem afetação</span>'}</div></td>
        <td>${esc(r.tutor || '')}${r.professor ? `<div class="sub">Prof.: ${esc(r.professor)}</div>` : ''}</td>
        <td>${tel(r.tel_tutor)}<div class="sub">${mail(r.email_tutor)}</div></td></tr>`).join('')}</tbody></table></div>
      <div class="count">${l.length} aluno(s)</div>` : '<p class="empty">Sem alunos.</p>';
  };
  $('#lst-q').oninput = (ev) => { lst.q = ev.target.value; draw(); };
  $('#lst-ano').onchange = (ev) => { lst.ano = ev.target.value; draw(); };
  $('#lst-xlsx').onclick = () => descarregar(gerarXlsx([{ nome: 'Listagem breve', linhas: [LISTAGEM_COLS.map(([l]) => l), ...filtrar().map((r) => LISTAGEM_COLS.map(([, k]) => r[k] ?? ''))] }]),
    `Listagem breve ${ano().replace('/', '-')} ${today()}.xlsx`);
  $('#lst-all').onclick = exportarTudo;
  draw();
}

function viewDetail(name, id) {
  const e = ent(name);
  const r = get(name, id);
  if (!e || !r) return '<p>Registo não encontrado. <a href="#/">Voltar ao painel</a></p>';
  const kids = (S.schema.children[name] || []).filter((k) => !ent(k.entity).hidden
    && !(name === 'empresas' && ['contactos', 'pessoas'].includes(k.entity)));
  let extra = '';
  let pre = name === 'empresas' ? empresaPanels(r) : '';
  if (name === 'protocolos') pre = protocoloFicheiroPanel(r);
  if (name === 'colocacoes') {
    const loc = localEstagio(r);
    extra = `<div class="panel"><h2>📍 Local de estágio</h2>
      <p style="margin:0">${loc.nome ? `<b>${esc(loc.nome)}</b><br>` : ''}${esc(loc.morada) || '<span class="sub">Sem morada registada</span>'}
      ${loc.sede ? '<br><span class="sub">Igual à morada da sede da empresa (o local de estágio não foi preenchido).</span>' : ''}</p></div>`;
  }
  return `<div class="page-head"><div><div class="sub"><a href="#/lista/${e.hidden ? '' : name}">${e.icon} ${esc(e.label)}</a></div>
      <h1>${esc(label(name, r))}</h1></div>
      <div class="actions">
        ${name === 'colocacoes' ? `<a class="btn primary" href="#/plano/${r.id}">📘 Plano de estágio</a>` : ''}
        ${name === 'planos' ? `<a class="btn primary" href="#/plano/${r.colocacao_id}">📘 Abrir plano</a>` : ''}
        ${name === 'empresas' ? empresaActions(r) : ''}
        <button class="btn" id="edit">Editar</button><button class="btn danger" id="del">Apagar</button></div></div>
    ${pre}
    ${name === 'empresas' ? '<details class="panel"><summary><b>Dados da empresa</b></summary><div style="margin-top:12px">' : '<div class="panel">'}<div class="fields">${e.fields.map((f) => `<div class="f ${f.type === 'textarea' ? 'wide' : ''}">
      <div class="k">${esc(f.label)}</div><div class="v">${fmtValue(f, r[f.name]) || '<span class="sub">—</span>'}</div></div>`).join('')}
    </div>${name === 'empresas' ? '</div></details>' : '</div>'}
    ${extra}
    ${kids.map((k) => {
      const ce = ent(k.entity);
      const list = rows(k.entity).filter((x) => x[k.field] === r.id);
      return `<div class="panel"><div class="section-head"><h2>${ce.icon} ${esc(ce.label)} <span class="sub">(${list.length})</span></h2>
        <button class="btn small" data-add="${k.entity}" data-field="${k.field}">+ Adicionar</button></div>
        ${table(k.entity, list, { hide: [k.field], extraCols: extraColsFor(k.entity) })}</div>`;
    }).join('')}`;
}

function bindDetail(name, id) {
  const r = get(name, id);
  if (!r) return;
  $('#edit').onclick = () => openForm(name, r);
  $('#del').onclick = () => removeRecord(name, r.id, () => (location.hash = `#/lista/${name}`));
  $$('[data-add]').forEach((b) => (b.onclick = () => {
    const preset = { [b.dataset.field]: r.id };
    // Ao criar a partir de uma afetação/entrevista, preencher também aluno e empresa quando existirem
    const target = ent(b.dataset.add);
    for (const f of target.fields) if (f.type === 'ref' && r[f.name] && !preset[f.name]) preset[f.name] = r[f.name];
    openForm(b.dataset.add, null, preset);
  }));
  bindRows();
  if (name === 'empresas') bindEmpresa(r);
  if (name === 'protocolos') bindProtocoloFicheiro(r);
}

/* ---------- Protocolos: o documento vem de outra aplicação; um ficheiro por fase de assinatura ---------- */
const FASE_ICON = ['📝', '✍️', '✅'];
const protFicheiros = (pid) => rows('protocolo_ficheiros').filter((f) => f.protocolo_id === Number(pid));
/** Ficheiro mais avançado (fase mais alta) de um protocolo. */
const protUltimo = (pid) => {
  const fs = protFicheiros(pid);
  return fs.sort((a, b) => S.fases.indexOf(b.fase) - S.fases.indexOf(a.fase))[0];
};
const ficheiroUrl = (f) => `api.php?a=protocolo_ficheiro&f=${f.id}`;

function protocoloFicheiroPanel(p) {
  const fs = protFicheiros(p.id);
  return `<div class="panel"><div class="section-head"><h2>📎 Documentos do protocolo</h2></div>
    <p class="sub" style="margin-top:-6px">Carregue o protocolo em cada fase. Ao carregar o assinado por ambas as partes, o estado passa a «Assinado».</p>
    <div class="fases">${S.fases.map((fase, i) => {
      const f = fs.find((x) => x.fase === fase);
      const ext = f ? (f.guardado.split('.').pop() || '').toUpperCase() : '';
      return `<div class="fase ${f ? 'tem' : ''}" data-fase="${i}">
        <div class="fase-tit"><span class="fase-n">${i + 1}</span> ${FASE_ICON[i]} ${esc(fase)}</div>
        ${f ? `<div class="fase-file"><div class="file-ico ${ext === 'PDF' ? '' : 'other'}">${esc(ext)}</div>
              <div><b>${esc(f.nome)}</b><div class="sub">${f.tamanho ? fmtSize(+f.tamanho) + ' · ' : ''}${fmtDateTime(f.carregado_em)}</div></div></div>
            <div class="actions">
              ${/^(PDF|JPE?G|PNG)$/.test(ext) ? `<a class="btn small" href="${ficheiroUrl(f)}&ver=1" target="_blank" rel="noopener">👁️ Abrir</a>` : ''}
              <a class="btn small primary" href="${ficheiroUrl(f)}">⬇️ Descarregar</a>
              <button class="btn small" data-pf-replace="${i}">🔁 Substituir</button>
              <button class="btn small danger" data-pf-remove="${f.id}">Remover</button></div>`
          : `<label class="dropzone small" data-pf-drop="${i}"><b>Carregar</b><span class="sub">Arraste o ficheiro ou clique (PDF, Word, ODT, imagem · máx. 25 MB)</span></label>`}
      </div>`;
    }).join('')}</div>
    <input type="file" id="pf-file" accept=".pdf,.doc,.docx,.odt,.jpg,.jpeg,.png" hidden>
    <p class="sub" id="pf-msg" style="margin-bottom:0"></p></div>`;
}

async function uploadProtocolo(p, fase, file) {
  if (!file) return;
  const atual = protFicheiros(p.id).find((x) => x.fase === S.fases[fase]);
  if (atual && !confirm(`Substituir «${atual.nome}» (${S.fases[fase]}) por «${file.name}»? O ficheiro anterior desta fase é apagado.`)) return;
  const fd = new FormData();
  fd.append('ficheiro', file);
  $('#pf-msg').textContent = `A enviar ${file.name}…`;
  try {
    const res = await fetch(`api.php?a=protocolo_carregar&id=${p.id}&fase=${fase}`, { method: 'POST', body: fd, headers: { 'X-FCT': '1' }, credentials: 'same-origin' });
    const json = await res.json().catch(() => ({ erro: 'Resposta inválida do servidor (ficheiro demasiado grande?).' }));
    if (!res.ok) throw new Error(json.erro || 'Erro ' + res.status);
    await reload();
    toast(json.estado ? 'Documento carregado. Protocolo marcado como «Assinado».' : 'Documento carregado.');
    render();
  } catch (err) { $('#pf-msg').textContent = ''; toast(err.message, true); }
}

function bindProtocoloFicheiro(p) {
  const input = $('#pf-file');
  let fase = 0;
  const pick = (i) => { fase = i; input.value = ''; input.click(); };
  input.onchange = () => uploadProtocolo(p, fase, input.files[0]);
  $$('[data-pf-replace]').forEach((b) => (b.onclick = () => pick(+b.dataset.pfReplace)));
  $$('[data-pf-drop]').forEach((d) => (d.onclick = (ev) => { ev.preventDefault(); pick(+d.dataset.pfDrop); }));
  $$('[data-pf-remove]').forEach((b) => (b.onclick = async () => {
    const f = get('protocolo_ficheiros', b.dataset.pfRemove);
    if (!confirm(`Remover o ficheiro «${f?.nome}» (${f?.fase})?`)) return;
    try { await api('protocolo_remover', { body: {}, f: b.dataset.pfRemove }); await reload(); toast('Ficheiro removido.'); render(); }
    catch (err) { toast(err.message, true); }
  }));
  $$('.fase[data-fase]').forEach((card) => {
    card.ondragover = (ev) => { ev.preventDefault(); card.classList.add('over'); };
    card.ondragleave = () => card.classList.remove('over');
    card.ondrop = (ev) => { ev.preventDefault(); card.classList.remove('over'); uploadProtocolo(p, +card.dataset.fase, ev.dataTransfer.files[0]); };
  });
}

/* ---------- Relação com empresas: histórico de contactos e pendentes ---------- */
const TIPO_ICON = { Telefone: '📞', Email: '✉️', Presencial: '🤝', Videochamada: '🎥', Mensagem: '💬', Outro: '📝' };
const PEND_NADA = 'Nada';
const PEND_EU = 'Tenho de enviar / fazer algo';
const PEND_SHORT = { 'Aguardo resposta da empresa': 'Aguardo resposta', [PEND_EU]: 'Tenho de fazer', 'A empresa vai enviar / fazer algo': 'Empresa vai enviar' };
/** Contacto registado por mim (os contactos são partilhados entre cursos; os pendentes são de quem os registou). */
const meu = (c) => !c.utilizador_id || c.utilizador_id === S.eu.id;
const isPending = (c) => !!c.pendente && c.pendente !== PEND_NADA && meu(c);

function pendBadge(c) {
  if (!isPending(c)) return '';
  return `<span class="badge ${c.pendente === PEND_EU ? 'warn' : 'info'}">${esc(PEND_SHORT[c.pendente] || c.pendente)}</span>`;
}
function dueBadge(iso) {
  if (!iso) return '';
  const t = today();
  const cls = iso < t ? 'bad' : iso === t ? 'warn' : 'info';
  return `<span class="badge ${cls}">${iso < t ? 'atrasado · ' : iso === t ? 'hoje · ' : 'até '}${fmtDate(iso)}</span>`;
}
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 86400000);
function relDays(iso) {
  const d = daysBetween(iso.slice(0, 10), today());
  return d === 0 ? 'hoje' : d === 1 ? 'ontem' : d > 1 ? `há ${d} dias` : d === -1 ? 'amanhã' : `daqui a ${-d} dias`;
}
const byDue = (a, b) => (a.data_followup || '9999').localeCompare(b.data_followup || '9999');
const empContacts = (empId) => rows('contactos').filter((c) => c.empresa_id === empId)
  .sort((a, b) => (b.data || '').localeCompare(a.data || '') || b.id - a.id);
const empPending = (empId) => rows('contactos').filter((c) => c.empresa_id === empId && isPending(c)).sort(byDue);
const pendingDueCount = () => rows('contactos').filter((c) => isPending(c) && c.data_followup && c.data_followup <= today()).length;

/** Estado da empresa sugerido depois de um contacto (null = manter). */
function suggestEmpState(emp, resultado) {
  if (!emp) return null;
  if (resultado === 'Aceite') return emp.estado === 'Parceira' ? null : 'Parceira';
  if (resultado === 'Recusado') return emp.estado === 'Sem disponibilidade' ? null : 'Sem disponibilidade';
  if (!emp.estado || emp.estado === 'Por contactar') return 'Em contacto';
  return null;
}

/** Histórico (linha do tempo) dos contactos de uma empresa. */
function timeline(list) {
  if (!list.length) return '<p class="empty">Ainda não há contactos registados com esta empresa.</p>';
  return `<ul class="timeline">${list.map((c) => `<li class="tl-item ${isPending(c) ? 'tl-open' : ''}">
    <div class="tl-date">${fmtDate(c.data)}<br><small>${c.data ? relDays(c.data) : ''}</small></div>
    <div class="tl-body">
      <div class="tl-title">${TIPO_ICON[c.tipo] || '📝'} <b>${esc(c.assunto || c.tipo || 'Contacto')}</b>
        ${c.estado && c.estado !== 'Sem decisão' ? badge(c.estado) : ''}
        <span class="sub">${esc([c.tipo, c.origem === 'A empresa contactou-me' ? 'recebido' : '', c.pessoa && 'com ' + c.pessoa,
          !meu(c) && 'registado por ' + (S.autores[c.utilizador_id] || '?')].filter(Boolean).join(' · '))}</span></div>
      ${c.resumo ? `<div class="tl-text">${esc(c.resumo)}</div>` : ''}
      ${c.decisao ? `<div class="tl-text"><b>Acordado:</b> ${esc(c.decisao)}</div>` : ''}
      ${isPending(c) ? `<div class="tl-pend">⏳ ${pendBadge(c)} ${esc(c.proximo_passo || '')} ${dueBadge(c.data_followup)}
        <button class="btn small" data-resolve="${c.id}">✓ Resolvido</button></div>` : ''}
    </div>
    <div class="tl-act"><button class="btn small" data-edit-contact="${c.id}">Editar</button></div>
  </li>`).join('')}</ul>`;
}

async function quickSave(name, body, msg) {
  try {
    await api('save', { e: name, body });
    await reload();
    toast(msg);
    render();
  } catch (err) { toast(err.message, true); }
}

/** Botões de ação sobre contactos (usados na ficha da empresa e na página Pendentes). */
function bindContactActions(root = main) {
  const on = (sel, fn) => $$(sel, root).forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); fn(b); }));
  on('[data-edit-contact]', (b) => openForm('contactos', get('contactos', b.dataset.editContact)));
  on('[data-resolve]', (b) => quickSave('contactos', { id: +b.dataset.resolve, pendente: PEND_NADA }, 'Pendente resolvido.'));
  on('[data-snooze]', (b) => {
    const c = get('contactos', b.dataset.snooze);
    const base = c.data_followup && c.data_followup > today() ? c.data_followup : today();
    quickSave('contactos', { id: c.id, data_followup: addDays(base, 7) }, 'Prazo adiado uma semana.');
  });
  on('[data-new-contact]', (b) => {
    const prev = b.dataset.prev ? get('contactos', b.dataset.prev) : null;
    openForm('contactos', null, { empresa_id: +b.dataset.newContact, ...(prev ? { assunto: prev.assunto, pessoa: prev.pessoa, _resolve: prev.id } : {}) });
  });
}

/* Ajudas no formulário de contacto: atalhos de prazo, estado da empresa e resolução do contacto anterior */
/** Pessoas de uma empresa que podem ser tutor (inclui a pessoa de contacto da ficha da empresa). */
function tutoresDe(empId) {
  const emp = get('empresas', empId);
  const list = rows('pessoas').filter((x) => x.empresa_id === Number(empId) && x.tutor !== 'Não')
    .map((x) => ({ nome: x.nome, cargo: x.cargo, tel: x.telefone, email: x.email }));
  if (emp?.responsavel && !list.some((x) => x.nome.trim().toLowerCase() === emp.responsavel.trim().toLowerCase())) {
    list.push({ nome: emp.responsavel, cargo: emp.cargo_responsavel, tel: emp.telefone_responsavel, email: emp.email_responsavel });
  }
  return list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}

/** Professores que podem acompanhar: o(a) diretor(a) do curso (dados do perfil) primeiro e depois a lista. */
function professoresLista() {
  const P = S.diretor || {};
  const norm = (t) => String(t || '').trim().toLowerCase();
  const eu = P.diretor_curso ? [{ nome: P.diretor_curso, email: P.email_diretor, tel: P.telefone_diretor, eu: true }] : [];
  return [...eu, ...rows('professores').filter((x) => norm(x.nome) !== norm(P.diretor_curso))
    .map((x) => ({ nome: x.nome, email: x.email, tel: x.telefone, grupo: x.grupo }))];
}
const profOpcao = (x, i, atual) => `<option value="${i}" ${String(atual || '').trim().toLowerCase() === x.nome.trim().toLowerCase() ? 'selected' : ''}>${esc(x.nome)}${x.eu ? (P_EU() ? ' (eu — diretor de curso)' : ' (diretor de curso)') : x.grupo ? ' · ' + esc(x.grupo) : ''}</option>`;

const P_EU = () => !S.diretor.diretor_curso || S.diretor.diretor_curso === S.eu.nome;

const FORM_HOOKS = {
  colocacoes: {
    setup(form, { isNew, record } = {}) {
      // só alunos ainda sem afetação no ano letivo (as interrompidas não contam); mantém o aluno da própria afetação
      const al = $('[name=aluno_id]', form);
      const afetos = new Set(rows('colocacoes').filter((c) => c.id !== record?.id && c.estado !== 'Interrompida' && inYear(c)).map((c) => c.aluno_id));
      let escondidos = 0;
      [...al.options].forEach((o) => { if (o.value && afetos.has(+o.value) && o.value !== String(al.value)) { o.remove(); escondidos++; } });
      if (escondidos) al.closest('label').querySelector('span').insertAdjacentHTML('beforeend',
        ` <span class="sub">(${escondidos} já afeto(s) a uma empresa não aparecem)</span>`);

      // professor acompanhante: escolher da lista; numa afetação nova vem preenchido com o utilizador
      const prof = $('[name=professor_acompanhante]', form);
      const profEmail = $('[name=email_professor]', form);
      const profTel = $('[name=telefone_professor]', form);
      const profs = professoresLista();
      prof.closest('label').insertAdjacentHTML('beforebegin', `<label class="wide"><span>Escolher professor acompanhante
        <a href="#/lista/professores" class="sub" onclick="document.querySelector('#dlg').close()">(gerir lista)</a></span>
        <select id="prof-pick"><option value="">— escolher (${profs.length}) —</option>${profs.map((x, i) => profOpcao(x, i, prof.value)).join('')}</select></label>`);
      const usar = (x) => { prof.value = x.nome || ''; profEmail.value = x.email || ''; profTel.value = x.tel || ''; };
      $('#prof-pick', form).onchange = (ev) => { const x = profs[ev.target.value]; if (x) usar(x); };
      if (isNew && !prof.value && profs[0]?.eu) { usar(profs[0]); $('#prof-pick', form).value = '0'; }

      const emp = $('[name=empresa_id]', form);
      const tutor = $('[name=tutor]', form);
      tutor.closest('label').insertAdjacentHTML('beforebegin', `<label class="wide"><span>Escolher tutor entre as pessoas de contacto da empresa</span>
        <select id="tutor-pick"></select></label>`);
      const pick = $('#tutor-pick', form);
      let lista = [];
      const fill = () => {
        lista = emp.value ? tutoresDe(emp.value) : [];
        pick.innerHTML = !emp.value ? '<option value="">— escolha primeiro a empresa —</option>'
          : lista.length ? `<option value="">— escolher (${lista.length}) —</option>${lista.map((x, i) => `<option value="${i}" ${x.nome === tutor.value ? 'selected' : ''}>${esc(x.nome)}${x.cargo ? ' · ' + esc(x.cargo) : ''}</option>`).join('')}`
            : '<option value="">Esta empresa ainda não tem pessoas de contacto registadas</option>';
        pick.disabled = !lista.length;
      };
      pick.onchange = () => {
        const x = lista[pick.value];
        if (!x) return;
        tutor.value = x.nome || '';
        $('[name=cargo_tutor]', form).value = x.cargo || '';
        $('[name=contacto_tutor]', form).value = x.tel || '';
        $('[name=email_tutor]', form).value = x.email || '';
      };
      emp.addEventListener('change', fill);
      fill();
    },
  },
  contactos: {
    setup(form, { preset }) {
      const due = $('[name=data_followup]', form);
      due.insertAdjacentHTML('afterend', `<div class="quick">${[['+3 dias', 3], ['+1 semana', 7], ['+2 semanas', 14], ['+1 mês', 30]]
        .map(([l, n]) => `<button type="button" class="btn small" data-days="${n}">${l}</button>`).join('')}</div>`);
      $$('[data-days]', form).forEach((b) => (b.onclick = () => { due.value = addDays(today(), +b.dataset.days); }));
      const pend = $('[name=pendente]', form);
      pend.addEventListener('change', () => { if (pend.value && pend.value !== PEND_NADA && !due.value) due.value = addDays(today(), 7); });

      const prev = preset._resolve ? get('contactos', preset._resolve) : null;
      $('.form-grid', form).insertAdjacentHTML('beforeend', `
        <label class="wide check" id="emp-state-row" hidden><span><input type="checkbox" id="emp-state-chk" checked>
          Atualizar o estado da empresa para <b id="emp-state-new"></b></span></label>
        ${prev ? `<p class="wide sub">O pendente do contacto de ${fmtDate(prev.data)} («${esc(prev.proximo_passo || prev.assunto || '')}») será marcado como resolvido.</p>` : ''}`);
      const upd = () => {
        const emp = get('empresas', $('[name=empresa_id]', form).value);
        const s = suggestEmpState(emp, $('[name=estado]', form).value);
        $('#emp-state-row', form).hidden = !s;
        $('#emp-state-chk', form).dataset.estado = s || '';
        if (s) $('#emp-state-new', form).textContent = `«${s}» (atual: ${emp.estado || '—'})`;
      };
      $('[name=empresa_id]', form).addEventListener('change', upd);
      $('[name=estado]', form).addEventListener('change', upd);
      upd();
    },
    async afterSave(saved, form, { preset }) {
      const chk = $('#emp-state-chk', form);
      if (chk?.checked && !$('#emp-state-row', form).hidden && chk.dataset.estado) {
        await api('save', { e: 'empresas', body: { id: saved.empresa_id, estado: chk.dataset.estado } });
      }
      if (preset._resolve) await api('save', { e: 'contactos', body: { id: preset._resolve, pendente: PEND_NADA } });
    },
  },
};

/* Ficha da empresa: resumo + histórico */
function empresaActions(r) {
  const opts = ent('empresas').fields.find((f) => f.name === 'estado').options;
  return `<select id="emp-state" title="Estado da empresa" style="width:auto">${opts.map((o) => `<option ${o === r.estado ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
    <a class="btn" href="#/ficha/${r.id}">📄 Ficha para conferência</a>
    <button class="btn primary" data-new-contact="${r.id}">📝 Registar contacto</button>`;
}
function empresaPanels(r) {
  const list = empContacts(r.id);
  const last = list[0];
  const pend = empPending(r.id);
  const nAno = rows('colocacoes').filter((c) => c.empresa_id === r.id && inYear(c) && c.estado !== 'Interrompida').length;
  const chip = (k, v) => `<div class="chip"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const tel = r.telefone_responsavel || r.telefone;
  const pessoas = rows('pessoas').filter((x) => x.empresa_id === r.id);
  return `<div class="chips">
      ${chip('Estado', badge(r.estado) || '—')}
      ${chip('Último contacto', last ? `${fmtDate(last.data)} <span class="sub">(${relDays(last.data)})</span>` : '<span class="sub">nunca</span>')}
      ${chip('Pendentes', pend.length ? `<b>${pend.length}</b> ${dueBadge(pend[0].data_followup)}` : '<span class="sub">nenhum</span>')}
      ${chip('Pessoa de contacto', `${esc(r.responsavel || '—')}${tel ? ` · <a href="tel:${esc(tel)}">${esc(tel)}</a>` : ''}`)}
      ${chip('Estagiários ' + esc(S.settings.ano_letivo || ''), `${nAno}${r.vagas ? ` <span class="sub">de ${fmtNum(r.vagas)} vaga(s)</span>` : ''}`)}
    </div>
    <div class="panel"><div class="section-head"><h2>👤 Pessoas de contacto <span class="sub">(${pessoas.length})</span></h2>
      <button class="btn small" data-add="pessoas" data-field="empresa_id">+ Pessoa</button></div>
      <p class="sub" style="margin-top:-6px">As marcadas «Pode ser tutor» aparecem para escolher como tutor nas afetações.</p>
      ${table('pessoas', pessoas, { hide: ['empresa_id'] })}</div>
    <div class="panel"><div class="section-head"><h2>📞 Histórico de contactos <span class="sub">(${list.length})</span></h2>
      <button class="btn small" data-new-contact="${r.id}">+ Registar contacto</button></div>
      ${timeline(list)}</div>`;
}
function bindEmpresa(r) {
  $('#emp-state').onchange = (ev) => quickSave('empresas', { id: r.id, estado: ev.target.value }, 'Estado da empresa atualizado.');
  bindContactActions();
}

/* Quadro de empresas por estado */
function empresasBoard(list) {
  const opts = ent('empresas').fields.find((f) => f.name === 'estado').options;
  return `<div class="board">${opts.map((o) => {
    const items = list.filter((e) => (e.estado || 'Por contactar') === o);
    return `<div class="bcol" data-col="${esc(o)}"><h3>${badge(o)} <span class="sub">${items.length}</span></h3>
      ${items.map((e) => {
        const last = empContacts(e.id)[0];
        const p = empPending(e.id)[0];
        return `<div class="bcard" data-go="#/ver/empresas/${e.id}" data-emp="${e.id}" draggable="true" title="Arraste para outra coluna para mudar o estado"><b>${esc(e.nome)}</b>
          <div class="sub">${esc(e.localidade || '')}</div>
          <div class="sub">${last ? `Último contacto ${relDays(last.data)}` : 'Sem contactos registados'}</div>
          ${p ? `<div>${pendBadge(p)} ${dueBadge(p.data_followup)}</div>` : ''}
          <select data-board-state="${e.id}" title="Mudar estado">${opts.map((x) => `<option ${x === (e.estado || 'Por contactar') ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        </div>`;
      }).join('') || '<p class="empty">—</p>'}</div>`;
  }).join('')}</div>`;
}
function bindBoard() {
  $$('.bcard[data-go]').forEach((c) => (c.onclick = (ev) => { if (ev.target.tagName !== 'SELECT') location.hash = c.dataset.go; }));
  $$('[data-board-state]').forEach((s) => (s.onchange = () => quickSave('empresas', { id: +s.dataset.boardState, estado: s.value }, 'Estado atualizado.')));

  // arrastar um cartão para outra coluna muda o estado da empresa (no telemóvel usa-se o seletor do cartão)
  let arrastado = null;
  $$('.bcard[data-emp]').forEach((c) => {
    c.ondragstart = (ev) => { arrastado = c; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', c.dataset.emp); c.classList.add('dragging'); };
    c.ondragend = () => { c.classList.remove('dragging'); $$('.bcol.drop').forEach((x) => x.classList.remove('drop')); arrastado = null; };
  });
  $$('.bcol[data-col]').forEach((col) => {
    col.ondragover = (ev) => { if (!arrastado) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; col.classList.add('drop'); };
    col.ondragleave = (ev) => { if (!col.contains(ev.relatedTarget)) col.classList.remove('drop'); };
    col.ondrop = (ev) => {
      ev.preventDefault();
      col.classList.remove('drop');
      const id = +ev.dataTransfer.getData('text/plain');
      const emp = get('empresas', id);
      if (!emp || (emp.estado || 'Por contactar') === col.dataset.col) return;
      col.querySelector('.empty')?.remove();
      col.append(arrastado); // mostra logo a mudança; a gravação volta a desenhar o quadro
      quickSave('empresas', { id, estado: col.dataset.col }, `«${emp.nome}» → ${col.dataset.col}`);
    };
  });
}

/* Página «Pendentes»: tudo o que está à espera de alguém, por prazo */
const pendFilter = { tipo: '' };
function viewPending() {
  const t = today(), w = addDays(t, 7);
  const open = rows('contactos').filter((c) => isPending(c) && (!pendFilter.tipo || c.pendente === pendFilter.tipo)).sort(byDue);
  const groups = [
    ['⏰ Atrasados', open.filter((c) => c.data_followup && c.data_followup < t)],
    ['📌 Para hoje', open.filter((c) => c.data_followup === t)],
    ['📅 Próximos 7 dias', open.filter((c) => c.data_followup > t && c.data_followup <= w)],
    ['🗓️ Mais tarde', open.filter((c) => c.data_followup > w)],
    ['❔ Sem prazo', open.filter((c) => !c.data_followup)],
  ].filter(([, l]) => l.length);
  const opts = ent('contactos').fields.find((f) => f.name === 'pendente').options.filter((o) => o !== PEND_NADA);
  const porContactar = rows('empresas').filter((e) => !e.estado || e.estado === 'Por contactar');
  const esquecidas = rows('empresas').filter((e) => {
    if (e.estado !== 'Em contacto' || empPending(e.id).length) return false;
    const last = empContacts(e.id)[0];
    return !last || daysBetween(last.data, t) > 30;
  });
  const row = (c) => `<tr class="click" data-go="#/ver/empresas/${c.empresa_id}">
      <td>${dueBadge(c.data_followup) || '<span class="sub">—</span>'}</td>
      <td><b>${esc(label('empresas', c.empresa_id))}</b><div class="sub">${esc(c.assunto || c.tipo || '')} · contacto de ${fmtDate(c.data)}</div></td>
      <td>${pendBadge(c)}</td><td>${esc(c.proximo_passo || '')}</td>
      <td class="nowrap"><button class="btn small" data-resolve="${c.id}" title="O pendente foi tratado">✓ Resolvido</button>
        <button class="btn small" data-snooze="${c.id}" title="Adiar o prazo uma semana">+1 semana</button>
        <button class="btn small" data-new-contact="${c.empresa_id}" data-prev="${c.id}" title="Registar um novo contacto sobre este assunto">📝 Novo contacto</button></td></tr>`;
  return `<div class="page-head"><div><h1>📌 Pendentes com empresas</h1>
      <div class="sub">Respostas que aguarda, coisas que tem de enviar ou fazer, e o que as empresas ficaram de enviar.</div></div></div>
    <div class="toolbar"><select id="pf"><option value="">Todos os pendentes</option>${opts.map((o) => `<option ${o === pendFilter.tipo ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
    ${groups.length ? groups.map(([title, l]) => `<div class="panel"><h2>${title} <span class="sub">(${l.length})</span></h2>
      <div class="table-wrap"><table><thead><tr><th>Prazo</th><th>Empresa</th><th>Pendente</th><th>O quê</th><th></th></tr></thead>
      <tbody>${l.map(row).join('')}</tbody></table></div></div>`).join('')
      : '<div class="panel"><p class="empty">Não há pendentes. 🎉</p></div>'}
    <div class="grid two">
      <div class="panel"><h2>🏢 Empresas por contactar <span class="sub">(${porContactar.length})</span></h2>
        ${porContactar.length ? `<ul class="events">${porContactar.map((e) => `<li><a href="#/ver/empresas/${e.id}">${esc(e.nome)}</a>
          <span class="sub">${esc(e.localidade || '')}</span></li>`).join('')}</ul>` : '<p class="empty">Nenhuma.</p>'}</div>
      <div class="panel"><h2>💤 «Em contacto» sem novidades há +30 dias <span class="sub">(${esquecidas.length})</span></h2>
        ${esquecidas.length ? `<ul class="events">${esquecidas.map((e) => { const l = empContacts(e.id)[0];
          return `<li><a href="#/ver/empresas/${e.id}">${esc(e.nome)}</a> <span class="sub">${l ? 'último contacto ' + relDays(l.data) : 'sem contactos'}</span></li>`; }).join('')}</ul>`
          : '<p class="empty">Nenhuma.</p>'}</div>
    </div>`;
}
function bindPending() {
  $('#pf').onchange = (ev) => { pendFilter.tipo = ev.target.value; render(); };
  bindRows();
  bindContactActions();
}

/* ---------- Plano de estágio (documento Word gerado a partir da afetação) ---------- */
const planoDe = (colId) => rows('planos').find((p) => p.colocacao_id === Number(colId));
const PLANO_OP_KEY = 'fct-plano-opcoes';
const planoOp = () => {
  const d = { capa: true, assiduidade: true, linhasAssiduidade: 64, sumarios: true, linhasSumarios: 46, avaliacao: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PLANO_OP_KEY) || '{}') }; } catch { return d; }
};
/** Logótipo atual (personalizado ou do modelo) com dimensões, para o Word. */
async function carregarLogo(k) {
  try {
    const res = await fetch(`api.php?a=logo&k=${k}&v=${S.logos[k]?.v || 0}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const data = new Uint8Array(await blob.arrayBuffer());
    const ext = data[0] === 0x89 && data[1] === 0x50 ? 'png' : 'jpeg';
    return { data, ext, w: bmp.width, h: bmp.height };
  } catch { return null; }
}
const planoAtividades = (colId) => rows('atividades').filter((a) => a.colocacao_id === Number(colId)).sort((a, b) => a.id - b.id);
function planoCtx(c, plano) {
  return { aluno: get('alunos', c.aluno_id) || {}, empresa: get('empresas', c.empresa_id) || {}, col: c,
    plano: plano || {}, atividades: planoAtividades(c.id), s: S.settings, p: S.diretor };
}
/** Texto por omissão (Definições ou modelo) para os campos variáveis. */
const planoDefaults = (c) => ({
  horario: c.horario || S.settings.horario_fct || '',
  objetivos_gerais: S.settings.objetivos_gerais || OBJ_GERAIS,
  objetivos_especificos: S.settings.objetivos_especificos || OBJ_ESPECIFICOS,
});

function viewPlano(colId) {
  const c = get('colocacoes', colId);
  if (!c) return '<p>Afetação não encontrada. <a href="#/lista/colocacoes">Ver afetações</a></p>';
  const plano = planoDe(c.id) || {};
  const v = planoVars(planoCtx(c, plano));
  const falta = planoEmFalta(v);
  const def = planoDefaults(c);
  const op = planoOp();
  const link = { Aluno: `#/ver/alunos/${c.aluno_id}`, Empresa: `#/ver/empresas/${c.empresa_id}`, 'Afetação': `#/ver/colocacoes/${c.id}`, 'Definições': '#/definicoes', Perfil: '#/definicoes' };
  const grupos = [...new Set(falta.map((f) => f.grupo))];
  const ativ = planoAtividades(c.id);
  return `<div class="page-head"><div><div class="sub"><a href="#/ver/colocacoes/${c.id}">← ${esc(label('colocacoes', c))}</a></div>
      <h1>📘 Plano de estágio</h1><div class="sub">Modelo da escola, preenchido com os dados da aplicação. O conteúdo variável pode ser ajustado abaixo.</div></div>
      <div class="actions"><button class="btn primary" id="plano-docx">⬇️ Descarregar Word (.docx)</button></div></div>
    ${falta.length ? `<div class="panel warn-panel"><b>⚠️ Dados em falta</b> <span class="sub">— ficam em branco no documento (pode completar aqui ou à mão no Word)</span>
      <ul class="missing">${grupos.map((g) => `<li><a href="${link[g]}">${esc(g)}</a>: ${falta.filter((f) => f.grupo === g).map((f) => esc(f.campo)).join(', ')}</li>`).join('')}</ul></div>`
      : '<div class="panel ok-panel">✅ Todos os dados principais estão preenchidos.</div>'}
    <div class="panel"><div class="section-head"><h2>🧑‍🏫 3. Professor acompanhante</h2><a class="btn small" href="#/lista/professores">Gerir professores</a></div>
      <div class="toolbar" style="margin-bottom:6px"><select id="plano-prof" style="max-width:520px">
        <option value="">${c.professor_acompanhante ? '— mudar para… —' : '— nenhum: usar os meus dados (diretor de curso) —'}</option>
        ${professoresLista().map((x, i) => profOpcao(x, i, c.professor_acompanhante)).join('')}
        ${c.professor_acompanhante ? '<option value="none">Nenhum — usar os meus dados (diretor de curso)</option>' : ''}</select></div>
      <p class="sub" style="margin:0">No plano: <b>${esc(v.prof.nome || '—')}</b>${v.prof.email ? ' · ' + esc(v.prof.email) : ''}${v.prof.tel ? ' · ' + esc(v.prof.tel) : ''}
        ${v.prof.eDiretor ? ' <span class="badge info">diretor de curso — dados do <a href="#/definicoes">perfil</a></span>' : ''}</p></div>
    <form class="panel" id="plano-form"><div class="section-head"><h2>✏️ Conteúdo variável deste plano</h2>
        <button type="button" class="btn small" id="plano-reset" title="Volta a usar os textos das Definições">Repor textos das Definições</button></div>
      <div class="form-grid">
        <label><span>Horário <span class="sub">(6.2)</span></span><input name="horario" value="${esc(plano.horario || '')}" placeholder="${esc(def.horario || 'ex.: 7 a 9 horas diárias, 5 dias por semana')}"></label>
        <label><span>Data do documento <span class="sub">(vazio = «___ de ___» para preencher à mão)</span></span><input type="date" name="data_documento" value="${esc(plano.data_documento || '')}"></label>
        <label class="wide"><span>Objetivos gerais <span class="sub">(6.3 — um por linha)</span></span><textarea name="objetivos_gerais" rows="8">${esc(plano.objetivos_gerais || def.objetivos_gerais)}</textarea></label>
        <label class="wide"><span>Objetivos específicos <span class="sub">(6.3 — um por linha)</span></span><textarea name="objetivos_especificos" rows="6">${esc(plano.objetivos_especificos || def.objetivos_especificos)}</textarea></label>
        <label class="wide"><span>Informação adicional <span class="sub">(secção 6.5, opcional — aparece depois do roteiro)</span></span><textarea name="informacao_adicional" rows="3">${esc(plano.informacao_adicional || '')}</textarea></label>
      </div>
      <div class="actions"><button class="btn primary">Guardar</button><span class="sub" id="plano-state">${plano.id ? `Guardado${plano.atualizado_em ? ' em ' + fmtDateTime(plano.atualizado_em) : ''}` : 'Ainda não guardado — está a usar os textos das Definições.'}</span></div>
    </form>
    <div class="panel"><div class="section-head"><h2>🛠️ 6.4 Roteiro de atividades <span class="sub">(${ativ.length})</span></h2>
        <button class="btn small" id="plano-add-ativ">+ Atividade</button></div>
      <p class="sub">Cada atividade ocupa uma linha da tabela (Atividade · Mês · Observações). A tabela tem pelo menos 11 linhas; as que faltarem ficam em branco.</p>
      ${table('atividades', ativ, { hide: ['colocacao_id'] })}</div>
    <div class="panel"><h2>📄 Secções do documento</h2>
      <div class="opts">
        <label><input type="checkbox" data-op="capa" ${op.capa ? 'checked' : ''}> Capa</label>
        <label><input type="checkbox" data-op="assiduidade" ${op.assiduidade ? 'checked' : ''}> Ficha de assiduidade (em branco, para a empresa) —
          <input type="number" min="5" max="200" data-op-n="linhasAssiduidade" value="${op.linhasAssiduidade}"> linhas</label>
        <label><input type="checkbox" data-op="sumarios" ${op.sumarios ? 'checked' : ''}> Sumários das atividades —
          <input type="number" min="5" max="200" data-op-n="linhasSumarios" value="${op.linhasSumarios}"> linhas</label>
        <label><input type="checkbox" data-op="avaliacao" ${op.avaliacao ? 'checked' : ''}> Ficha de avaliação final e observações</label>
      </div>
      <p class="sub">Para PDF: abra o .docx no Word e use <b>Ficheiro → Guardar como → PDF</b>.</p></div>`;
}

function bindPlano(colId) {
  const c = get('colocacoes', colId);
  if (!c) return;
  bindRows();
  const form = $('#plano-form');
  const def = planoDefaults(c);
  const values = () => {
    const fd = Object.fromEntries(new FormData(form));
    // texto igual ao das Definições não é guardado no plano (assim acompanha alterações nas Definições)
    for (const k of ['objetivos_gerais', 'objetivos_especificos']) if (fd[k].trim() === String(def[k]).trim()) fd[k] = '';
    return fd;
  };
  const save = async () => {
    const plano = planoDe(c.id);
    const body = { ...values(), colocacao_id: c.id, ...(plano ? { id: plano.id } : {}) };
    await api('save', { e: 'planos', body });
    await reload();
  };
  form.oninput = () => { $('#plano-state').textContent = 'Alterações por guardar'; form.dataset.dirty = '1'; };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    try { await save(); toast('Plano guardado.'); render(); } catch (err) { toast(err.message, true); }
  };
  $('#plano-reset').onclick = () => {
    form.objetivos_gerais.value = def.objetivos_gerais;
    form.objetivos_especificos.value = def.objetivos_especificos;
    form.horario.value = '';
    form.oninput();
  };
  $('#plano-add-ativ').onclick = () => openForm('atividades', null, { colocacao_id: c.id });
  $('#plano-prof').onchange = (ev) => {
    const x = ev.target.value === 'none' ? { nome: '', email: '', tel: '' } : professoresLista()[ev.target.value];
    if (!x) return;
    quickSave('colocacoes', { id: c.id, professor_acompanhante: x.nome, email_professor: x.email || '', telefone_professor: x.tel || '' },
      x.nome ? `Professor acompanhante: ${x.nome}.` : 'Sem professor acompanhante: fica o diretor de curso.');
  };
  const saveOp = () => {
    const op = planoOp();
    $$('[data-op]').forEach((i) => (op[i.dataset.op] = i.checked));
    $$('[data-op-n]').forEach((i) => (op[i.dataset.opN] = Math.max(5, Math.min(200, +i.value || 0))));
    try { localStorage.setItem(PLANO_OP_KEY, JSON.stringify(op)); } catch { /* sem armazenamento local */ }
    return op;
  };
  $$('[data-op], [data-op-n]').forEach((i) => (i.onchange = saveOp));
  $('#plano-docx').onclick = async () => {
    const b = $('#plano-docx');
    b.disabled = true;
    try {
      if (form.dataset.dirty) await save();
      const v = planoVars(planoCtx(c, planoDe(c.id)));
      const [escola, rep] = await Promise.all([carregarLogo('escola'), carregarLogo('republica')]);
      const blob = gerarPlanoDocx(v, { escola, rep }, saveOp());
      const nome = `Plano de Estágio - ${(v.aluno.nome || 'aluno').replace(/[\\/:*?"<>|]+/g, '')}.docx`;
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nome });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Plano descarregado.');
      if (form.dataset.dirty) render();
    } catch (err) { toast(err.message, true); }
    b.disabled = false;
  };
}

/* ---------- Definições e perfil ---------- */
function settingInput(f, v, name = f.name) {
  if (f.type === 'textarea') return `<textarea name="${name}" rows="6" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
  if (f.type === 'select') return `<select name="${name}">${f.options.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  return `<input name="${name}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${f.type === 'password' ? 'autocomplete="new-password"' : ''}>`;
}
const field = (f, v) => `<label class="${f.type === 'textarea' ? 'wide' : ''}"><span>${esc(f.label)}</span>${settingInput(f, v ?? '')}</label>`;

function viewSettings() {
  // divide as definições em grupos ({ group: '...' } no schema.json)
  const groups = [{ title: 'Escola', items: [], curso: false }];
  for (const s of S.schema.settings) {
    if (s.group) groups.push({ title: s.group, items: [], curso: s.scope === 'curso' });
    else groups.at(-1).items.push(s);
  }
  const admin = !!S.eu.admin;
  const visiveis = groups.filter((g) => (g.curso ? !!S.curso_id : admin));
  const nomeCurso = S.cursos.find((c) => c.id === S.curso_id)?.nome || '';
  const P = S.perfil || {};
  const pf = Object.fromEntries(S.schema.perfil.map((f) => [f.name, f]));
  const lembOn = P.lembretes_ativos === 'Sim';
  return `<div class="page-head"><h1>⚙️ Definições</h1></div>
    <form class="panel" id="perfil"><h2>👤 O meu perfil e lembretes por email</h2>
      <p class="sub">Os lembretes trazem as tarefas, os pendentes com empresas, as entrevistas e as reuniões que se aproximam.
        São enviados <b>só para si</b>, no máximo uma vez por dia — a aplicação não envia emails a empresas nem a alunos.</p>
      <div class="form-grid">
        <label><span>O meu nome</span><input name="diretor_curso" value="${esc(P.diretor_curso || '')}" required></label>
        ${field(pf.email_diretor, P.email_diretor)}
        ${field(pf.telefone_diretor, P.telefone_diretor)}
        ${field(pf.lembretes_ativos, P.lembretes_ativos || 'Não')}
        ${field(pf.lembretes_dias, P.lembretes_dias)}
      </div>
      ${admin ? `<details ${P.smtp_host ? 'open' : ''} style="margin:6px 0 12px"><summary><b>Servidor de envio (SMTP)</b> <span class="sub">— recomendado; sem isto usa a função mail() do alojamento</span></summary>
        <p class="sub">Ex.: Gmail — servidor <code>smtp.gmail.com</code>, porta 465, segurança ssl, utilizador = o seu endereço Gmail e uma
          <b>palavra-passe de aplicação</b> (Conta Google → Segurança → Palavras-passe de aplicações). Outlook/Office 365: <code>smtp.office365.com</code>, porta 587, tls.</p>
        <div class="form-grid">
          ${['smtp_host', 'smtp_porta', 'smtp_seguranca', 'smtp_utilizador', 'smtp_password', 'smtp_remetente'].map((k) => field(pf[k], P[k] || (k === 'smtp_seguranca' ? 'ssl' : ''))).join('')}
        </div><p class="sub">O servidor SMTP é usado para os lembretes de todos os utilizadores.</p></details>` : ''}
      <div class="actions"><button class="btn primary">Guardar perfil</button>
        <button type="button" class="btn" id="mail-test">✉️ Enviar email de teste</button>
        <span class="sub">${lembOn ? '🔔 Lembretes ativos' : '🔕 Lembretes desativados'}</span></div>
      ${admin ? `<details style="margin-top:12px"><summary class="sub">Envio diário mesmo sem abrir a aplicação</summary>
        <p class="sub">Sem mais nada, o lembrete do dia é enviado na primeira vez que abre a aplicação. Para o receber todas as manhãs,
          crie no alojamento (cPanel → Tarefas Cron) uma tarefa diária, por exemplo às 8h:<br>
          <code>php ${esc(location.pathname.replace(/[^/]*$/, ''))}api.php lembretes</code> <span>(use o caminho completo da pasta no servidor;
          envia os lembretes de todos os utilizadores que os tenham ativos)</span></p></details>` : ''}
    </form>
    ${visiveis.length ? `<form class="panel" id="settings"><h2>🏫 ${admin ? 'Escola e curso' : 'Curso'}</h2>
      <p class="sub">Usados no plano de estágio. Os objetivos e o horário são o texto por omissão — em cada plano pode alterá-los.
        ${nomeCurso ? `Os dados do curso aplicam-se ao curso <b>${esc(nomeCurso)}</b>.` : ''}</p>
      ${visiveis.map((g, i) => `${i || !admin ? `<h3>${esc(g.title)}</h3>` : ''}<div class="form-grid">${g.items.map((s) => field(s, S.settings[s.name])).join('')}</div>`).join('')}
      <button class="btn primary">Guardar</button></form>` : ''}
    ${admin ? `<div class="panel"><h2>🖼️ Logótipos dos documentos</h2>
      <p class="sub">Usados no cabeçalho de todas as páginas e na capa do plano de estágio. Imagem JPG ou PNG (máx. 5 MB);
        de preferência com fundo branco ou transparente.</p>
      <div class="logos">${Object.entries(S.logos).map(([k, l]) => `<div class="logo-card">
        <div class="logo-img"><img src="api.php?a=logo&k=${k}&v=${l.v}" alt="${esc(l.label)}"></div>
        <div><b>${esc(l.label)}</b><div class="sub">${l.personalizado ? 'Imagem carregada por si' : 'Imagem do modelo da escola'}</div></div>
        <div class="actions"><button class="btn small" data-logo-up="${k}">🔁 Mudar imagem</button>
          ${l.personalizado ? `<button class="btn small" data-logo-reset="${k}">Repor original</button>` : ''}</div>
      </div>`).join('')}</div>
      <input type="file" id="logo-file" accept=".jpg,.jpeg,.png" hidden></div>` : ''}
    <div class="grid two">
      <form class="panel" id="pw"><h2>Alterar palavra-passe</h2>
        <label style="display:block;margin-bottom:10px"><span class="sub">Atual</span><input type="password" name="atual" required autocomplete="current-password"></label>
        <label style="display:block;margin-bottom:10px"><span class="sub">Nova (mín. 8 caracteres)</span><input type="password" name="nova" required minlength="8" autocomplete="new-password"></label>
        <button class="btn">Alterar</button></form>
      <div class="panel"><h2>Exportar e cópia de segurança</h2>
        <p class="sub">Excel com a listagem breve e uma folha por tabela (alunos, empresas, pessoas de contacto, contactos,
          protocolos, entrevistas, afetações, atividades, planos, tarefas, reuniões).</p>
        <p><button class="btn primary" type="button" id="exp-all">📊 Exportar todas as tabelas (Excel)</button></p>
        <p class="sub">Descarrega ${admin ? 'todos os dados (todos os cursos)' : 'os dados do seu curso e os partilhados'} num ficheiro JSON.
          Faça-o regularmente. Os ficheiros dos protocolos não vão na cópia (ficam na pasta <code>protocolos</code> junto à base de dados, no servidor).</p>
        <a class="btn" href="api.php?a=export" download>⬇️ Descarregar cópia (JSON)</a></div>
    </div>`;
}

function bindSettings() {
  if ($('#settings')) $('#settings').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api('settings', { body: Object.fromEntries(new FormData(ev.target)) });
      await reload();
      toast('Definições guardadas.'); renderWho();
    } catch (err) { toast(err.message, true); }
  };
  const savePerfil = async () => {
    const r = await api('perfil', { body: Object.fromEntries(new FormData($('#perfil'))) });
    S.perfil = r.perfil;
  };
  $('#perfil').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await savePerfil(); await reload(); toast('Perfil guardado.'); renderWho(); render(); } catch (err) { toast(err.message, true); }
  };
  $('#mail-test').onclick = async () => {
    const b = $('#mail-test');
    b.disabled = true;
    b.textContent = 'A enviar…';
    try {
      await savePerfil();
      const r = await api('lembretes_teste', { body: {} });
      toast(`${r.motivo} (${r.itens} lembrete(s))`);
    } catch (err) { toast(err.message, true); }
    b.disabled = false;
    b.textContent = '✉️ Enviar email de teste';
  };
  $('#exp-all').onclick = exportarTudo;
  let logoK = null;
  const lf = $('#logo-file');
  $$('[data-logo-up]').forEach((b) => (b.onclick = () => { logoK = b.dataset.logoUp; lf.value = ''; lf.click(); }));
  if (lf) lf.onchange = async () => {
    const file = lf.files[0];
    if (!file || !logoK) return;
    const fd = new FormData();
    fd.append('ficheiro', file);
    try {
      const res = await fetch(`api.php?a=logo_carregar&k=${logoK}`, { method: 'POST', body: fd, headers: { 'X-FCT': '1' }, credentials: 'same-origin' });
      const json = await res.json().catch(() => ({ erro: 'Resposta inválida do servidor.' }));
      if (!res.ok) throw new Error(json.erro || 'Erro ' + res.status);
      S.logos = json.logos;
      toast('Logótipo atualizado.');
      render();
    } catch (err) { toast(err.message, true); }
  };
  $$('[data-logo-reset]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Voltar a usar o logótipo original do modelo?')) return;
    try { S.logos = (await api('logo_repor', { body: {}, k: b.dataset.logoReset })).logos; toast('Logótipo reposto.'); render(); }
    catch (err) { toast(err.message, true); }
  }));
  $('#pw').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api('password', { body: Object.fromEntries(new FormData(ev.target)) });
      ev.target.reset();
      toast('Palavra-passe alterada.');
    } catch (err) { toast(err.message, true); }
  };
}

/* ---------- Importação em lote (Excel / CSV) ---------- */
const IMP_LABEL = {
  alunos: 'Alunos e encarregados de educação',
  empresas: 'Empresas / entidades de acolhimento',
  colocacoes: 'Afetações aluno → empresa (tutor, professor acompanhante)',
};
const imp = { file: null, sheets: [], sheet: 0, map: null, criar: { alunos: true, empresas: true, colocacoes: false }, ano: null, estado: 'Parceira', result: null, busy: false };
const MAP_KEY = 'fct-import-map';
const loadSavedMap = () => { try { return JSON.parse(localStorage.getItem(MAP_KEY)) || {}; } catch { return {}; } };

/** Modos: «empresas» (a partir da página Empresas: só empresas, sinónimos genéricos), «alunos» (página Alunos: só alunos,
 *  com modelo Excel) ou geral (ficheiro com alunos, empresas e afetações). */
function modoImport(modo) {
  const m = ['empresas', 'alunos'].includes(modo) ? modo : '';
  if ((imp.modo ?? '') === m && imp.soEmpresas !== undefined) return;
  Object.assign(imp, { modo: m, soEmpresas: m === 'empresas', soAlunos: m === 'alunos', file: null, sheets: [], sheet: 0, map: null, result: null,
    criar: { alunos: m !== 'empresas', empresas: m !== 'alunos', colocacoes: false },
    estado: m === 'empresas' ? 'Por contactar' : 'Parceira', soVazios: true });
}
const impMap = (headers) => autoMap(S.schema, headers, imp.modo ? {} : loadSavedMap(), { soEmpresas: imp.soEmpresas, soAlunos: imp.soAlunos });

/** Modelo Excel para importar alunos: folha «Alunos» com os cabeçalhos certos e folha «Instruções». */
function modeloAlunos() {
  const fields = importFields(S.schema, 'alunos');
  const formato = (f) => ({ date: 'Data (dd/mm/aaaa)', email: 'Email', tel: 'Telefone (só algarismos)', textarea: 'Texto livre' }[f.type] || 'Texto');
  const exemplo = { numero: '12345', nome: 'Maria da Silva Santos', turma: '12.º A', data_nascimento: '15/03/2008', email: 'maria.santos@exemplo.pt',
    telefone: '912345678', codigo_postal: '2615-205', encarregado: 'José Santos', contacto_encarregado: '913456789' };
  descarregar(gerarXlsx([
    { nome: 'Alunos', linhas: [fields.map((f) => f.label)] },
    { nome: 'Instruções', linhas: [
      ['Coluna', 'Obrigatória', 'Formato', 'Exemplo'],
      ...fields.map((f) => [f.label, f.required ? 'Sim' : '', formato(f), exemplo[f.name] || '']),
      [], ['Preencha uma linha por aluno na folha «Alunos». Não altere os cabeçalhos (pode apagar colunas que não use).'],
      ['Os alunos já existentes são atualizados pelo nº de processo (ou pelo nome) — não ficam duplicados.'],
      ['O ano letivo e o curso escolhem-se na aplicação, no momento da importação.'],
    ] },
  ]), 'Modelo importação alunos.xlsx');
}

function viewImport(modo) {
  modoImport(modo);
  const sh = imp.sheets[imp.sheet];
  const ano = imp.ano ?? S.settings.ano_letivo ?? '';
  let html = imp.soAlunos
    ? `<div class="page-head"><div><div class="sub"><a href="#/lista/alunos">← Alunos</a></div><h1>📥 Importar alunos</h1>
      <div class="sub">Carregue a lista de alunos em Excel (.xlsx) ou CSV, uma linha por aluno. Use o modelo para ter as colunas certas —
      ou o seu próprio ficheiro: as colunas são reconhecidas automaticamente e pode ajustar a correspondência.
      Os alunos ficam no curso <b>${esc(S.cursos.find((c) => c.id === S.curso_id)?.nome || '—')}</b>.</div></div>
      <div class="actions"><button class="btn primary" id="imp-modelo" type="button">⬇️ Descarregar modelo Excel</button></div></div>`
    : imp.soEmpresas
    ? `<div class="page-head"><div><div class="sub"><a href="#/lista/empresas">← Empresas</a></div><h1>📥 Importar empresas</h1>
      <div class="sub">Carregue uma lista de empresas em Excel (.xlsx) ou CSV, uma linha por empresa (ex.: Empresa, Status, Contacto, Email, Telefone, Morada).
      As colunas são reconhecidas automaticamente; os contactos ficam também em «Pessoas de contacto» da empresa.</div></div></div>`
    : `<div class="page-head"><div><h1>📥 Importar dados</h1>
      <div class="sub">Carregue um ficheiro Excel (.xlsx) ou CSV com uma linha por aluno. As colunas são reconhecidas automaticamente e pode ajustar a correspondência.
      Para uma lista só de empresas use <a href="#/importar/empresas">Importar empresas</a>.</div></div></div>`;
  html += `
    <div class="panel"><h2>1. Ficheiro</h2>
      <div class="toolbar"><input type="file" id="imp-file" accept=".xlsx,.csv,.txt" style="max-width:420px">
      ${imp.sheets.length > 1 ? `<select id="imp-sheet">${imp.sheets.map((s, i) => `<option value="${i}" ${i === imp.sheet ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}</div>
      ${sh ? `<p><b>${esc(imp.file)}</b> — ${sh.rows.length} linha(s), ${sh.headers.length} coluna(s).</p>
        ${sh.csvColado ? '<p class="sub">ℹ️ Os dados estavam como texto separado por vírgulas na coluna A — foram separados em colunas automaticamente.</p>' : ''}`
        : '<p class="sub">Nenhum ficheiro carregado. O ficheiro é lido no seu computador; só os dados das colunas ligadas são enviados.</p>'}
    </div>`;
  if (!sh) return html;

  const estOpts = ent('empresas').fields.find((f) => f.name === 'estado').options;
  html += `<div class="panel"><h2>2. O que importar</h2>
      <div class="grid two">
        <div>${IMPORT_TARGETS.filter((t) => !imp.soAlunos || t === 'alunos').map((t) => `<label style="display:block;margin-bottom:6px"><input type="checkbox" data-criar="${t}" style="width:auto" ${imp.criar[t] ? 'checked' : ''}> ${esc(IMP_LABEL[t])}</label>`).join('')}</div>
        <div><label style="display:${imp.soEmpresas ? 'none' : 'block'};margin-bottom:10px"><span class="sub">Ano letivo dos alunos${imp.criar.colocacoes ? ' e afetações' : ''}</span>
            <input id="imp-ano" value="${esc(ano)}" placeholder="2026/2027"></label>
          <label style="display:${imp.soAlunos ? 'none' : 'block'}"><span class="sub">Estado das empresas novas${imp.map?.empresas?.estado != null ? ' (quando o ficheiro não indica)' : ''}</span>
            <select id="imp-estado">${estOpts.map((o) => `<option ${o === imp.estado ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label></div>
      </div>
      ${imp.soEmpresas ? `<label style="display:block;margin-top:8px"><input type="checkbox" id="imp-vazios" style="width:auto" ${imp.soVazios ? 'checked' : ''}>
        Empresas que já existem: <b>só preencher os campos vazios</b> (não substitui dados já registados)</label>` : ''}
      <p class="sub">Registos já existentes são atualizados (alunos pelo nº de processo, empresas pelo nome, NIF ou email) — não ficam duplicados. As notas são acrescentadas, nunca apagadas.</p>
    </div>`;

  const sample = (idx) => { const r = sh.rows.find((x) => x[idx] != null && String(x[idx]).trim() !== ''); return r ? String(r[idx]).slice(0, 40) : ''; };
  const active = IMPORT_TARGETS.filter((t) => imp.criar[t]);
  const used = new Set(active.flatMap((t) => Object.values(imp.map[t])));
  const unused = sh.headers.filter((_, i) => !used.has(i));
  html += `<div class="panel"><h2>3. Correspondência de colunas</h2>
    ${active.map((t) => {
      const fields = importFields(S.schema, t);
      return `<details open style="margin-bottom:12px"><summary><b>${esc(ent(t).label)}</b> <span class="sub">— ${Object.keys(imp.map[t]).length} de ${fields.length} campos ligados</span></summary>
        <div class="table-wrap"><table><thead><tr><th>Campo na aplicação</th><th>Coluna do ficheiro</th><th>Exemplo (1.ª linha preenchida)</th></tr></thead><tbody>
        ${fields.map((f) => {
          const idx = imp.map[t][f.name];
          return `<tr><td>${esc(f.label)}${f.required ? ' <span class="badge bad">obrigatório</span>' : ''}</td>
            <td><select data-map="${t}" data-field="${f.name}"><option value="">— ignorar —</option>${sh.headers.map((h, i) => `<option value="${i}" ${i === idx ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></td>
            <td class="clip sub">${idx != null ? esc(sample(idx)) : ''}</td></tr>`;
        }).join('')}
        </tbody></table></div></details>`;
    }).join('')}
    ${unused.length ? `<p class="sub">Colunas não importadas: ${unused.map(esc).join(', ')}</p>` : ''}
    <div class="actions"><button class="btn" id="imp-sim" ${imp.busy ? 'disabled' : ''}>🔍 Pré-visualizar (não grava)</button>
      <button class="btn primary" id="imp-go" ${imp.busy ? 'disabled' : ''}>📥 Importar</button></div>
  </div>`;

  if (imp.result) {
    const r = imp.result;
    html += `<div class="panel"><h2>${r.simulacao ? '🔍 Pré-visualização' : '✅ Importação concluída'}</h2>
      <table style="max-width:560px"><thead><tr><th></th><th>Novos</th><th>Atualizados</th><th>Sem alterações</th></tr></thead><tbody>
      ${[...active, ...(r.pessoas && (r.pessoas.novos + r.pessoas.atualizados + r.pessoas.iguais) ? ['pessoas'] : [])].map((t) => `<tr><td>${esc(ent(t).label)}</td><td>${r[t].novos}</td><td>${r[t].atualizados}</td><td>${r[t].iguais}</td></tr>`).join('')}
      </tbody></table>
      <p class="sub">${r.linhas} linha(s) lida(s)${r.ignoradas ? `, ${r.ignoradas} sem dados para importar` : ''}.${r.simulacao ? ' Nada foi gravado — carregue em «Importar» para confirmar.' : ''}</p>
      ${r.avisos.length ? `<h2 style="margin-top:14px">⚠️ Avisos (${r.avisos.length})</h2><ul>${r.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p>Sem avisos.</p>'}
    </div>`;
  }
  return html;
}

function bindImport(modo) {
  modoImport(modo);
  if ($('#imp-modelo')) $('#imp-modelo').onclick = modeloAlunos;
  $('#imp-file').onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      const sheets = await parseFile(f.name, await f.arrayBuffer());
      if (!sheets.length) throw new Error('O ficheiro não tem dados.');
      Object.assign(imp, { file: f.name, sheets, sheet: 0, result: null, map: impMap(sheets[0].headers) });
      render();
    } catch (err) { toast(err.message, true); }
  };
  if (!imp.sheets.length) return;
  if ($('#imp-sheet')) $('#imp-sheet').onchange = (ev) => {
    imp.sheet = +ev.target.value;
    imp.result = null;
    imp.map = impMap(imp.sheets[imp.sheet].headers);
    render();
  };
  $$('[data-criar]').forEach((c) => (c.onchange = () => { imp.criar[c.dataset.criar] = c.checked; imp.result = null; render(); }));
  $('#imp-ano').onchange = (ev) => { imp.ano = ev.target.value.trim(); imp.result = null; };
  $('#imp-estado').onchange = (ev) => { imp.estado = ev.target.value; imp.result = null; };
  if ($('#imp-vazios')) $('#imp-vazios').onchange = (ev) => { imp.soVazios = ev.target.checked; imp.result = null; };
  $$('[data-map]').forEach((s) => (s.onchange = () => {
    const m = imp.map[s.dataset.map];
    if (s.value === '') delete m[s.dataset.field]; else m[s.dataset.field] = +s.value;
    imp.result = null;
    render();
  }));

  const run = async (simular) => {
    if (!IMPORT_TARGETS.some((t) => imp.criar[t])) return toast('Escolha pelo menos um tipo de dados a importar.', true);
    if (!simular && !confirm('Importar os dados para a aplicação?')) return;
    const sh = imp.sheets[imp.sheet];
    imp.busy = true;
    render();
    try {
      imp.result = await api('importar', { body: {
        ano_letivo: imp.ano ?? S.settings.ano_letivo ?? '', criar: imp.criar, estado_empresa: imp.estado, simular,
        so_vazios: imp.soEmpresas && imp.soVazios,
        linhas: buildLines(S.schema, sh.rows, imp.map),
      } });
      if (!simular && !imp.modo) {
        // guarda a correspondência (pelo nome do cabeçalho) para a próxima importação
        const saved = loadSavedMap();
        for (const t of IMPORT_TARGETS) {
          saved[t] ||= {};
          for (const f of importFields(S.schema, t)) {
            const idx = imp.map[t][f.name];
            saved[t][f.name] = idx != null ? sh.headers[idx] : null;
          }
        }
        try { localStorage.setItem(MAP_KEY, JSON.stringify(saved)); } catch { /* sem armazenamento local */ }
      }
      if (!simular) { await reload(); toast('Importação concluída.'); }
    } catch (err) { toast(err.message, true); }
    imp.busy = false;
    render();
  };
  $('#imp-sim').onclick = () => run(true);
  $('#imp-go').onclick = () => run(false);
}

/* ---------------- Router ---------------- */
function renderNav(route) {
  const items = [
    ['#/', '📊', 'Painel'],
    'sep',
    [`#/lista/empresas`, ent('empresas').icon, ent('empresas').label],
    ['#/pendentes', '📌', 'Pendentes', pendingDueCount()],
    ...['contactos', 'protocolos'].map((n) => [`#/lista/${n}`, ent(n).icon, ent(n).label]),
    [`#/lista/tarefas`, ent('tarefas').icon, ent('tarefas').label, tarefasDue()],
    'sep',
    [`#/lista/alunos`, ent('alunos').icon, ent('alunos').label],
    ['#/listagem', '📋', 'Listagem breve'],
    [`#/lista/professores`, ent('professores').icon, 'Professores'],
    ...['entrevistas', 'colocacoes', 'atividades'].map((n) => [`#/lista/${n}`, ent(n).icon, ent(n).label]),
    [`#/lista/reunioes`, ent('reunioes').icon, ent('reunioes').label],
    'sep',
    ['#/importar', '📥', 'Importar'],
    ...(S.eu.admin ? [['#/utilizadores', '👥', 'Utilizadores']] : []),
    ['#/definicoes', '⚙️', 'Definições'],
  ];
  const cur = '#/' + route.split('/').slice(0, 2).join('/').replace(/^ver\//, 'lista/');
  $('#nav').innerHTML = items.map((i) => i === 'sep' ? '<div class="sep"></div>'
    : `<a href="${i[0]}" class="${(i[0] === '#/' ? cur === '#/' : cur.startsWith(i[0])) ? 'active' : ''}"><span>${i[1]}</span>${esc(i[2])}${i[3] ? `<span class="nav-count" title="Para hoje ou atrasados">${i[3]}</span>` : ''}</a>`).join('');
}

function render() {
  const route = location.hash.replace(/^#\/?/, '');
  const [page, a, b] = route.split('/');
  renderNav(route);
  const views = {
    '': [viewDashboard, bindDashboard],
    lista: [() => viewList(a), () => bindList(a)],
    ver: [() => viewDetail(a, b), () => bindDetail(a, b)],
    plano: [() => viewPlano(a), () => bindPlano(a)],
    definicoes: [viewSettings, bindSettings],
    utilizadores: [viewUtilizadores, bindUtilizadores],
    importar: [() => viewImport(a), () => bindImport(a)],
    pendentes: [viewPending, bindPending],
    listagem: [viewListagem, bindListagem],
    ficha: [() => viewFicha(a), () => bindFicha(a)],
  };
  const [view, bind] = views[page] || [() => '<p>Página não encontrada.</p>', () => {}];
  if (page === 'lista' && (!ent(a) || ent(a).hidden)) { main.innerHTML = '<p>Página não encontrada.</p>'; return; }
  main.innerHTML = view();
  bind();
}

/* No telemóvel as tabelas aparecem como cartões: cada célula recebe o nome da coluna (data-label). */
function labelTables(root) {
  root.querySelectorAll('table').forEach((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!heads.length) return;
    t.classList.add('stack');
    t.querySelectorAll('tbody tr').forEach((tr) =>
      [...tr.children].forEach((td, i) => { if (heads[i] && !td.dataset.label) td.dataset.label = heads[i]; }));
  });
}
new MutationObserver(() => labelTables(main)).observe(main, { childList: true, subtree: true });

/* ---------------- Arranque e autenticação ---------------- */
function showLogin(setup) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  for (const id of ['#login-pw2', '#login-nome']) { $(id).hidden = !setup; $(id).required = setup; }
  $('#login-pw').autocomplete = setup ? 'new-password' : 'current-password';
  $('#login-msg').textContent = setup
    ? 'Primeira utilização: crie a conta de administrador (palavra-passe com mín. 8 caracteres).'
    : 'Introduza o utilizador e a palavra-passe.';
  $('#login-btn').textContent = setup ? 'Criar e entrar' : 'Entrar';
  $('#login-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const pw = $('#login-pw').value;
    $('#login-err').textContent = '';
    if (setup && pw !== $('#login-pw2').value) { $('#login-err').textContent = 'As palavras-passe não coincidem.'; return; }
    try {
      await api(setup ? 'setup' : 'login', { body: { nome: $('#login-nome').value, login: $('#login-user').value, password: pw } });
      $('#login-form').reset();
      await start();
    } catch (err) { $('#login-err').textContent = err.message; }
  };
  (setup ? $('#login-nome') : $('#login-user')).focus();
}

/** Utilizador com sessão iniciada e curso em que está a trabalhar (o admin e quem tem vários cursos pode mudar). */
function renderWho() {
  const { eu, cursos, curso_id } = S;
  $('#who').innerHTML = `<div class="who-nome">${esc(eu.nome || '')}</div>
    <div class="sub">${eu.admin ? 'Administrador' : 'Diretor(a) de curso'}</div>
    ${cursos.length > 1 ? `<select id="curso-sel" aria-label="Curso">${cursos.map((c) => `<option value="${c.id}" ${c.id === curso_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>`
      : cursos.length ? `<div class="who-curso">${esc(cursos[0].nome)}</div>`
      : `<div class="who-curso">${eu.admin ? '<a href="#/utilizadores">Crie o primeiro curso</a>' : 'Sem curso atribuído'}</div>`}`;
  const sel = $('#curso-sel');
  if (sel) sel.onchange = async () => {
    try { await api('curso_ativo', { body: { curso_id: +sel.value } }); await reload(); renderWho(); render(); toast('Curso: ' + sel.selectedOptions[0].text); }
    catch (err) { toast(err.message, true); }
  };
}

/* ---------- Utilizadores e cursos (administrador) ---------- */
const US = { lista: null, cursos: [], papeis: {} };
async function carregarUtilizadores() {
  const r = await api('utilizadores');
  Object.assign(US, { lista: r.utilizadores, cursos: r.cursos, papeis: r.papeis });
}
function viewUtilizadores() {
  if (!S.eu.admin) return '<p>Só o administrador tem acesso a esta página.</p>';
  if (!US.lista) { carregarUtilizadores().then(render).catch((err) => toast(err.message, true)); return '<p class="sub">A carregar…</p>'; }
  const nomeCurso = Object.fromEntries(US.cursos.map((c) => [c.id, c.nome]));
  return `<div class="page-head"><div><h1>👥 Utilizadores e cursos</h1>
      <div class="sub">Os diretores de curso só veem os alunos (e afetações, protocolos, entrevistas, planos, reuniões, tarefas) dos seus cursos.
        Empresas, pessoas de contacto, professores e contactos são partilhados por todos.</div></div>
      <div class="actions"><button class="btn primary" id="u-novo">➕ Novo utilizador</button></div></div>
    <div class="panel"><h2>Utilizadores</h2>
      <table><thead><tr><th>Nome</th><th>Utilizador</th><th>Papel</th><th>Cursos</th><th>Último acesso</th><th>Estado</th></tr></thead>
      <tbody>${US.lista.map((u) => `<tr class="click" data-u="${u.id}">
        <td><b>${esc(u.nome)}</b>${u.id === S.eu.id ? ' <span class="badge info">eu</span>' : ''}</td><td>${esc(u.login)}</td>
        <td>${esc(US.papeis[u.papel] || u.papel)}</td><td>${u.cursos.map((c) => esc(nomeCurso[c] || '')).join('<br>') || '<span class="sub">—</span>'}</td>
        <td>${fmtDateTime(u.ultimo_acesso)}</td><td>${u.ativo ? badge('Ativo') : '<span class="badge bad">Desativado</span>'}</td></tr>`).join('')}</tbody></table></div>
    <div class="panel"><div class="section-head"><h2>Cursos</h2><button class="btn small" id="c-novo">➕ Novo curso</button></div>
      <p class="sub">Pode criar um curso por turma/ciclo (ex.: «TGPSI 2024-2027»). O nome aparece no plano de estágio e pode ser alterado em Definições.</p>
      <table><thead><tr><th>Curso</th><th>Alunos</th><th>Diretores</th><th></th></tr></thead>
      <tbody>${US.cursos.map((c) => `<tr><td><b>${esc(c.nome)}</b></td><td>${c.alunos}</td>
        <td>${US.lista.filter((u) => u.cursos.includes(c.id)).map((u) => esc(u.nome)).join(', ') || '<span class="sub">—</span>'}</td>
        <td class="actions"><button class="btn small" data-c-ren="${c.id}">Mudar nome</button>
          ${+c.registos ? '' : `<button class="btn small danger" data-c-del="${c.id}">Apagar</button>`}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">Ainda não há cursos.</td></tr>'}</tbody></table></div>`;
}
function formUtilizador(u) {
  const novo = !u;
  u ||= { nome: '', login: '', papel: 'diretor', ativo: 1, cursos: S.curso_id ? [S.curso_id] : [] };
  dlg.innerHTML = `<form method="dialog"><h2>${novo ? 'Novo utilizador' : 'Editar utilizador'}</h2>
    <div class="form-grid">
      <label><span>Nome <span class="req">*</span></span><input name="nome" value="${esc(u.nome)}" required></label>
      <label><span>Utilizador (email ou nome sem espaços) <span class="req">*</span></span><input name="login" value="${esc(u.login)}" required autocomplete="off"></label>
      <label><span>Papel</span><select name="papel">${Object.entries(US.papeis).map(([k, l]) => `<option value="${k}" ${k === u.papel ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label><span>${novo ? 'Palavra-passe <span class="req">*</span>' : 'Nova palavra-passe <span class="sub">(vazio = manter)</span>'}</span>
        <input name="password" type="password" minlength="8" ${novo ? 'required' : ''} autocomplete="new-password"></label>
      <label class="wide"><span>Cursos <span class="sub">— diretor(a) de curso destes cursos (o administrador vê todos; os que marcar aqui são os cursos de que também é diretor)</span></span>
        <div class="checks">${US.cursos.map((c) => `<label class="check"><input type="checkbox" name="cursos" value="${c.id}" ${u.cursos.includes(c.id) ? 'checked' : ''}> ${esc(c.nome)}</label>`).join('') || '<span class="sub">Crie primeiro um curso.</span>'}</div></label>
      <label class="check wide"><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''}> Conta ativa (pode entrar na aplicação)</label>
    </div>
    <p class="erro" id="form-err"></p>
    <div class="dlg-actions">${novo || u.id === S.eu.id ? '' : '<button type="button" class="btn danger" id="u-del" style="margin-right:auto">Apagar</button>'}
      <button type="button" class="btn" id="dlg-cancel">Cancelar</button><button type="submit" class="btn primary">Guardar</button></div></form>`;
  const form = $('form', dlg);
  $('#dlg-cancel', dlg).onclick = () => dlg.close();
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const body = { id: u.id || 0, nome: fd.get('nome'), login: fd.get('login'), papel: fd.get('papel'), password: fd.get('password'),
      ativo: fd.get('ativo') ? 1 : 0, cursos: fd.getAll('cursos').map(Number) };
    try { await api('utilizador_guardar', { body }); dlg.close(); await carregarUtilizadores(); await reload(); renderWho(); render(); toast('Utilizador guardado.'); }
    catch (err) { $('#form-err', dlg).textContent = err.message; }
  };
  const del = $('#u-del', dlg);
  if (del) del.onclick = async () => {
    if (!confirm(`Apagar a conta de «${u.nome}»? Os contactos que registou ficam na aplicação. (Em alternativa, pode só desativar a conta.)`)) return;
    try { await api('utilizador_apagar', { id: u.id, body: {} }); dlg.close(); await carregarUtilizadores(); render(); toast('Utilizador apagado.'); }
    catch (err) { $('#form-err', dlg).textContent = err.message; }
  };
  dlg.showModal();
}
function bindUtilizadores() {
  if (!S.eu.admin || !US.lista) return;
  $('#u-novo').onclick = () => formUtilizador(null);
  $$('[data-u]').forEach((tr) => (tr.onclick = () => formUtilizador(US.lista.find((u) => u.id === +tr.dataset.u))));
  const depois = async (msg) => { dlg.close(); await carregarUtilizadores(); await reload(); renderWho(); render(); toast(msg); };
  $('#c-novo').onclick = () => formCurso(null, depois);
  $$('[data-c-ren]').forEach((b) => (b.onclick = () => formCurso(US.cursos.find((c) => c.id === +b.dataset.cRen), depois)));
  $$('[data-c-del]').forEach((b) => (b.onclick = () => {
    const c = US.cursos.find((x) => x.id === +b.dataset.cDel);
    dlg.innerHTML = `<form method="dialog" class="dlg-small"><h2>Apagar curso</h2>
      <p>Apagar o curso <b>${esc(c?.nome || '')}</b>? Não tem dados associados.</p>
      <p class="erro" id="form-err"></p>
      <div class="dlg-actions"><button type="button" class="btn" id="dlg-cancel">Cancelar</button>
        <button type="submit" class="btn danger">Apagar</button></div></form>`;
    $('#dlg-cancel', dlg).onclick = () => dlg.close();
    $('form', dlg).onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api('curso_apagar', { id: c.id, body: {} }); await depois('Curso apagado.'); }
      catch (err) { $('#form-err', dlg).textContent = err.message; }
    };
    dlg.showModal();
  }));
}

/** Painel (com o fundo escurecido) para criar um curso ou mudar-lhe o nome. */
function formCurso(c, depois) {
  dlg.innerHTML = `<form method="dialog" class="dlg-small"><h2>${c ? 'Mudar nome do curso' : 'Novo curso'}</h2>
    <label><span>Nome do curso <span class="req">*</span></span>
      <input name="nome" value="${esc(c?.nome || '')}" required placeholder="ex.: Técnico de Gestão e Programação de Sistemas Informáticos"></label>
    ${c ? '' : '<p class="sub">Os textos do plano de estágio (objetivos, horário, durações) começam iguais aos do curso ativo e podem ser alterados em Definições.</p>'}
    <p class="erro" id="form-err"></p>
    <div class="dlg-actions"><button type="button" class="btn" id="dlg-cancel">Cancelar</button>
      <button type="submit" class="btn primary">${c ? 'Guardar' : 'Criar curso'}</button></div></form>`;
  const form = $('form', dlg);
  $('#dlg-cancel', dlg).onclick = () => dlg.close();
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api('curso_guardar', { body: { id: c?.id || 0, nome: form.nome.value } }); await depois(c ? 'Nome do curso alterado.' : 'Curso criado.'); }
    catch (err) { $('#form-err', dlg).textContent = err.message; }
  };
  dlg.showModal();
  form.nome.focus();
  form.nome.select();
}

async function start() {
  await reload();
  US.lista = null; // outra sessão: voltar a pedir a lista de utilizadores
  $('#login').hidden = true;
  $('#app').hidden = false;
  renderWho();
  render();
  // lembrete diário por email (o servidor só envia se estiver ativo e ainda não tiver enviado hoje)
  if (S.perfil.lembretes_ativos === 'Sim') api('lembretes_auto', { body: {} }).catch(() => {});
}

async function boot() {
  try {
    S.schema = await (await fetch('schema.json', { cache: 'no-cache' })).json();
    // relações pai → filhos (para a vista de detalhe e avisos ao apagar)
    S.schema.children = {};
    for (const [name, e] of Object.entries(S.schema.entities)) {
      for (const f of e.fields) if (f.type === 'ref') (S.schema.children[f.ref] ||= []).push({ entity: name, field: f.name });
    }
    const me = await api('me');
    if (me.auth) await start();
    else showLogin(me.setup);
  } catch (err) {
    document.body.innerHTML = `<div class="login"><div class="login-box"><h1>Erro</h1><p>${esc(err.message)}</p></div></div>`;
  }
}

const setMenu = (open) => { $('.sidebar').classList.toggle('open', open); $('#menu-toggle').setAttribute('aria-expanded', String(open)); };
$('#menu-toggle').onclick = () => setMenu(!$('.sidebar').classList.contains('open'));
window.addEventListener('hashchange', () => { setMenu(false); if (!$('#app').hidden) render(); });
$('#logout').onclick = async () => { await api('logout', { body: {} }); showLogin(false); };
boot();
