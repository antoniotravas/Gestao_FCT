## Aplicação paar gerie formação em contexto de trabalho

## Atividade do professor diretor de curso

    As atividade de um professor em relação aos estágios / FCT são:

        Contactos com empresa que possam acolher os alunos em formação em contexto de trabalho
        Registo de conatctos efectuado, decisões e estado do contacto
        Envio de protocolos de formação 
        Reuniões de avaliação
        Definição de actividades que o formando irá desenvolver 
        Afetação de alunos a empresas
        Marcação de entrevistas
        (Marcação de assiduidade — RETIRADA a pedido do utilizador em 2026-11-04: não quer marcar faltas)

## tecnologias

    Para ser implementado em versão web e rdesign moderno e responsivo
    Usa as tuas skills de front end
    A linguagem de progração pode ser php no backend porque o server admite e também msql para os dados
    A migaração para o server poder ser em ssh
- Importar empresas (botão na lista Empresas → `#/importar/empresas`, `imp.soEmpresas`): sinónimos genéricos `aliases_lote` no schema (e prefixo «Entidade -»), Excel com CSV colado na coluna A (`csvNaColunaA`), vírgulas sem aspas juntas ao nome, Status→estado (`estado_empresa_lote`), Contacto→Pessoas, associação por nome/NIF/email, opção «só preencher vazios» (`so_vazios`). Testado com `Empresas Contactadas.xlsx` e `Empresas.xlsx`.
- Importação em lote: `assets/import.js` (lê .xlsx/.csv no browser, sem bibliotecas) + `lib/importar.php` (correspondência e criação/atualização). Alunos têm `ano_letivo`; listas e painel filtram pelo ano letivo ativo.
- 2026/2027: importados alunos, EE e empresas de `DadosPlanosEstágio.xlsx`; afetações ainda NÃO importadas (decisão do utilizador).
- Protocolos (desde 2026-11-04): a app NÃO gera protocolos nem os envia por email. O protocolo vem de outra aplicação; um ficheiro por FASE (Sem assinaturas / Assinado por uma parte / Assinado por ambas as partes) na tabela `protocolo_ficheiros` (fora do schema.json; migração no db()); fase 3 → estado «Assinado». Ações `protocolo_carregar&fase=n|protocolo_ficheiro&f=|protocolo_remover&f=`, ficheiros em `data/protocolos/`.
- Pessoas de contacto por empresa (entidade `pessoas`, campo `tutor` Sim/Não) — escolhidas como tutor no formulário da afetação (FORM_HOOKS.colocacoes).
- Professor acompanhante vazio → plano usa o diretor de curso com dados do perfil (`diretor_curso`, `email_diretor`, `telefone_diretor`).
- Professores acompanhantes: entidade `professores` (menu «Professores»). `professoresLista()` em app.js = utilizador/diretor (perfil) primeiro + lista; seletor `#prof-pick` no formulário da afetação (afetação nova vem preenchida com o diretor) e `#plano-prof` na página do plano (opção «none» = limpar → diretor).
- Logótipos: originais em `modelos/plano/`, substitutos em `data/logos/` (ações `logo`, `logo_carregar`, `logo_repor`). Capa do plano com logótipos e curso.
- Exportação: `assets/xlsx.js` (Excel sem bibliotecas, usa `zip` de plano.js); página `#/listagem` (listagem breve) e «Exportar todas as tabelas». `modelos/protocolo.html` (Mod. P058) ficou sem uso.
- Plano de estágio: modelo = `Plano_Andreo.pdf`; gerado em .docx no browser por `assets/plano.js` (ZIP+WordprocessingML sem bibliotecas), logótipos em `modelos/plano/`. Conteúdo variável por afetação na entidade `planos` (oculta); atividades do roteiro = entidade `atividades` (campos `mes`, `observacoes`); textos por omissão em Definições → «Curso (plano de estágio)». Testar com Word: converter para PDF e ver as 12 páginas.
- Lembretes por email SÓ para o próprio professor (perfil em Definições: `email_diretor`, `lembretes_*`, `smtp_*`): `lib/lembretes.php`; tarefas na entidade `tarefas`; envio 1×/dia ao abrir a app ou via cron `php api.php lembretes`.
- Contactos: o utilizador NÃO quer que a app envie emails (usa o seu programa de email); a app só regista contactos, o que foi acordado, resultado e pendentes (campo `pendente` + `proximo_passo` + `data_followup`). Página «Pendentes» em `#/pendentes`.
- Ficha da empresa para conferência: rota `#/ficha/<id>` (PDF via impressão do browser, TXT via download) — o utilizador envia-a pelo seu email.
- Utilizadores (desde 2026-11-05): tabelas `utilizadores` (papel admin|diretor, login = email ou nome), `cursos`, `utilizador_cursos`; migração automática em `migrar_utilizadores()` (instalação antiga → admin + curso 1). Entidades com `"scope": "curso"` no schema têm `curso_id` e são filtradas pelo curso ativo (sessão; o admin vê todos e muda no seletor da barra lateral). Empresas, pessoas, professores e contactos são partilhados; contactos guardam `utilizador_id` e os «Pendentes» são só os do próprio. Definições: `u<id>:chave` (perfil/lembretes), `c<id>:chave` (textos do plano por curso; `curso` = cursos.nome), restantes globais (escola, SMTP — só admin). Página `#/utilizadores` (só admin). Documentos usam `S.diretor` (diretor do curso ativo).
- Afetação: no formulário, alunos com qualquer afetação (exceto «Interrompida», sem olhar ao ano letivo) não aparecem. Campos ref com >12 opções usam pesquisa (`comboRef`). Afetação nova: `horas_previstas` = Definições `horas_fct` do curso (ou 300).
- Telemóvel: listas com cartões resumidos em `CARTAO_M` (afetações: aluno+empresa; alunos: nome, telefone, email). Ao mudar .js/.css, subir o `?v=` em index.html e nos imports.
- Lista de alunos (computador): processo, nome, turma, curso, email, telefone + coluna «Empresa» (afetação não interrompida, máx. 50 caracteres; `afetacaoDe`, `listOpts`); linha com fundo lima (`tr.afeto`) se já afeto.
- Alunos: botão «Importar alunos» → `#/importar/alunos` (imp.modo='alunos') com «Descarregar modelo Excel» (cabeçalhos = rótulos dos campos, reconhecidos por `autoMap(..., {soAlunos})`).
