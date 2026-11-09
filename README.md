# Gestão FCT

Aplicação web para o diretor de curso gerir a Formação em Contexto de Trabalho:
empresas, contactos, protocolos (documento carregado de outra aplicação), entrevistas, afetações de alunos,
plano de estágio em Word, tarefas com lembretes por email e reuniões de avaliação.

**Requisitos:** PHP 8.1 ou superior com a extensão `pdo_sqlite` (vem ativa na maioria dos alojamentos).
Não precisa de MySQL nem de instalar nada.

## Instalar no alojamento

1. Envie por FTP todos os ficheiros para uma pasta do alojamento (ex.: `public_html/fct/`).
2. Garanta que a pasta `data/` tem permissão de escrita para o PHP (normalmente 755 ou 775).
   Os ficheiros dos protocolos ficam em `data/protocolos/` (criada automaticamente, sem acesso direto).
3. Abra o endereço no browser (ex.: `https://oseusite.pt/fct/`).
4. Na primeira visita é pedida a criação da palavra-passe de acesso.
5. Em **Definições**, preencha os dados da escola, do curso e o ano letivo.

> **Importante (proteção de dados dos alunos):**
> - Use sempre **https**.
> - Em servidores Apache, os ficheiros `.htaccess` bloqueiam o acesso direto à base de dados.
>   Confirme abrindo `https://oseusite.pt/fct/data/fct.sqlite`: deve aparecer **403 Forbidden**.
> - Se o servidor for nginx (ou se o teste acima descarregar o ficheiro), copie
>   `config.sample.php` para `config.php` e coloque a base de dados fora da pasta pública.
> - Faça cópias de segurança regulares em **Definições → Descarregar cópia**.

## Testar no computador

```
php -S 127.0.0.1:8000
```
e abrir http://127.0.0.1:8000

## Funcionalidades

| Atividade do diretor de curso | Onde |
|---|---|
| Contactos com empresas, registo de decisões e estado | Empresas · Contactos (com data de seguimento) |
| Protocolos | Protocolos → um ficheiro por fase (sem assinaturas · assinado por uma parte · por ambas) |
| Pessoas de contacto / tutores | Ficha da empresa → *Pessoas de contacto*; escolhem-se como tutor na afetação |
| Listagem e exportação | *Listagem breve* (aluno, contacto, empresa, tutor, contacto) · Excel de todas as tabelas |
| Marcação de entrevistas | Entrevistas |
| Afetação de alunos a empresas | Afetações (tutor, datas, horas previstas) |
| Definição de atividades do formando | Plano de atividades (ligado à afetação) |
| Plano de estágio | Afetação → *📘 Plano de estágio* (documento Word com o modelo da escola) |
| Tarefas e lembretes | Tarefas · lembretes diários por email (Definições → O meu perfil) |
| Reuniões de avaliação | Reuniões de avaliação (tipo, ata, classificação) |

### Contactos com empresas

- Na **ficha da empresa**: estado (muda-se diretamente), último contacto, pendentes e o **histórico** de
  todos os contactos. «📝 Registar contacto» abre o registo: o que foi falado, **o que foi acordado**,
  resultado e **o que fica pendente** (aguardo resposta / tenho de enviar ou fazer algo / a empresa vai
  enviar algo), com prazo (atalhos +3 dias, +1 semana…).
- Ao registar um contacto, a aplicação propõe atualizar o estado da empresa (ex.: resultado «Aceite» → «Parceira»).
- **📌 Pendentes**: tudo o que está à espera, por prazo (atrasados, hoje, próximos 7 dias…), com
  «✓ Resolvido», «+1 semana» e «Novo contacto» (o novo contacto resolve o pendente anterior).
  Mostra também empresas por contactar e empresas «Em contacto» sem novidades há mais de 30 dias.
  O número no menu indica pendentes para hoje ou atrasados.
- Lista de empresas com último contacto e próximo pendente; vista **quadro** por estado.
- A aplicação não envia emails — serve para registar o que acontece.

### Importação em lote (Excel / CSV)

Em **Importar** carregue um ficheiro `.xlsx` ou `.csv` com uma linha por aluno (como o `DadosPlanosEstágio.xlsx`).

- As colunas são reconhecidas automaticamente (lista de nomes alternativos em `aliases` no `schema.json`);
  pode alterar a correspondência e ela fica memorizada no browser para o ano seguinte.
- Escolha o que importar: **alunos + EE**, **empresas** e/ou **afetações** (tutor, professor acompanhante).
- Use sempre **Pré-visualizar** primeiro: mostra quantos registos são novos/atualizados e avisos
  (NIF inválido ou repetido, dados diferentes da mesma empresa em linhas distintas, datas inválidas…).
- Reimportar não duplica: alunos são reconhecidos pelo nº de processo, empresas pelo nome (ou NIF válido).
  Valores do ficheiro atualizam os existentes; as notas são acrescentadas.
- Cada importação marca os alunos com o **ano letivo** indicado. As listas e o painel mostram por omissão
  o ano letivo definido em Definições — no ano seguinte basta mudar o ano e importar os novos alunos;
  as empresas mantêm-se.

Também pela linha de comandos: `php api.php importar dados.json` (formato descrito em `lib/importar.php`).

O **Painel** mostra entrevistas e reuniões dos próximos 14 dias, contactos com seguimento
pendente, tarefas, alunos sem empresa, protocolos por assinar e os estágios em curso.
Todas as listas têm pesquisa, filtro por estado e exportação para CSV (Excel).

### Protocolos

O protocolo é feito noutra aplicação e passa por três fases: **sem assinaturas**, **assinado por uma parte**
e **assinado por ambas as partes**. Na ficha do protocolo há um espaço para cada fase: carregar (arrastar ou
clicar; PDF, Word, ODT ou imagem até 25 MB), **abrir**, **descarregar**, **substituir** ou **remover**.
Ao carregar o assinado por ambas as partes, o estado passa a «Assinado» (e a data de assinatura, se vazia, fica a de hoje).
A lista de protocolos mostra a fase mais avançada. A aplicação não envia protocolos por email.
Os ficheiros não vão na cópia JSON — guarde também a pasta `data/protocolos/`.

### Pessoas de contacto e tutores

Cada empresa pode ter várias **pessoas de contacto** (nome, cargo, telefone, email, «pode ser tutor»).
No formulário da afetação, «Escolher tutor entre as pessoas de contacto da empresa» preenche nome, cargo,
telefone e email do tutor.

### Ficha da empresa para conferência

Na ficha da empresa, **📄 Ficha para conferência** abre um documento A4 com os logótipos, os dados da empresa,
as pessoas de contacto (e, opcionalmente, os estagiários do ano), com uma coluna «Correção» e espaço para observações.
**🖨️ Imprimir / PDF** (escolher «Guardar como PDF») ou **⬇️ TXT**. Os campos vazios aparecem como «em falta».
Envie-a pelo seu programa de email — a aplicação não envia emails a empresas.

### Listagem breve e exportação

**📋 Listagem breve**: uma linha por aluno do ano letivo — contacto do aluno, empresa, tutor e contacto do tutor
(e professor acompanhante), com pesquisa, impressão e Excel. **📊 Exportar todas as tabelas** (aqui ou em Definições)
gera um Excel com a listagem breve e uma folha por tabela. Cada lista tem também o botão «⬇️ Excel».

### Plano de estágio (Word)

Na ficha da afetação, **📘 Plano de estágio** gera um `.docx` com o modelo da escola (`Plano_Andreo.pdf`):
capa, identificação (aluno, representante legal, professor acompanhante, empresa, tutor), roteiro
(área, durações, período, horário, objetivos), programa de atividades e assinaturas, ficha de assiduidade
em branco, sumários, ficha de avaliação final e observações — com os logótipos no cabeçalho
(`modelos/plano/`). Para PDF, abra no Word e *Guardar como → PDF*.

- **Dados**: aluno, empresa e afetação (tutor, professor, datas, horário) + Definições → *Curso (plano de estágio)*.
  A página avisa dos campos em falta, com ligação para os completar.
- **Conteúdo variável** (por plano): horário, data do documento, objetivos gerais e específicos (um por
  linha; por omissão os das Definições) e uma secção 6.5 «Informação adicional» opcional.
- **Atividades** do roteiro: «Plano de atividades» da afetação (atividade, mês, observações).
- Pode escolher as secções a incluir e o nº de linhas das fichas em branco.
- **Capa**: logótipos, escola, curso, duração, ano letivo e um quadro com aluno, nº, turma, entidade, professor e período.
- **Sem professor acompanhante** na afetação, o plano usa o diretor de curso com os dados do perfil (nome, email, telemóvel).
- **🧑‍🏫 Professores** (menu): lista de professores acompanhantes do curso (nome, email, telemóvel, grupo). Numa afetação nova o professor vem preenchido com os seus dados (diretor de curso); pode escolher outro da lista no formulário da afetação ou diretamente na página do plano.
- **Logótipos**: Definições → *Logótipos dos documentos* (mudar imagem JPG/PNG ou repor o original);
  as imagens carregadas ficam em `data/logos/`.
- Se o aluno não tiver encarregado de educação, o representante legal é o próprio aluno (maior de idade).

### Tarefas e lembretes por email

Em **Tarefas** registe o que tem de fazer (prazo, empresa/aluno opcionais). Em **Definições → O meu perfil**
indique o seu email, ative os lembretes e (recomendado) o servidor SMTP — ex.: Gmail com palavra-passe de
aplicação. O email diário traz as tarefas, os pendentes com empresas, as entrevistas e as reuniões até N
dias. É enviado só para si, uma vez por dia: ao abrir a aplicação ou, melhor, por uma tarefa cron diária:
`php /caminho/para/api.php lembretes`. O botão «Enviar email de teste» envia logo.

## Estrutura

- `schema.json` — define as entidades e campos. Acrescentar um campo aqui cria a coluna
  na base de dados automaticamente e mostra-o nos formulários.
- `api.php` — API JSON (autenticação, gravação, ficheiros dos protocolos, perfil, importação, exportação).
- `lib/lembretes.php` — lembretes por email (SMTP sem bibliotecas ou `mail()`).
- `assets/plano.js` — geração do plano de estágio em .docx no browser; `modelos/plano/` — logótipos originais.
- `assets/xlsx.js` — exportação para Excel (.xlsx) no browser.
- `lib/importar.php` — regras da importação em lote; `assets/import.js` — leitura de .xlsx/.csv no browser.
- `index.html`, `assets/` — interface (JavaScript sem dependências).
- `modelos/protocolo.html` — modelo antigo do protocolo (P058), já não usado pela aplicação.
- `data/` — base de dados SQLite (criada automaticamente).

### Importar empresas
Na página **Empresas → 📥 Importar** carregue uma lista de empresas (.xlsx ou .csv, uma linha por empresa). As colunas (Empresa/Designação social, NIF/NIPC, Status, Contacto, Email, Telefone, Morada, Cód. Postal, Representante…) são reconhecidas automaticamente. O «Status» passa a estado (Aceite → Parceira, Contactada/Documentos enviados → Em contacto, Não aceitou → Sem disponibilidade); cada contacto fica também em «Pessoas de contacto». Empresas já existentes são reconhecidas pelo nome, NIF ou email e, por omissão, só se preenchem os campos vazios. Use primeiro **Pré-visualizar** para ver avisos.

## Atualizar o servidor a partir do GitHub

A pasta da aplicação no servidor é um clone deste repositório (só leitura, por HTTPS). Depois de `git push`:

```bash
ssh utilizador@servidor "cd ~/domains/<domínio>/public_html && git pull --ff-only"
```

`config.php`, as bases de dados (`data/*.sqlite`), `data/protocolos/` e `data/logos/` estão no `.gitignore`
e nunca são alterados pelo `git pull`. Se alguém tiver mudado ficheiros diretamente no servidor, o `git pull`
pára e avisa (ver com `git status`) em vez de os apagar. A pasta `.git` está bloqueada no `.htaccess`.
