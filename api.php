<?php
/**
 * API da aplicação de gestão da FCT.
 * Todas as respostas são JSON. Pedidos: api.php?a=<ação>&e=<entidade>&id=<id>
 */
declare(strict_types=1);

$config = ['db_path' => __DIR__ . '/data/fct.sqlite'];
if (is_file(__DIR__ . '/config.php')) {
    $config = array_merge($config, require __DIR__ . '/config.php');
}

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

if (PHP_SAPI !== 'cli') {
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Strict',
        'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    ]);
    session_name('FCTSESS');
    session_start();
}

function out($data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(string $msg, int $code = 400): never { out(['erro' => $msg], $code); }

set_exception_handler(function (Throwable $e) {
    error_log((string)$e);
    $m = $e->getMessage();
    $msg = match (true) {
        str_contains($m, 'UNIQUE')      => 'Já existe um registo com esses dados.',
        str_contains($m, 'FOREIGN KEY') => 'O registo associado (empresa, aluno ou afetação) não existe.',
        default                         => 'Erro interno: ' . $m,
    };
    fail($msg, 500);
});

$schema   = json_decode(file_get_contents(__DIR__ . '/schema.json'), true, 512, JSON_THROW_ON_ERROR);
$entities = $schema['entities'];

/* ---------- Base de dados ---------- */
function db(): PDO {
    static $pdo = null;
    global $config, $entities;
    if ($pdo) return $pdo;

    $dir = dirname($config['db_path']);
    if (!is_dir($dir)) mkdir($dir, 0770, true);
    $pdo = new PDO('sqlite:' . $config['db_path'], null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    $pdo->exec('CREATE TABLE IF NOT EXISTS definicoes (chave TEXT PRIMARY KEY, valor TEXT)');

    // Cria tabelas e acrescenta colunas novas (migração automática a partir do schema.json)
    foreach ($entities as $name => $e) {
        $pdo->exec("CREATE TABLE IF NOT EXISTS $name (id INTEGER PRIMARY KEY AUTOINCREMENT,
                    criado_em TEXT DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT)");
        $existing = array_column($pdo->query("PRAGMA table_info($name)")->fetchAll(), 'name');
        foreach ($e['fields'] as $f) {
            if (in_array($f['name'], $existing, true)) continue;
            $type = match ($f['type']) {
                'number' => 'REAL',
                'ref'    => "INTEGER REFERENCES {$f['ref']}(id) ON DELETE CASCADE",
                default  => 'TEXT',
            };
            $pdo->exec("ALTER TABLE $name ADD COLUMN {$f['name']} $type");
        }
        if (!empty($e['unique'])) {
            $cols = implode(',', $e['unique']);
            $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_{$name} ON $name ($cols)");
        }
    }
    // Ficheiros dos protocolos: um por fase (o documento vem de outra aplicação)
    $pdo->exec('CREATE TABLE IF NOT EXISTS protocolo_ficheiros (id INTEGER PRIMARY KEY AUTOINCREMENT,
        protocolo_id INTEGER NOT NULL REFERENCES protocolos(id) ON DELETE CASCADE, fase TEXT NOT NULL,
        nome TEXT, guardado TEXT NOT NULL, tamanho INTEGER, carregado_em TEXT)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS ix_protocolo_ficheiros ON protocolo_ficheiros (protocolo_id)');
    // migração: versão anterior guardava um só ficheiro nas colunas ficheiro_* do protocolo
    $existing = array_column($pdo->query('PRAGMA table_info(protocolos)')->fetchAll(), 'name');
    if (in_array('ficheiro_guardado', $existing, true)) {
        $old = $pdo->query('SELECT id, estado, ficheiro_nome, ficheiro_guardado, ficheiro_tamanho, ficheiro_em
                            FROM protocolos WHERE ficheiro_guardado IS NOT NULL')->fetchAll();
        foreach ($old as $o) {
            $pdo->prepare('INSERT INTO protocolo_ficheiros (protocolo_id, fase, nome, guardado, tamanho, carregado_em) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$o['id'], $o['estado'] === 'Assinado' ? FASES_PROTOCOLO[2] : FASES_PROTOCOLO[0],
                           $o['ficheiro_nome'], $o['ficheiro_guardado'], (int)$o['ficheiro_tamanho'], $o['ficheiro_em']]);
            $pdo->prepare('UPDATE protocolos SET ficheiro_nome = NULL, ficheiro_guardado = NULL, ficheiro_tamanho = NULL, ficheiro_em = NULL
                           WHERE id = ?')->execute([$o['id']]);
        }
    }
    migrar_utilizadores($pdo);
    return $pdo;
}

/* ---------- Utilizadores, cursos e separação dos dados por curso ----------
 * utilizadores: papel «admin» (gere acessos, cursos, escola; vê todos os cursos) ou «diretor» (só os seus cursos).
 * utilizador_cursos: cursos de cada utilizador (para o admin: os cursos de que também é diretor).
 * Entidades com "scope": "curso" no schema.json têm a coluna curso_id; as restantes (empresas, pessoas,
 * professores, contactos) são partilhadas. Os contactos guardam quem os registou (utilizador_id).
 */
const PAPEIS = ['admin' => 'Administrador', 'diretor' => 'Diretor(a) de curso'];
$CTX = ['u' => 0, 'c' => 0, 'nome' => '', 'admin' => false]; // utilizador e curso ativos

function scoped(string $name): bool { global $entities; return ($entities[$name]['scope'] ?? '') === 'curso'; }

function migrar_utilizadores(PDO $pdo): void {
    global $entities;
    $pdo->exec('CREATE TABLE IF NOT EXISTS cursos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL,
        criado_em TEXT DEFAULT CURRENT_TIMESTAMP)');
    $pdo->exec("CREATE TABLE IF NOT EXISTS utilizadores (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL,
        login TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, papel TEXT NOT NULL DEFAULT 'diretor',
        ativo INTEGER NOT NULL DEFAULT 1, ultimo_acesso TEXT, criado_em TEXT DEFAULT CURRENT_TIMESTAMP)");
    $pdo->exec('CREATE TABLE IF NOT EXISTS utilizador_cursos (
        utilizador_id INTEGER NOT NULL REFERENCES utilizadores(id) ON DELETE CASCADE,
        curso_id INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE, PRIMARY KEY (utilizador_id, curso_id))');
    foreach ($entities as $name => $e) {
        if (!scoped($name)) continue;
        $cols = array_column($pdo->query("PRAGMA table_info($name)")->fetchAll(), 'name');
        if (!in_array('curso_id', $cols, true)) $pdo->exec("ALTER TABLE $name ADD COLUMN curso_id INTEGER REFERENCES cursos(id)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS ix_{$name}_curso ON $name (curso_id)");
    }
    $cols = array_column($pdo->query('PRAGMA table_info(contactos)')->fetchAll(), 'name');
    if (!in_array('utilizador_id', $cols, true)) {
        $pdo->exec('ALTER TABLE contactos ADD COLUMN utilizador_id INTEGER REFERENCES utilizadores(id) ON DELETE SET NULL');
    }

    // Instalação anterior (uma só palavra-passe): passa a ser o administrador e o curso n.º 1 recebe os dados existentes.
    $raw = function (string $k) use ($pdo) { $st = $pdo->prepare('SELECT valor FROM definicoes WHERE chave = ?'); $st->execute([$k]); return $st->fetchColumn() ?: null; };
    $hash = $raw('password_hash');
    if (!$hash || $pdo->query('SELECT COUNT(*) FROM utilizadores')->fetchColumn()) return;
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO cursos (nome) VALUES (?)')->execute([trim((string)$raw('curso')) ?: 'Curso']);
    $cid = (int)$pdo->lastInsertId();
    $email = trim((string)$raw('email_diretor'));
    $pdo->prepare("INSERT INTO utilizadores (nome, login, password_hash, papel) VALUES (?, ?, ?, 'admin')")
        ->execute([trim((string)$raw('diretor_curso')) ?: 'Administrador', filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : 'admin', $hash]);
    $uid = (int)$pdo->lastInsertId();
    $pdo->prepare('INSERT INTO utilizador_cursos (utilizador_id, curso_id) VALUES (?, ?)')->execute([$uid, $cid]);
    $mover = function (array $chaves, string $pref) use ($pdo) {
        foreach ($chaves as $k) $pdo->prepare('UPDATE definicoes SET chave = ? WHERE chave = ?')->execute([$pref . $k, $k]);
    };
    $mover(array_keys(chaves_utilizador()), "u$uid:");
    $mover(array_diff(array_keys(chaves_curso()), ['curso']), "c$cid:");
    $pdo->exec("DELETE FROM definicoes WHERE chave IN ('password_hash', 'curso', 'diretor_curso')");
    foreach ($entities as $name => $e) if (scoped($name)) $pdo->exec("UPDATE $name SET curso_id = $cid WHERE curso_id IS NULL");
    $pdo->exec("UPDATE contactos SET utilizador_id = $uid WHERE utilizador_id IS NULL");
    $pdo->commit();
}

/** Definições pessoais (perfil, lembretes) — guardadas como «u<id>:chave». */
function chaves_utilizador(): array {
    static $k = null;
    global $schema;
    if ($k === null) {
        $k = ['lembretes_ultimo' => true];
        foreach ($schema['perfil'] as $f) if (empty($f['admin'])) $k[$f['name']] = true;
    }
    return $k;
}
/** Definições de cada curso (textos do plano) — guardadas como «c<id>:chave»; «curso» é o nome na tabela cursos. */
function chaves_curso(): array {
    static $k = null;
    global $schema;
    if ($k === null) {
        $k = [];
        foreach ($schema['settings'] as $s) if (isset($s['name']) && ($s['scope'] ?? '') === 'curso') $k[$s['name']] = true;
    }
    return $k;
}
function chave(string $key): string {
    global $CTX;
    if (isset(chaves_utilizador()[$key])) return $CTX['u'] ? "u{$CTX['u']}:$key" : $key;
    if (isset(chaves_curso()[$key])) return $CTX['c'] ? "c{$CTX['c']}:$key" : $key;
    return $key;
}

function setting_raw(string $key): ?string {
    $st = db()->prepare('SELECT valor FROM definicoes WHERE chave = ?');
    $st->execute([$key]);
    $v = $st->fetchColumn();
    return $v === false ? null : $v;
}
function setting(string $key): ?string {
    global $CTX;
    if ($key === 'curso') {
        if (!$CTX['c']) return null;
        $st = db()->prepare('SELECT nome FROM cursos WHERE id = ?');
        $st->execute([$CTX['c']]);
        return $st->fetchColumn() ?: null;
    }
    return setting_raw(chave($key));
}
function set_setting(string $key, ?string $value): void {
    global $CTX;
    if ($key === 'curso') {
        if ($CTX['c'] && trim((string)$value) !== '') db()->prepare('UPDATE cursos SET nome = ? WHERE id = ?')->execute([trim($value), $CTX['c']]);
        return;
    }
    db()->prepare('INSERT INTO definicoes (chave, valor) VALUES (?, ?)
                   ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')->execute([chave($key), $value]);
}

/** Cursos ligados a um utilizador (para o admin sem cursos ligados, nos lembretes: todos). */
function cursos_ligados(int $uid): array {
    $st = db()->prepare('SELECT curso_id FROM utilizador_cursos WHERE utilizador_id = ?');
    $st->execute([$uid]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}
/** Cursos a que o utilizador tem acesso: o admin tem todos. */
function cursos_acessiveis(array $u): array {
    if ($u['papel'] === 'admin') return db()->query('SELECT id, nome FROM cursos ORDER BY nome')->fetchAll();
    $st = db()->prepare('SELECT c.id, c.nome FROM cursos c JOIN utilizador_cursos uc ON uc.curso_id = c.id
                         WHERE uc.utilizador_id = ? ORDER BY c.nome');
    $st->execute([$u['id']]);
    return $st->fetchAll();
}
/** Diretor(a) do curso ativo, para os documentos: o próprio utilizador se estiver ligado ao curso, senão o 1.º diretor. */
function diretor_do_curso(): array {
    global $CTX;
    $st = db()->prepare("SELECT u.id, u.nome FROM utilizadores u JOIN utilizador_cursos uc ON uc.utilizador_id = u.id
                         WHERE uc.curso_id = ? AND u.ativo = 1 ORDER BY (u.id = ?) DESC, (u.papel = 'diretor') DESC, u.id LIMIT 1");
    $st->execute([$CTX['c'], $CTX['u']]);
    $d = $st->fetch() ?: ['id' => $CTX['u'], 'nome' => $CTX['nome']];
    return ['diretor_curso' => $d['nome'], 'email_diretor' => setting_raw("u{$d['id']}:email_diretor") ?? '',
            'telefone_diretor' => setting_raw("u{$d['id']}:telefone_diretor") ?? ''];
}

require __DIR__ . '/lib/importar.php';
require __DIR__ . '/lib/lembretes.php';

/* ---------- Ficheiros dos protocolos (guardados junto à base de dados, sem acesso direto) ---------- */
const FASES_PROTOCOLO = ['Sem assinaturas', 'Assinado por uma parte', 'Assinado por ambas as partes'];
const FICHEIROS_PERMITIDOS = [
    'pdf' => 'application/pdf', 'doc' => 'application/msword',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'odt' => 'application/vnd.oasis.opendocument.text', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
];
function pasta_ficheiros(): string {
    global $config;
    $dir = dirname($config['db_path']) . '/protocolos';
    if (!is_dir($dir)) mkdir($dir, 0770, true);
    return $dir;
}
/** Apaga ficheiros que já não pertencem a nenhum protocolo (ex.: protocolo ou empresa apagados). */
function limpar_ficheiros_orfaos(): void {
    global $config;
    $dir = dirname($config['db_path']) . '/protocolos';
    if (!is_dir($dir)) return;
    $usados = array_flip(db()->query('SELECT guardado FROM protocolo_ficheiros')->fetchAll(PDO::FETCH_COLUMN));
    foreach (glob($dir . '/*') ?: [] as $f) if (!isset($usados[basename($f)])) @unlink($f);
}
/** Verifica um ficheiro enviado (campo «ficheiro») e devolve [extensão, nome original limpo]. */
function ficheiro_enviado(array $extensoes, int $maxMb): array {
    $f = $_FILES['ficheiro'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) {
        fail(match ($f['error'] ?? UPLOAD_ERR_NO_FILE) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'O ficheiro é demasiado grande para o servidor (limite ' . ini_get('upload_max_filesize') . ').',
            UPLOAD_ERR_NO_FILE => 'Escolha um ficheiro.',
            default => 'O envio do ficheiro falhou. Tente novamente.',
        });
    }
    if ($f['size'] > $maxMb * 1024 * 1024) fail("O ficheiro tem mais de $maxMb MB.");
    $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, $extensoes, true)) fail('Tipo de ficheiro não permitido (' . implode(', ', $extensoes) . ').');
    if ($ext === 'pdf' && file_get_contents($f['tmp_name'], false, null, 0, 5) !== '%PDF-') fail('O ficheiro não é um PDF válido.');
    if (in_array($ext, ['jpg', 'jpeg', 'png'], true) && !@getimagesize($f['tmp_name'])) fail('O ficheiro não é uma imagem válida.');
    return [$ext, preg_replace('/[\x00-\x1f\/\\\\]/', '_', basename(str_replace('\\', '/', $f['name'])))];
}

/* ---------- Logótipos dos documentos (os do modelo ficam em modelos/plano; os substitutos em data/logos) ---------- */
const LOGOS = ['escola' => 'Logótipo da escola', 'republica' => 'Logótipo República Portuguesa / Educação'];
function logo_personalizado(string $k): ?string {
    global $config;
    foreach (['jpg', 'png'] as $e) {
        $f = dirname($config['db_path']) . "/logos/$k.$e";
        if (is_file($f)) return $f;
    }
    return null;
}
function logos_info(): array {
    $r = [];
    foreach (LOGOS as $k => $label) {
        $f = logo_personalizado($k);
        $r[$k] = ['label' => $label, 'personalizado' => (bool)$f, 'v' => $f ? filemtime($f) : 0];
    }
    return $r;
}

function perfil_publico(): array {
    global $schema, $CTX;
    $p = ['diretor_curso' => $CTX['nome']];
    foreach ($schema['perfil'] as $f) {
        if (!empty($f['admin']) && !$CTX['admin']) continue; // SMTP: configuração do servidor, só o administrador
        $v = setting($f['name']) ?? '';
        $p[$f['name']] = !empty($f['secret']) ? ($v !== '' ? '********' : '') : $v;
    }
    return $p;
}

/* ---------- Linha de comandos (no servidor/computador, sem browser) ----------
 *   php api.php importar dados.json   -> importa um ficheiro JSON no formato do pedido «importar»
 */
if (PHP_SAPI === 'cli') {
    if (($argv[1] ?? '') === 'lembretes') { // para uma tarefa agendada (cron) no servidor: um email por utilizador
        $res = [];
        foreach (db()->query('SELECT id, nome, papel FROM utilizadores WHERE ativo = 1 ORDER BY id')->fetchAll() as $u) {
            $CTX = ['u' => (int)$u['id'], 'c' => 0, 'nome' => $u['nome'], 'admin' => $u['papel'] === 'admin'];
            try { $res[$u['nome']] = lembretes_enviar(); }
            catch (RuntimeException $e) { $res[$u['nome']] = ['enviado' => false, 'motivo' => $e->getMessage()]; }
        }
        echo json_encode($res, JSON_UNESCAPED_UNICODE), PHP_EOL;
        exit(0);
    }
    if (($argv[1] ?? '') !== 'importar' || !is_file($argv[2] ?? '')) {
        fwrite(STDERR, "Uso: php api.php importar ficheiro.json [id do curso]  |  php api.php lembretes
");
        exit(1);
    }
    $CTX['c'] = (int)($argv[3] ?? 0) ?: (int)db()->query('SELECT MIN(id) FROM cursos')->fetchColumn();
    $payload = json_decode(file_get_contents($argv[2]), true, 512, JSON_THROW_ON_ERROR);
    echo json_encode(importar($payload), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "
";
    exit(0);
}

/* ---------- Pedido ---------- */
$action = $_GET['a'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$body   = [];
if ($method === 'POST') {
    // Exigir cabeçalho próprio impede pedidos forjados a partir de outros sites (CSRF)
    if (($_SERVER['HTTP_X_FCT'] ?? '') !== '1') fail('Pedido inválido.', 403);
    $body = json_decode(file_get_contents('php://input') ?: '{}', true);
    if (!is_array($body)) fail('Dados inválidos (JSON mal formado).');
}

function entity(): array {
    global $entities;
    $name = $_GET['e'] ?? '';
    if (!isset($entities[$name])) fail('Entidade desconhecida.', 404);
    return [$name, $entities[$name]];
}

function clean_row(array $e, array $input): array {
    $row = [];
    foreach ($e['fields'] as $f) {
        if (!array_key_exists($f['name'], $input)) continue;
        $v = $input[$f['name']];
        if (is_string($v)) $v = trim($v);
        if ($v === '' || $v === null) $v = null;
        elseif ($f['type'] === 'number') {
            if (!is_numeric($v)) fail("O campo «{$f['label']}» tem de ser numérico.");
            $v = (float)$v;
        } elseif ($f['type'] === 'ref') $v = (int)$v;
        elseif ($f['type'] === 'select' && !in_array($v, $f['options'], true)) fail("Valor inválido em «{$f['label']}».");
        else $v = (string)$v;
        $row[$f['name']] = $v;
    }
    return $row;
}

function check_required(array $e, array $row, bool $isNew): void {
    foreach ($e['fields'] as $f) {
        if (empty($f['required'])) continue;
        if (($isNew || array_key_exists($f['name'], $row)) && ($row[$f['name']] ?? null) === null) {
            fail("O campo «{$f['label']}» é obrigatório.");
        }
    }
}

/** Um registo só pode apontar para alunos/afetações/... do curso ativo. */
function verificar_refs(array $e, array $row): void {
    global $CTX;
    foreach ($e['fields'] as $f) {
        if ($f['type'] !== 'ref' || !scoped($f['ref']) || ($row[$f['name']] ?? null) === null) continue;
        $st = db()->prepare("SELECT 1 FROM {$f['ref']} WHERE id = ? AND curso_id = ?");
        $st->execute([$row[$f['name']], $CTX['c']]);
        if (!$st->fetchColumn()) fail("«{$f['label']}»: o registo escolhido não pertence a este curso.");
    }
}

function save(string $name, array $e, array $input): array {
    $id  = isset($input['id']) ? (int)$input['id'] : 0;
    if (!$id) { // valores por defeito em registos novos
        foreach ($e['fields'] as $f) {
            if (!isset($f['default']) || ($input[$f['name']] ?? '') !== '') continue;
            $d = $f['default'];
            $input[$f['name']] = match (true) {
                $d === 'today'                => date('Y-m-d'),
                str_starts_with($d, 'setting:') => setting(substr($d, 8)),
                default                       => $d,
            };
        }
    }
    global $CTX;
    $row = clean_row($e, $input);
    check_required($e, $row, $id === 0);
    verificar_refs($e, $row);
    $pdo = db();
    $doCurso = scoped($name);
    if ($id) {
        if (!$row) fail('Nada para guardar.');
        $sets = implode(', ', array_map(fn($k) => "$k = :$k", array_keys($row)));
        $st = $pdo->prepare("UPDATE $name SET $sets, atualizado_em = CURRENT_TIMESTAMP WHERE id = :id"
            . ($doCurso ? ' AND curso_id = :curso__ativo' : ''));
        $st->execute($row + ['id' => $id] + ($doCurso ? ['curso__ativo' => $CTX['c']] : []));
        if (!$st->rowCount()) fail('Registo não encontrado.', 404);
    } else {
        if ($doCurso) {
            if (!$CTX['c']) fail('Ainda não há nenhum curso. O administrador tem de criar um em «Utilizadores».');
            $row['curso_id'] = $CTX['c'];
        }
        if ($name === 'contactos') $row['utilizador_id'] = $CTX['u']; // quem registou o contacto
        $cols = array_keys($row);
        $st = $pdo->prepare("INSERT INTO $name (" . implode(',', $cols) . ') VALUES (:' . implode(', :', $cols) . ')');
        $st->execute($row);
        $id = (int)$pdo->lastInsertId();
    }
    $st = $pdo->prepare("SELECT * FROM $name WHERE id = ?");
    $st->execute([$id]);
    return $st->fetch();
}

/* ---------- Ações públicas ---------- */
function utilizador_sessao(): ?array {
    $id = (int)($_SESSION['uid'] ?? 0);
    if (!$id) return null;
    $st = db()->prepare('SELECT id, nome, login, papel FROM utilizadores WHERE id = ? AND ativo = 1');
    $st->execute([$id]);
    $u = $st->fetch();
    if ($u) $u['id'] = (int)$u['id'];
    return $u ?: null;
}
function validar_login(string $login): string {
    $login = trim($login);
    if (!filter_var($login, FILTER_VALIDATE_EMAIL) && !preg_match('/^[\p{L}0-9._-]{3,40}$/u', $login)) {
        fail('O utilizador deve ser um email ou um nome sem espaços (mín. 3 caracteres).');
    }
    return $login;
}
function entrar(int $uid): void {
    session_regenerate_id(true);
    $_SESSION = ['uid' => $uid];
    db()->prepare("UPDATE utilizadores SET ultimo_acesso = ? WHERE id = ?")->execute([date('Y-m-d H:i'), $uid]);
}

switch ($action) {
    case 'me':
        out(['auth' => (bool)utilizador_sessao(), 'setup' => !db()->query('SELECT COUNT(*) FROM utilizadores')->fetchColumn()]);

    case 'setup': // primeira utilização: cria o administrador
        if ($method !== 'POST') fail('Método inválido.', 405);
        if (db()->query('SELECT COUNT(*) FROM utilizadores')->fetchColumn()) fail('A aplicação já está configurada.', 403);
        $nome = trim((string)($body['nome'] ?? ''));
        $login = validar_login((string)($body['login'] ?? ''));
        $pw = (string)($body['password'] ?? '');
        if ($nome === '') fail('Indique o seu nome.');
        if (mb_strlen($pw) < 8) fail('A palavra-passe deve ter pelo menos 8 caracteres.');
        db()->prepare("INSERT INTO utilizadores (nome, login, password_hash, papel) VALUES (?, ?, ?, 'admin')")
            ->execute([$nome, $login, password_hash($pw, PASSWORD_DEFAULT)]);
        entrar((int)db()->lastInsertId());
        out(['ok' => true]);

    case 'login':
        if ($method !== 'POST') fail('Método inválido.', 405);
        $st = db()->prepare('SELECT id, password_hash FROM utilizadores WHERE login = ? AND ativo = 1');
        $st->execute([trim((string)($body['login'] ?? ''))]);
        $u = $st->fetch();
        $pw = (string)($body['password'] ?? '');
        if (!$u || !password_verify($pw, $u['password_hash'])) {
            sleep(1); // abranda tentativas de adivinhar a palavra-passe
            fail('Utilizador ou palavra-passe incorretos.', 401);
        }
        if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
            db()->prepare('UPDATE utilizadores SET password_hash = ? WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), $u['id']]);
        }
        entrar((int)$u['id']);
        out(['ok' => true]);

    case 'logout':
        $_SESSION = [];
        session_destroy();
        out(['ok' => true]);
}

/* ---------- Ações autenticadas ---------- */
$U = utilizador_sessao() ?? fail('Sessão expirada. Inicie sessão novamente.', 401);
$ADMIN = $U['papel'] === 'admin';
$CURSOS = cursos_acessiveis($U);
$idsCursos = array_map('intval', array_column($CURSOS, 'id'));
if ($action === 'curso_ativo') { // escolher o curso em que se está a trabalhar
    if ($method !== 'POST') fail('Método inválido.', 405);
    $n = (int)($body['curso_id'] ?? 0);
    if (!in_array($n, $idsCursos, true)) fail('Não tem acesso a esse curso.', 403);
    $_SESSION['curso'] = $n;
    out(['ok' => true]);
}
$cid = (int)($_SESSION['curso'] ?? 0);
if (!in_array($cid, $idsCursos, true)) {
    $ligados = array_values(array_intersect(cursos_ligados($U['id']), $idsCursos));
    $cid = $ligados[0] ?? $idsCursos[0] ?? 0;
    $_SESSION['curso'] = $cid;
}
session_write_close(); // liberta o ficheiro de sessão para pedidos paralelos
$CTX = ['u' => $U['id'], 'c' => $cid, 'nome' => $U['nome'], 'admin' => $ADMIN];
function so_admin(): void { global $ADMIN; if (!$ADMIN) fail('Só o administrador pode fazer isto.', 403); }

switch ($action) {
    case 'all': // devolve os dados do curso ativo e os partilhados (empresas, pessoas, professores, contactos)
        $data = [];
        foreach ($entities as $name => $e) {
            $order = $e['order'] ?? 'id';
            if (scoped($name)) {
                $st = db()->prepare("SELECT * FROM $name WHERE curso_id = ? ORDER BY $order");
                $st->execute([$cid]);
                $data[$name] = $st->fetchAll();
            } else $data[$name] = db()->query("SELECT * FROM $name ORDER BY $order")->fetchAll();
        }
        $settings = [];
        foreach ($schema['settings'] as $s) if (isset($s['name'])) $settings[$s['name']] = setting($s['name']) ?? '';
        $st = db()->prepare('SELECT f.id, f.protocolo_id, f.fase, f.nome, f.tamanho, f.carregado_em, f.guardado FROM protocolo_ficheiros f
                             JOIN protocolos p ON p.id = f.protocolo_id WHERE p.curso_id = ? ORDER BY f.protocolo_id, f.id');
        $st->execute([$cid]);
        $data['protocolo_ficheiros'] = $st->fetchAll();
        out(['data' => $data, 'settings' => $settings, 'perfil' => perfil_publico(), 'diretor' => diretor_do_curso(),
             'logos' => logos_info(), 'fases' => FASES_PROTOCOLO,
             'eu' => ['id' => $U['id'], 'nome' => $U['nome'], 'login' => $U['login'], 'papel' => $U['papel'], 'admin' => $ADMIN],
             'cursos' => $CURSOS, 'curso_id' => $cid,
             'autores' => db()->query('SELECT id, nome FROM utilizadores')->fetchAll(PDO::FETCH_KEY_PAIR)]);

    case 'save':
        if ($method !== 'POST') fail('Método inválido.', 405);
        [$name, $e] = entity();
        out(save($name, $e, $body));

    case 'delete':
        if ($method !== 'POST') fail('Método inválido.', 405);
        [$name] = entity();
        $id = (int)($_GET['id'] ?? 0);
        if (scoped($name)) {
            db()->prepare("DELETE FROM $name WHERE id = ? AND curso_id = ?")->execute([$id, $cid]);
        } else {
            if (!$ADMIN) { // uma empresa usada noutros cursos só pode ser apagada pelo administrador
                foreach ($entities as $n => $e) {
                    if (!scoped($n)) continue;
                    foreach ($e['fields'] as $f) {
                        if ($f['type'] !== 'ref' || $f['ref'] !== $name) continue;
                        $st = db()->prepare("SELECT COUNT(*) FROM $n WHERE {$f['name']} = ? AND curso_id <> ?");
                        $st->execute([$id, $cid]);
                        if ($st->fetchColumn()) fail('Este registo é usado noutros cursos. Só o administrador o pode apagar.', 403);
                    }
                }
            }
            db()->prepare("DELETE FROM $name WHERE id = ?")->execute([$id]);
        }
        if (in_array($name, ['protocolos', 'empresas', 'alunos'], true)) limpar_ficheiros_orfaos();
        out(['ok' => true]);

    case 'settings': // escola e ano letivo: só o admin; textos do curso: quem trabalha no curso
        if ($method !== 'POST') fail('Método inválido.', 405);
        foreach ($schema['settings'] as $s) {
            if (!isset($s['name']) || !array_key_exists($s['name'], $body)) continue;
            $doCurso = ($s['scope'] ?? '') === 'curso';
            if ((!$doCurso && !$ADMIN) || ($doCurso && !$cid)) continue;
            set_setting($s['name'], trim((string)$body[$s['name']]));
        }
        out(['ok' => true]);

    case 'perfil': // perfil do utilizador e configuração dos lembretes por email
        if ($method !== 'POST') fail('Método inválido.', 405);
        if (trim((string)($body['diretor_curso'] ?? '')) !== '') {
            db()->prepare('UPDATE utilizadores SET nome = ? WHERE id = ?')->execute([trim($body['diretor_curso']), $U['id']]);
            $CTX['nome'] = trim($body['diretor_curso']);
        }
        foreach ($schema['perfil'] as $f) {
            if (!empty($f['admin']) && !$ADMIN) continue;
            if (!array_key_exists($f['name'], $body)) continue;
            $v = trim((string)$body[$f['name']]);
            if (!empty($f['secret']) && ($v === '********' || $v === '')) continue; // manter a palavra-passe guardada
            if (($f['type'] ?? '') === 'email' && $v !== '' && !filter_var($v, FILTER_VALIDATE_EMAIL)) fail("Email inválido em «{$f['label']}».");
            set_setting($f['name'], $v);
        }
        if (!empty($body['smtp_password_apagar'])) set_setting('smtp_password', null);
        out(['ok' => true, 'perfil' => perfil_publico()]);

    case 'lembretes_teste': // envia já, mesmo sem itens
        if ($method !== 'POST') fail('Método inválido.', 405);
        try { out(lembretes_enviar(true)); } catch (RuntimeException $e) { fail($e->getMessage()); }

    case 'lembretes_auto': // chamado quando a aplicação é aberta: envia no máximo uma vez por dia
        if ($method !== 'POST') fail('Método inválido.', 405);
        if (!empty($_SERVER['HTTP_HOST'])) {
            $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
            set_setting('app_url', ($https ? 'https://' : 'http://') . $_SERVER['HTTP_HOST']
                . rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/') . '/');
        }
        try { out(lembretes_enviar()); }
        catch (RuntimeException $e) { error_log($e->getMessage()); out(['enviado' => false, 'motivo' => $e->getMessage()]); }

    case 'protocolo_carregar': // multipart: «ficheiro» + ?id=protocolo&fase=n — substitui o ficheiro dessa fase
        if ($method !== 'POST') fail('Método inválido.', 405);
        $id = (int)($_GET['id'] ?? 0);
        $fase = FASES_PROTOCOLO[(int)($_GET['fase'] ?? -1)] ?? fail('Fase inválida.');
        $st = db()->prepare('SELECT * FROM protocolos WHERE id = ? AND curso_id = ?');
        $st->execute([$id, $cid]);
        $p = $st->fetch() ?: fail('Protocolo não encontrado.', 404);
        [$ext, $nome] = ficheiro_enviado(array_keys(FICHEIROS_PERMITIDOS), 25);
        $guardado = bin2hex(random_bytes(16)) . '.' . $ext;
        if (!move_uploaded_file($_FILES['ficheiro']['tmp_name'], pasta_ficheiros() . '/' . $guardado)) fail('Não foi possível guardar o ficheiro no servidor.', 500);
        $pdo = db();
        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM protocolo_ficheiros WHERE protocolo_id = ? AND fase = ?')->execute([$id, $fase]);
        $pdo->prepare('INSERT INTO protocolo_ficheiros (protocolo_id, fase, nome, guardado, tamanho, carregado_em) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$id, $fase, $nome, $guardado, (int)$_FILES['ficheiro']['size'], date('Y-m-d H:i')]);
        // protocolo assinado por ambas as partes → estado «Assinado» (e data de assinatura, se vazia)
        $estado = null;
        if ($fase === FASES_PROTOCOLO[2] && $p['estado'] !== 'Assinado') {
            $pdo->prepare("UPDATE protocolos SET estado = 'Assinado', data_assinatura = COALESCE(data_assinatura, ?),
                           atualizado_em = CURRENT_TIMESTAMP WHERE id = ?")->execute([date('Y-m-d'), $id]);
            $estado = 'Assinado';
        }
        $pdo->commit();
        limpar_ficheiros_orfaos(); // apaga o ficheiro anterior desta fase
        out(['ok' => true, 'estado' => $estado]);

    case 'protocolo_remover': // ?f=id do ficheiro
        if ($method !== 'POST') fail('Método inválido.', 405);
        db()->prepare('DELETE FROM protocolo_ficheiros WHERE id = ? AND protocolo_id IN (SELECT id FROM protocolos WHERE curso_id = ?)')
            ->execute([(int)($_GET['f'] ?? 0), $cid]);
        limpar_ficheiros_orfaos();
        out(['ok' => true]);

    case 'protocolo_ficheiro': // ?f=id do ficheiro — descarregar (ou abrir no browser com &ver=1)
        $st = db()->prepare('SELECT f.nome, f.guardado FROM protocolo_ficheiros f JOIN protocolos p ON p.id = f.protocolo_id
                             WHERE f.id = ? AND p.curso_id = ?');
        $st->execute([(int)($_GET['f'] ?? 0), $cid]);
        $p = $st->fetch();
        $path = $p ? pasta_ficheiros() . '/' . basename($p['guardado']) : '';
        if (!$path || !is_file($path)) fail('Ficheiro não encontrado.', 404);
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $nome = $p['nome'] ?: 'protocolo.' . $ext;
        $ascii = preg_replace('/[^A-Za-z0-9._-]+/', '_', (string)@iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $nome)) ?: 'protocolo.' . $ext;
        $modo = !empty($_GET['ver']) && in_array($ext, ['pdf', 'jpg', 'jpeg', 'png'], true) ? 'inline' : 'attachment';
        header('Content-Type: ' . FICHEIROS_PERMITIDOS[$ext]);
        header('Content-Length: ' . filesize($path));
        header("Content-Disposition: $modo; filename=\"$ascii\"; filename*=UTF-8''" . rawurlencode($nome));
        readfile($path);
        exit;

    case 'logo': // ?k=escola|republica — imagem atual (personalizada ou a do modelo)
        $k = (string)($_GET['k'] ?? '');
        if (!isset(LOGOS[$k])) fail('Logótipo desconhecido.', 404);
        $f = logo_personalizado($k) ?? __DIR__ . "/modelos/plano/logo-$k.jpg";
        if (!is_file($f)) fail('Logótipo não encontrado.', 404);
        header('Content-Type: ' . (str_ends_with($f, '.png') ? 'image/png' : 'image/jpeg'));
        header('Content-Length: ' . filesize($f));
        readfile($f);
        exit;

    case 'logo_carregar': // multipart «ficheiro» (JPG ou PNG) + ?k=
        if ($method !== 'POST') fail('Método inválido.', 405);
        so_admin();
        $k = (string)($_GET['k'] ?? '');
        if (!isset(LOGOS[$k])) fail('Logótipo desconhecido.', 404);
        [$ext] = ficheiro_enviado(['jpg', 'jpeg', 'png'], 5);
        $dir = dirname($config['db_path']) . '/logos';
        if (!is_dir($dir)) mkdir($dir, 0770, true);
        $old = logo_personalizado($k);
        $dest = "$dir/$k." . ($ext === 'png' ? 'png' : 'jpg');
        if ($old && $old !== $dest) @unlink($old);
        if (!move_uploaded_file($_FILES['ficheiro']['tmp_name'], $dest)) fail('Não foi possível guardar a imagem.', 500);
        out(['ok' => true, 'logos' => logos_info()]);

    case 'logo_repor': // volta ao logótipo do modelo
        if ($method !== 'POST') fail('Método inválido.', 405);
        so_admin();
        $k = (string)($_GET['k'] ?? '');
        if (!isset(LOGOS[$k])) fail('Logótipo desconhecido.', 404);
        if ($f = logo_personalizado($k)) @unlink($f);
        out(['ok' => true, 'logos' => logos_info()]);

    case 'password':
        if ($method !== 'POST') fail('Método inválido.', 405);
        $st = db()->prepare('SELECT password_hash FROM utilizadores WHERE id = ?');
        $st->execute([$U['id']]);
        if (!password_verify((string)($body['atual'] ?? ''), (string)$st->fetchColumn())) fail('Palavra-passe atual incorreta.');
        $pw = (string)($body['nova'] ?? '');
        if (mb_strlen($pw) < 8) fail('A nova palavra-passe deve ter pelo menos 8 caracteres.');
        db()->prepare('UPDATE utilizadores SET password_hash = ? WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), $U['id']]);
        out(['ok' => true]);

    /* ----- Gestão de utilizadores e cursos (administrador) ----- */
    case 'utilizadores':
        so_admin();
        $us = db()->query('SELECT id, nome, login, papel, ativo, ultimo_acesso, criado_em FROM utilizadores ORDER BY nome')->fetchAll();
        $lig = [];
        foreach (db()->query('SELECT utilizador_id, curso_id FROM utilizador_cursos') as $l) $lig[$l['utilizador_id']][] = (int)$l['curso_id'];
        foreach ($us as &$x) $x['cursos'] = $lig[$x['id']] ?? [];
        unset($x);
        $contar = implode(' + ', array_map(fn($n) => "(SELECT COUNT(*) FROM $n WHERE curso_id = c.id)",
            array_keys(array_filter($entities, fn($e) => ($e['scope'] ?? '') === 'curso'))));
        $cursos = db()->query("SELECT c.id, c.nome, (SELECT COUNT(*) FROM alunos WHERE curso_id = c.id) AS alunos,
                               ($contar) AS registos FROM cursos c ORDER BY c.nome")->fetchAll();
        out(['utilizadores' => $us, 'cursos' => $cursos, 'papeis' => PAPEIS]);

    case 'utilizador_guardar':
        if ($method !== 'POST') fail('Método inválido.', 405);
        so_admin();
        $id = (int)($body['id'] ?? 0);
        $nome = trim((string)($body['nome'] ?? ''));
        $login = validar_login((string)($body['login'] ?? ''));
        $papel = (string)($body['papel'] ?? 'diretor');
        $ativo = !empty($body['ativo']) ? 1 : 0;
        $pw = (string)($body['password'] ?? '');
        if ($nome === '') fail('Indique o nome.');
        if (!isset(PAPEIS[$papel])) fail('Papel inválido.');
        if (!$id && mb_strlen($pw) < 8) fail('Defina uma palavra-passe com pelo menos 8 caracteres.');
        if ($pw !== '' && mb_strlen($pw) < 8) fail('A palavra-passe deve ter pelo menos 8 caracteres.');
        if ($id === $U['id'] && ($papel !== 'admin' || !$ativo)) fail('Não pode retirar a si próprio o papel de administrador nem desativar a sua conta.');
        $st = db()->prepare('SELECT COUNT(*) FROM utilizadores WHERE login = ? AND id <> ?');
        $st->execute([$login, $id]);
        if ($st->fetchColumn()) fail("Já existe um utilizador «{$login}».");
        $cursosSel = array_values(array_intersect(array_map('intval', (array)($body['cursos'] ?? [])),
            array_map('intval', db()->query('SELECT id FROM cursos')->fetchAll(PDO::FETCH_COLUMN))));
        if ($papel === 'diretor' && !$cursosSel) fail('Escolha pelo menos um curso para o diretor de curso.');
        $pdo = db();
        $pdo->beginTransaction();
        if ($id) {
            $pdo->prepare('UPDATE utilizadores SET nome = ?, login = ?, papel = ?, ativo = ? WHERE id = ?')->execute([$nome, $login, $papel, $ativo, $id]);
            if ($pw !== '') $pdo->prepare('UPDATE utilizadores SET password_hash = ? WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), $id]);
        } else {
            $pdo->prepare('INSERT INTO utilizadores (nome, login, password_hash, papel, ativo) VALUES (?, ?, ?, ?, ?)')
                ->execute([$nome, $login, password_hash($pw, PASSWORD_DEFAULT), $papel, $ativo]);
            $id = (int)$pdo->lastInsertId();
        }
        $pdo->prepare('DELETE FROM utilizador_cursos WHERE utilizador_id = ?')->execute([$id]);
        foreach ($cursosSel as $c) $pdo->prepare('INSERT INTO utilizador_cursos (utilizador_id, curso_id) VALUES (?, ?)')->execute([$id, $c]);
        if (!$pdo->query("SELECT COUNT(*) FROM utilizadores WHERE papel = 'admin' AND ativo = 1")->fetchColumn()) {
            $pdo->rollBack();
            fail('Tem de existir pelo menos um administrador ativo.');
        }
        $pdo->commit();
        out(['ok' => true, 'id' => $id]);

    case 'utilizador_apagar':
        if ($method !== 'POST') fail('Método inválido.', 405);
        so_admin();
        $id = (int)($_GET['id'] ?? 0);
        if ($id === $U['id']) fail('Não pode apagar a sua própria conta.');
        $pdo = db();
        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM utilizadores WHERE id = ?')->execute([$id]); // os contactos registados ficam (sem autor)
        $pdo->prepare("DELETE FROM definicoes WHERE chave LIKE ?")->execute(["u$id:%"]);
        if (!$pdo->query("SELECT COUNT(*) FROM utilizadores WHERE papel = 'admin' AND ativo = 1")->fetchColumn()) {
            $pdo->rollBack();
            fail('Tem de existir pelo menos um administrador ativo.');
        }
        $pdo->commit();
        out(['ok' => true]);

    case 'curso_guardar':
        if ($method !== 'POST') fail('Método inválido.', 405);
        so_admin();
        $id = (int)($body['id'] ?? 0);
        $nome = trim((string)($body['nome'] ?? ''));
        if ($nome === '') fail('Indique o nome do curso.');
        if ($id) db()->prepare('UPDATE cursos SET nome = ? WHERE id = ?')->execute([$nome, $id]);
        else {
            db()->prepare('INSERT INTO cursos (nome) VALUES (?)')->execute([$nome]);
            $id = (int)db()->lastInsertId();
            // o novo curso começa com os textos do plano do curso ativo (podem ser alterados depois)
            if ($cid) foreach (array_keys(chaves_curso()) as $k) {
                if ($k === 'curso' || ($v = setting_raw("c$cid:$k")) === null) continue;
                db()->prepare('INSERT OR REPLACE INTO definicoes (chave, valor) VALUES (?, ?)')->execute(["c$id:$k", $v]);
            }
        }
        out(['ok' => true, 'id' => $id]);

    case 'curso_apagar':
        if ($method !== 'POST') fail('Método inválido.', 405);
        so_admin();
        $id = (int)($_GET['id'] ?? 0);
        foreach ($entities as $n => $e) {
            if (!scoped($n)) continue;
            $st = db()->prepare("SELECT COUNT(*) FROM $n WHERE curso_id = ?");
            $st->execute([$id]);
            if ($st->fetchColumn()) fail("O curso tem dados ({$e['label']}). Apague-os primeiro ou mantenha o curso.");
        }
        db()->prepare('DELETE FROM cursos WHERE id = ?')->execute([$id]);
        db()->prepare('DELETE FROM definicoes WHERE chave LIKE ?')->execute(["c$id:%"]);
        out(['ok' => true]);

    case 'importar': // importação em lote (ver lib/importar.php)
        if ($method !== 'POST') fail('Método inválido.', 405);
        if (!$cid) fail('Ainda não há nenhum curso. O administrador tem de criar um em «Utilizadores».');
        if (!is_array($body['linhas'] ?? null) || !$body['linhas']) fail('Não há linhas para importar.');
        if (count($body['linhas']) > 5000) fail('Máximo de 5000 linhas por importação.');
        out(importar($body));

    case 'export': // cópia de segurança em JSON: o administrador leva tudo; o diretor, o seu curso e os dados partilhados
        $data = ['exportado_em' => date('c')];
        foreach ($entities as $name => $e) {
            if (scoped($name) && !$ADMIN) {
                $st = db()->prepare("SELECT * FROM $name WHERE curso_id = ?");
                $st->execute([$cid]);
                $data[$name] = $st->fetchAll();
            } else $data[$name] = db()->query("SELECT * FROM $name")->fetchAll();
        }
        $st = db()->prepare('SELECT f.* FROM protocolo_ficheiros f JOIN protocolos p ON p.id = f.protocolo_id WHERE ? OR p.curso_id = ?');
        $st->execute([$ADMIN ? 1 : 0, $cid]);
        $data['protocolo_ficheiros'] = $st->fetchAll();
        if ($ADMIN) $data['cursos'] = db()->query('SELECT * FROM cursos')->fetchAll();
        header('Content-Disposition: attachment; filename="fct-backup-' . date('Y-m-d') . '.json"');
        out($data);
}

fail('Ação desconhecida.', 404);
