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
    return $pdo;
}

function setting(string $key): ?string {
    $st = db()->prepare('SELECT valor FROM definicoes WHERE chave = ?');
    $st->execute([$key]);
    $v = $st->fetchColumn();
    return $v === false ? null : $v;
}
function set_setting(string $key, ?string $value): void {
    db()->prepare('INSERT INTO definicoes (chave, valor) VALUES (?, ?)
                   ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')->execute([$key, $value]);
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
    global $schema;
    $p = ['diretor_curso' => setting('diretor_curso') ?? ''];
    foreach ($schema['perfil'] as $f) {
        $v = setting($f['name']) ?? '';
        $p[$f['name']] = !empty($f['secret']) ? ($v !== '' ? '********' : '') : $v;
    }
    return $p;
}

/* ---------- Linha de comandos (no servidor/computador, sem browser) ----------
 *   php api.php importar dados.json   -> importa um ficheiro JSON no formato do pedido «importar»
 */
if (PHP_SAPI === 'cli') {
    if (($argv[1] ?? '') === 'lembretes') { // para uma tarefa agendada (cron) no servidor
        try { echo json_encode(lembretes_enviar(), JSON_UNESCAPED_UNICODE), PHP_EOL; exit(0); }
        catch (RuntimeException $e) { fwrite(STDERR, $e->getMessage() . PHP_EOL); exit(1); }
    }
    if (($argv[1] ?? '') !== 'importar' || !is_file($argv[2] ?? '')) {
        fwrite(STDERR, "Uso: php api.php importar ficheiro.json  |  php api.php lembretes
");
        exit(1);
    }
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
    $row = clean_row($e, $input);
    check_required($e, $row, $id === 0);
    $pdo = db();
    if ($id) {
        if (!$row) fail('Nada para guardar.');
        $sets = implode(', ', array_map(fn($k) => "$k = :$k", array_keys($row)));
        $st = $pdo->prepare("UPDATE $name SET $sets, atualizado_em = CURRENT_TIMESTAMP WHERE id = :id");
        $st->execute($row + ['id' => $id]);
        if (!$st->rowCount()) fail('Registo não encontrado.', 404);
    } else {
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
$hasPassword = setting('password_hash') !== null;

switch ($action) {
    case 'me':
        out(['auth' => !empty($_SESSION['auth']), 'setup' => !$hasPassword]);

    case 'setup':
        if ($hasPassword) fail('A aplicação já está configurada.', 403);
        $pw = (string)($body['password'] ?? '');
        if (mb_strlen($pw) < 8) fail('A palavra-passe deve ter pelo menos 8 caracteres.');
        set_setting('password_hash', password_hash($pw, PASSWORD_DEFAULT));
        session_regenerate_id(true);
        $_SESSION['auth'] = true;
        out(['ok' => true]);

    case 'login':
        if ($method !== 'POST') fail('Método inválido.', 405);
        if (!$hasPassword || !password_verify((string)($body['password'] ?? ''), setting('password_hash'))) {
            sleep(1); // abranda tentativas de adivinhar a palavra-passe
            fail('Palavra-passe incorreta.', 401);
        }
        session_regenerate_id(true);
        $_SESSION['auth'] = true;
        out(['ok' => true]);

    case 'logout':
        $_SESSION = [];
        session_destroy();
        out(['ok' => true]);
}

/* ---------- Ações autenticadas ---------- */
if (empty($_SESSION['auth'])) fail('Sessão expirada. Inicie sessão novamente.', 401);
session_write_close(); // liberta o ficheiro de sessão para pedidos paralelos

switch ($action) {
    case 'all': // devolve todos os dados (volume pequeno: uma turma/curso)
        $data = [];
        foreach ($entities as $name => $e) {
            $order = $e['order'] ?? 'id';
            $data[$name] = db()->query("SELECT * FROM $name ORDER BY $order")->fetchAll();
        }
        $settings = [];
        foreach ($schema['settings'] as $s) if (isset($s['name'])) $settings[$s['name']] = setting($s['name']) ?? '';
        $data['protocolo_ficheiros'] = db()->query('SELECT id, protocolo_id, fase, nome, tamanho, carregado_em, guardado
                                                    FROM protocolo_ficheiros ORDER BY protocolo_id, id')->fetchAll();
        out(['data' => $data, 'settings' => $settings, 'perfil' => perfil_publico(), 'logos' => logos_info(),
             'fases' => FASES_PROTOCOLO]);

    case 'save':
        if ($method !== 'POST') fail('Método inválido.', 405);
        [$name, $e] = entity();
        out(save($name, $e, $body));

    case 'delete':
        if ($method !== 'POST') fail('Método inválido.', 405);
        [$name] = entity();
        db()->prepare("DELETE FROM $name WHERE id = ?")->execute([(int)($_GET['id'] ?? 0)]);
        if (in_array($name, ['protocolos', 'empresas', 'alunos'], true)) limpar_ficheiros_orfaos();
        out(['ok' => true]);

    case 'settings':
        if ($method !== 'POST') fail('Método inválido.', 405);
        foreach ($schema['settings'] as $s) {
            if (isset($s['name']) && array_key_exists($s['name'], $body)) set_setting($s['name'], trim((string)$body[$s['name']]));
        }
        out(['ok' => true]);

    case 'perfil': // perfil do professor e configuração dos lembretes por email
        if ($method !== 'POST') fail('Método inválido.', 405);
        if (array_key_exists('diretor_curso', $body)) set_setting('diretor_curso', trim((string)$body['diretor_curso']));
        foreach ($schema['perfil'] as $f) {
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
        $st = db()->prepare('SELECT * FROM protocolos WHERE id = ?');
        $st->execute([$id]);
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
        db()->prepare('DELETE FROM protocolo_ficheiros WHERE id = ?')->execute([(int)($_GET['f'] ?? 0)]);
        limpar_ficheiros_orfaos();
        out(['ok' => true]);

    case 'protocolo_ficheiro': // ?f=id do ficheiro — descarregar (ou abrir no browser com &ver=1)
        $st = db()->prepare('SELECT nome, guardado FROM protocolo_ficheiros WHERE id = ?');
        $st->execute([(int)($_GET['f'] ?? 0)]);
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
        $k = (string)($_GET['k'] ?? '');
        if (!isset(LOGOS[$k])) fail('Logótipo desconhecido.', 404);
        if ($f = logo_personalizado($k)) @unlink($f);
        out(['ok' => true, 'logos' => logos_info()]);

    case 'password':
        if ($method !== 'POST') fail('Método inválido.', 405);
        if (!password_verify((string)($body['atual'] ?? ''), setting('password_hash'))) fail('Palavra-passe atual incorreta.');
        $pw = (string)($body['nova'] ?? '');
        if (mb_strlen($pw) < 8) fail('A nova palavra-passe deve ter pelo menos 8 caracteres.');
        set_setting('password_hash', password_hash($pw, PASSWORD_DEFAULT));
        out(['ok' => true]);

    case 'importar': // importação em lote (ver lib/importar.php)
        if ($method !== 'POST') fail('Método inválido.', 405);
        if (!is_array($body['linhas'] ?? null) || !$body['linhas']) fail('Não há linhas para importar.');
        if (count($body['linhas']) > 5000) fail('Máximo de 5000 linhas por importação.');
        out(importar($body));

    case 'export': // cópia de segurança em JSON
        $data = ['exportado_em' => date('c')];
        foreach ($entities as $name => $e) $data[$name] = db()->query("SELECT * FROM $name")->fetchAll();
        $data['protocolo_ficheiros'] = db()->query('SELECT * FROM protocolo_ficheiros')->fetchAll();
        header('Content-Disposition: attachment; filename="fct-backup-' . date('Y-m-d') . '.json"');
        out($data);
}

fail('Ação desconhecida.', 404);
