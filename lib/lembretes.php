<?php
/**
 * Lembretes por email para o professor (perfil em Definições).
 * Envio por SMTP (sem bibliotecas) ou, se não houver servidor SMTP configurado, pela função mail() do PHP.
 *
 * Disparo:
 *   - automático: uma vez por dia, quando a aplicação é aberta (ação «lembretes_auto»);
 *   - recomendado: tarefa agendada (cron) no servidor, ex. todos os dias às 8h:
 *       0 8 * * *  php /caminho/para/api.php lembretes
 */
declare(strict_types=1);

/** Itens a lembrar: tarefas, pendentes com empresas, entrevistas e reuniões até daqui a N dias. */
function lembretes_itens(): array {
    $dias  = max(0, (int)(setting('lembretes_dias') ?: 2));
    $hoje  = date('Y-m-d');
    $limite = date('Y-m-d', strtotime("+$dias days"));
    $pdo = db();
    // só os cursos do utilizador (o administrador sem cursos ligados recebe os de todos) e os contactos que ele registou
    global $CTX;
    $cursos = cursos_ligados($CTX['u']);
    if (!$cursos && $CTX['admin']) $cursos = array_map('intval', $pdo->query('SELECT id FROM cursos')->fetchAll(PDO::FETCH_COLUMN));
    $in = $cursos ? implode(',', $cursos) : '0';
    $q = function (string $sql, array $p) use ($pdo) { $st = $pdo->prepare($sql); $st->execute($p); return $st->fetchAll(); };

    $tarefas = $q("SELECT t.titulo, t.data_limite, e.nome AS empresa, a.nome AS aluno FROM tarefas t
                   LEFT JOIN empresas e ON e.id = t.empresa_id LEFT JOIN alunos a ON a.id = t.aluno_id
                   WHERE t.curso_id IN ($in) AND (t.estado IS NULL OR t.estado <> 'Feita') AND t.data_limite IS NOT NULL AND t.data_limite <= ?
                   ORDER BY t.data_limite", [$limite]);
    $pendentes = $q("SELECT c.proximo_passo, c.assunto, c.pendente, c.data_followup, e.nome AS empresa FROM contactos c
                     JOIN empresas e ON e.id = c.empresa_id
                     WHERE c.utilizador_id = {$CTX['u']} AND c.pendente IS NOT NULL AND c.pendente <> 'Nada' AND c.data_followup IS NOT NULL AND c.data_followup <= ?
                     ORDER BY c.data_followup", [$limite]);
    $entrevistas = $q("SELECT i.data_hora, i.local, a.nome AS aluno, e.nome AS empresa FROM entrevistas i
                       JOIN alunos a ON a.id = i.aluno_id JOIN empresas e ON e.id = i.empresa_id
                       WHERE i.curso_id IN ($in) AND i.estado = 'Agendada' AND substr(i.data_hora, 1, 10) BETWEEN ? AND ?
                       ORDER BY i.data_hora", [$hoje, $limite]);
    $reunioes = $q("SELECT r.data_hora, r.tipo, r.local, a.nome AS aluno, e.nome AS empresa FROM reunioes r
                    JOIN colocacoes c ON c.id = r.colocacao_id JOIN alunos a ON a.id = c.aluno_id JOIN empresas e ON e.id = c.empresa_id
                    WHERE r.curso_id IN ($in) AND r.estado = 'Agendada' AND substr(r.data_hora, 1, 10) BETWEEN ? AND ?
                    ORDER BY r.data_hora", [$hoje, $limite]);
    return compact('tarefas', 'pendentes', 'entrevistas', 'reunioes', 'dias');
}

function lembretes_texto(array $it): array {
    $hoje = date('Y-m-d');
    $d = fn(?string $iso) => $iso ? implode('/', array_reverse(explode('-', substr($iso, 0, 10)))) : '';
    $quando = fn(string $iso) => ($iso < $hoje ? 'ATRASADO ' : ($iso === $hoje ? 'HOJE ' : '')) . $d($iso);
    $sec = [];
    if ($it['tarefas']) {
        $sec[] = "TAREFAS\n" . implode("\n", array_map(fn($t) => sprintf('  • %s — %s%s',
            $quando($t['data_limite']), $t['titulo'],
            ($t['empresa'] || $t['aluno']) ? ' (' . implode(', ', array_filter([$t['empresa'], $t['aluno']])) . ')' : ''), $it['tarefas']));
    }
    if ($it['pendentes']) {
        $sec[] = "PENDENTES COM EMPRESAS\n" . implode("\n", array_map(fn($c) => sprintf('  • %s — %s: %s [%s]',
            $quando($c['data_followup']), $c['empresa'], $c['proximo_passo'] ?: ($c['assunto'] ?: '—'), $c['pendente']), $it['pendentes']));
    }
    if ($it['entrevistas']) {
        $sec[] = "ENTREVISTAS\n" . implode("\n", array_map(fn($x) => sprintf('  • %s %s — %s @ %s%s',
            $d($x['data_hora']), substr($x['data_hora'], 11, 5), $x['aluno'], $x['empresa'], $x['local'] ? " ({$x['local']})" : ''), $it['entrevistas']));
    }
    if ($it['reunioes']) {
        $sec[] = "REUNIÕES DE AVALIAÇÃO\n" . implode("\n", array_map(fn($x) => sprintf('  • %s %s — %s: %s → %s%s',
            $d($x['data_hora']), substr($x['data_hora'], 11, 5), $x['tipo'] ?: 'Reunião', $x['aluno'], $x['empresa'], $x['local'] ? " ({$x['local']})" : ''), $it['reunioes']));
    }
    $n = count($it['tarefas']) + count($it['pendentes']) + count($it['entrevistas']) + count($it['reunioes']);
    global $CTX;
    $nome = $CTX['nome'];
    $url = setting('app_url');
    $corpo = ($nome ? "Olá $nome,\n\n" : '')
        . "Lembretes da Gestão FCT para hoje e os próximos {$it['dias']} dia(s):\n\n"
        . ($sec ? implode("\n\n", $sec) : 'Não há nada agendado nem pendente neste período.')
        . "\n\n" . ($url ? "Abrir a aplicação: $url\n" : '')
        . "\n—\nMensagem automática enviada pela aplicação Gestão FCT. Pode desativar os lembretes em Definições.";
    return [$n, 'Gestão FCT — ' . ($n ? "$n lembrete(s)" : 'sem lembretes') . ' · ' . date('d/m/Y'), $corpo];
}

/**
 * Envia os lembretes. $forcar = true envia mesmo sem itens e mesmo que já tenha sido enviado hoje (teste).
 * Devolve ['enviado' => bool, 'motivo' => string, 'itens' => int].
 */
function lembretes_enviar(bool $forcar = false): array {
    $para = trim((string)setting('email_diretor'));
    if (!$forcar) {
        if (setting('lembretes_ativos') !== 'Sim') return ['enviado' => false, 'motivo' => 'Lembretes desativados.', 'itens' => 0];
        if (setting('lembretes_ultimo') === date('Y-m-d')) return ['enviado' => false, 'motivo' => 'Já enviado hoje.', 'itens' => 0];
    }
    if (!filter_var($para, FILTER_VALIDATE_EMAIL)) {
        return ['enviado' => false, 'motivo' => 'Configure o seu email no perfil (Definições).', 'itens' => 0];
    }
    [$n, $assunto, $corpo] = lembretes_texto(lembretes_itens());
    if (!$n && !$forcar) {
        set_setting('lembretes_ultimo', date('Y-m-d')); // nada a lembrar hoje
        return ['enviado' => false, 'motivo' => 'Nada a lembrar.', 'itens' => 0];
    }
    enviar_email($para, $assunto, $corpo);
    if (!$forcar) set_setting('lembretes_ultimo', date('Y-m-d'));
    return ['enviado' => true, 'motivo' => "Enviado para $para.", 'itens' => $n];
}

/* ---------- Envio de email ---------- */
function enviar_email(string $para, string $assunto, string $texto): void {
    $host = trim((string)setting('smtp_host'));
    $de = $para;
    foreach (['smtp_remetente', 'smtp_utilizador', 'email_diretor'] as $k) { // primeiro endereço válido
        $v = trim((string)setting($k));
        if (filter_var($v, FILTER_VALIDATE_EMAIL)) { $de = $v; break; }
    }
    $assuntoEnc = '=?UTF-8?B?' . base64_encode($assunto) . '?=';
    $corpo = chunk_split(base64_encode(str_replace("\n", "\r\n", $texto)));
    $cab = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        'From: =?UTF-8?B?' . base64_encode('Gestão FCT') . "?= <$de>",
    ];
    if ($host === '') {
        if (!@mail($para, $assuntoEnc, $corpo, implode("\r\n", $cab))) {
            throw new RuntimeException('O servidor não conseguiu enviar o email com mail(). Configure um servidor SMTP no perfil.');
        }
        return;
    }
    $msg = implode("\r\n", array_merge($cab, [
        "To: <$para>",
        "Subject: $assuntoEnc",
        'Date: ' . date('r'),
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@gestao-fct>',
    ])) . "\r\n\r\n" . $corpo;
    smtp_enviar($host, (int)(setting('smtp_porta') ?: 465), setting('smtp_seguranca') ?: 'ssl',
        (string)setting('smtp_utilizador'), (string)setting('smtp_password'), $de, $para, $msg);
}

function smtp_enviar(string $host, int $porta, string $seg, string $user, string $pass, string $de, string $para, string $msg): void {
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true]]);
    $fp = @stream_socket_client(($seg === 'ssl' ? 'ssl://' : 'tcp://') . "$host:$porta", $errno, $errstr, 20, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) throw new RuntimeException("Não foi possível ligar ao servidor SMTP $host:$porta ($errstr).");
    stream_set_timeout($fp, 20);
    $ler = function () use ($fp): string {
        $r = '';
        while (($l = fgets($fp, 1024)) !== false) { $r .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; }
        return $r;
    };
    // $mostra: o que aparece na mensagem de erro (nunca o utilizador/palavra-passe nem o texto do email)
    $cmd = function (?string $c, array $ok, ?string $mostra = null) use ($fp, $ler): string {
        if ($c !== null) fwrite($fp, $c . "\r\n");
        $r = $ler();
        if (!in_array((int)substr($r, 0, 3), $ok, true)) {
            fclose($fp);
            $mostra ??= $c ?? 'ligação';
            $codigo = (int)substr($r, 0, 3);
            $dica = in_array($codigo, [334, 535, 534], true) ? ' — verifique o utilizador e a palavra-passe SMTP (no Gmail use uma palavra-passe de aplicação).' : '';
            throw new RuntimeException("Erro SMTP em «{$mostra}»: " . trim($r) . $dica);
        }
        return $r;
    };
    $cmd(null, [220]);
    $ehlo = 'EHLO ' . (gethostname() ?: 'localhost');
    $cmd($ehlo, [250]);
    if ($seg === 'tls') {
        $cmd('STARTTLS', [220]);
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('Falhou o STARTTLS.');
        $cmd($ehlo, [250]);
    }
    if ($user !== '') {
        $cmd('AUTH LOGIN', [334]);
        $cmd(base64_encode($user), [334], 'autenticação (utilizador)');
        $cmd(base64_encode($pass), [235], 'autenticação (palavra-passe)');
    }
    $cmd("MAIL FROM:<$de>", [250]);
    $cmd("RCPT TO:<$para>", [250, 251]);
    $cmd('DATA', [354]);
    $cmd(preg_replace('/^\./m', '..', $msg) . "\r\n.", [250], 'envio da mensagem');
    fwrite($fp, "QUIT\r\n");
    fclose($fp);
}
