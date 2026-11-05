<?php
/**
 * Importação em lote de alunos, empresas e (opcionalmente) afetações.
 *
 * $p = [
 *   'ano_letivo'     => '2026/2027',
 *   'criar'          => ['alunos' => true, 'empresas' => true, 'colocacoes' => false],
 *   'estado_empresa' => 'Parceira',          // estado das empresas novas
 *   'simular'        => true,                // true = só pré-visualização (nada é gravado)
 *   'linhas'         => [['alunos' => [...], 'empresas' => [...], 'colocacoes' => [...]], ...],
 * ]
 */
declare(strict_types=1);

function norm_txt(?string $s): string {
    $s = mb_strtolower(trim((string)$s));
    $s = strtr($s, [
        'á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
        'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i', 'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o',
        'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ç' => 'c', 'ñ' => 'n',
    ]);
    return trim((string)preg_replace('/[^a-z0-9]+/', ' ', $s));
}

function nif_digitos($v): ?string {
    $d = preg_replace('/\D/', '', (string)$v);
    return strlen($d) === 9 ? $d : null;
}

function nif_valido(string $n): bool {
    if (!preg_match('/^[1-9]\d{8}$/', $n)) return false;
    $s = 0;
    for ($i = 0; $i < 8; $i++) $s += (int)$n[$i] * (9 - $i);
    $c = 11 - $s % 11;
    return ($c >= 10 ? 0 : $c) === (int)$n[8];
}

function importar(array $p): array {
    global $entities;
    $ano    = trim((string)($p['ano_letivo'] ?? '')) ?: (setting('ano_letivo') ?? '');
    $criar  = $p['criar'] ?? [];
    $simular = !empty($p['simular']);
    $soVazios = !empty($p['so_vazios']); // empresas que já existiam: só preencher campos vazios
    $estadoEmp = in_array($p['estado_empresa'] ?? '', $entities['empresas']['fields'][array_search('estado', array_column($entities['empresas']['fields'], 'name'))]['options'], true)
        ? $p['estado_empresa'] : 'Parceira';

    $res = [
        'alunos' => ['novos' => 0, 'atualizados' => 0, 'iguais' => 0],
        'empresas' => ['novos' => 0, 'atualizados' => 0, 'iguais' => 0],
        'colocacoes' => ['novos' => 0, 'atualizados' => 0, 'iguais' => 0],
        'pessoas' => ['novos' => 0, 'atualizados' => 0, 'iguais' => 0],
        'linhas' => 0, 'ignoradas' => 0, 'avisos' => [], 'simulacao' => $simular,
    ];
    $aviso = function (string $m) use (&$res) { if (count($res['avisos']) < 200) $res['avisos'][] = $m; };

    $pdo = db();
    $pdo->beginTransaction();
    try {
        // Índices dos registos existentes
        $empNome = $empNif = $empEmail = $alNum = $alNome = [];
        foreach ($pdo->query('SELECT id, nome, nif, email FROM empresas') as $e) {
            $empNome[norm_txt($e['nome'])] = (int)$e['id'];
            if ($n = nif_digitos($e['nif'])) $empNif[$n] ??= (int)$e['id'];
            if ($m = mb_strtolower(trim((string)$e['email']))) $empEmail[$m] ??= (int)$e['id'];
        }
        foreach ($pdo->query('SELECT id, numero, nome FROM alunos') as $a) {
            if (trim((string)$a['numero']) !== '') $alNum[trim((string)$a['numero'])] = (int)$a['id'];
            $alNome[norm_txt($a['nome'])] = ['id' => (int)$a['id'], 'numero' => trim((string)$a['numero'])];
        }
        $tocados = ['alunos' => [], 'empresas' => [], 'colocacoes' => []];
        $nifNomes = [];

        foreach ($p['linhas'] ?? [] as $i => $l) {
            $res['linhas']++;
            $nl = $i + 2; // nº da linha no ficheiro (linha 1 = cabeçalhos)
            $empId = $alId = null;
            $fez = false;

            /* ---- Empresa ---- */
            $E = (array)($l['empresas'] ?? []);
            if (!empty($criar['empresas'])) $E = importar_limpar_empresa($E, $nl, $aviso, $estadoEmp);
            if (!empty($criar['empresas']) && trim((string)($E['nome'] ?? '')) !== '') {
                $key = norm_txt($E['nome']);
                $nif = null;
                if (isset($E['nif']) && preg_match('/^[\s0-]*$/', (string)$E['nif'])) unset($E['nif']); // «0» = sem NIF
                if (isset($E['nif'])) {
                    $nif = nif_digitos($E['nif']);
                    if (!$nif) { $aviso("Linha $nl: NIF «{$E['nif']}» de «{$E['nome']}» não tem 9 dígitos (ignorado)."); unset($E['nif']); }
                    else {
                        $E['nif'] = $nif;
                        if (!nif_valido($nif)) $aviso("Linha $nl: o NIF $nif de «{$E['nome']}» não é válido (dígito de controlo). Verifique.");
                        $nifNomes[$nif][$key] = trim($E['nome']);
                    }
                }
                $empId = $empNome[$key] ?? null;
                if (!$empId && $nif && nif_valido($nif) && isset($empNif[$nif]) && !isset($tocados['empresas'][$empNif[$nif]])) {
                    $empId = $empNif[$nif];
                    $aviso("Linha $nl: «{$E['nome']}» associada pelo NIF à empresa já existente nº $empId.");
                }
                $mail = mb_strtolower(trim((string)($E['email'] ?? '')));
                if (!$empId && $mail !== '' && isset($empEmail[$mail]) && !isset($tocados['empresas'][$empEmail[$mail]])) {
                    $empId = $empEmail[$mail];
                    $aviso("Linha $nl: «{$E['nome']}» associada pelo email ($mail) à empresa já existente «" . importar_nome_empresa($empId) . "».");
                }
                $empId = importar_upsert('empresas', $empId, $E, ['estado' => $estadoEmp], $tocados, $res, $aviso, $nl, $soVazios);
                if ($mail !== '') $empEmail[$mail] ??= $empId;
                $empNome[$key] = $empId;
                if ($nif) $empNif[$nif] ??= $empId;
                importar_pessoas($empId, $E, $res);
                $fez = true;
            }

            /* ---- Aluno ---- */
            $A = (array)($l['alunos'] ?? []);
            if (!empty($criar['alunos']) && trim((string)($A['nome'] ?? '')) !== '') {
                $num = trim((string)($A['numero'] ?? ''));
                $porNome = $alNome[norm_txt($A['nome'])] ?? null;
                $alId = $num !== '' ? ($alNum[$num] ?? null) : null;
                // pelo nome só quando não há conflito de nº de processo (evita juntar homónimos)
                if (!$alId && $porNome && ($num === '' || $porNome['numero'] === '')) $alId = $porNome['id'];
                if ($ano !== '') $A['ano_letivo'] = $ano;
                $alId = importar_upsert('alunos', $alId, $A, [], $tocados, $res, $aviso, $nl);
                if ($num !== '') $alNum[$num] = $alId;
                $alNome[norm_txt($A['nome'])] = ['id' => $alId, 'numero' => $num];
                $fez = true;
            } elseif (!empty($criar['alunos']) && array_filter($A)) {
                $aviso("Linha $nl: aluno sem nome (ignorado).");
            }

            /* ---- Afetação aluno → empresa ---- */
            if (!empty($criar['colocacoes'])) {
                if (!$alId || !$empId) {
                    if ($alId && !$empId && !empty($criar['empresas'])) $aviso("Linha $nl: aluno sem empresa — afetação não criada.");
                } else {
                    $C = (array)($l['colocacoes'] ?? []);
                    $C['aluno_id'] = $alId; $C['empresa_id'] = $empId; $C['ano_letivo'] = $ano;
                    $st = $pdo->prepare('SELECT id FROM colocacoes WHERE aluno_id = ? AND empresa_id = ? AND COALESCE(ano_letivo, \'\') = ?');
                    $st->execute([$alId, $empId, $ano]);
                    $cid = $st->fetchColumn() ?: null;
                    importar_upsert('colocacoes', $cid ? (int)$cid : null, $C, ['estado' => 'Planeada'], $tocados, $res, $aviso, $nl);
                    $fez = true;
                }
            }
            if (!$fez) $res['ignoradas']++;
        }

        foreach ($nifNomes as $nif => $nomes) {
            if (count($nomes) > 1) $aviso("O NIF $nif aparece em empresas diferentes: «" . implode('», «', $nomes) . "». Corrija na ficha da empresa.");
        }
        if (!$simular && $ano !== '' && (setting('ano_letivo') ?? '') === '') set_setting('ano_letivo', $ano);
        $simular ? $pdo->rollBack() : $pdo->commit();
    } catch (Throwable $t) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $t;
    }
    return $res;
}

function importar_nome_empresa(int $id): string {
    $st = db()->prepare('SELECT nome FROM empresas WHERE id = ?');
    $st->execute([$id]);
    return (string)$st->fetchColumn();
}

/** «CASTANHEIRA DO RIBATEJO» → «Castanheira do Ribatejo» (só quando o texto está todo em maiúsculas). */
function capitalizar_pt(string $s): string {
    if ($s === '' || mb_strtoupper($s) !== $s) return $s;
    $s = mb_convert_case(mb_strtolower($s), MB_CASE_TITLE);
    return preg_replace_callback('/(?<=\s)(De|Do|Da|Dos|Das|E)(?=\s)/u', fn($m) => mb_strtolower($m[1]), $s);
}

/** Estado da empresa a partir de textos como «Aceite», «Contactada», «Documentos Enviados», «Não aceitou». */
function estado_empresa_lote(string $v): ?string {
    $n = norm_txt($v);
    if ($n === '') return null;
    foreach (['Por contactar', 'Em contacto', 'Parceira', 'Sem disponibilidade'] as $o) if ($n === norm_txt($o)) return $o;
    if (preg_match('/\b(nao|recus|rejeit|sem disp|indisp)/', $n)) return 'Sem disponibilidade';
    if (preg_match('/aceit|parceir|confirm|protocolo assinado/', $n)) return 'Parceira';
    if (preg_match('/contact|enviad|aguard|pendente|proposta|reuniao|interess/', $n)) return 'Em contacto';
    if (preg_match('/por contactar|a contactar|nova/', $n)) return 'Por contactar';
    return null;
}

/** Arruma uma linha de empresa vinda de uma lista feita à mão (nomes «mailto:», sites no email, código postal na morada…). */
function importar_limpar_empresa(array $E, int $nl, callable $aviso, string $estadoPadrao): array {
    foreach ($E as $k => $v) if (is_string($v)) $E[$k] = trim(preg_replace('/[\s\x{00A0}]+/u', ' ', $v));
    $nome = (string)($E['nome'] ?? '');
    if ($nome !== '' && preg_match('/^(?:mailto:)?\s*[^@\s]+@([^@\s]+)$/i', $nome, $m)) {
        $E['nome'] = $m[1];
        $E['email'] ??= preg_replace('/^mailto:\s*/i', '', $nome);
        $aviso("Linha $nl: o nome «{$nome}» era um email — a empresa ficou com o nome «{$m[1]}». Corrija o nome na ficha.");
    } else $E['nome'] = preg_replace('/^mailto:\s*/i', '', $nome);
    foreach (['email', 'email_responsavel'] as $k) {
        if (!isset($E[$k]) || $E[$k] === '') continue;
        $E[$k] = preg_replace('/^mailto:\s*/i', '', $E[$k]);
        if (!str_contains($E[$k], '@')) {
            if ($k === 'email' && preg_match('~^(https?://|www\.)~i', $E[$k])) { $E['website'] ??= rtrim($E[$k], '/#'); }
            else $aviso("Linha $nl: «{$E[$k]}» de «{$E['nome']}» não é um email — ignorado.");
            unset($E[$k]);
        }
    }
    if (isset($E['estado'])) {
        $orig = $E['estado'];
        $E['estado'] = estado_empresa_lote((string)$orig) ?? $estadoPadrao;
        if ($orig !== '' && !estado_empresa_lote((string)$orig)) $aviso("Linha $nl: estado «{$orig}» de «{$E['nome']}» não reconhecido — ficou «{$estadoPadrao}».");
    }
    // «2600-605 CASTANHEIRA DO RIBATEJO» na coluna do código postal → código postal + localidade
    if (isset($E['codigo_postal'])) {
        if (preg_match('/^(\d{4})\s*(?:-\s*(\d{3}))?\s*-?\s*(.*)$/u', $E['codigo_postal'], $m)) {
            $E['codigo_postal'] = $m[1] . (($m[2] ?? '') !== '' ? '-' . $m[2] : '');
            if (trim($m[3]) !== '') $E['localidade'] ??= capitalizar_pt(trim($m[3]));
        } elseif (preg_match('/^[\s-]*$/', $E['codigo_postal'])) unset($E['codigo_postal']);
    }
    // «Rua X, 2615-357 Alverca do Ribatejo» → código postal e localidade, se não vierem noutras colunas
    if (!empty($E['morada']) && preg_match('/(\d{4}-\d{3})\s+([^,;\d]+)/u', $E['morada'], $m)) {
        $E['codigo_postal'] ??= $m[1];
        $loc = trim(preg_replace('/\s*\bPortugal\b\s*$/iu', '', $m[2]));
        if ($loc !== '') $E['localidade'] ??= $loc;
    }
    $outros = array_filter($E, fn($v, $k) => $k !== 'nome' && $k !== 'estado' && $v !== '' && $v !== null, ARRAY_FILTER_USE_BOTH);
    if (($E['nome'] ?? '') !== '' && !$outros && empty($E['estado'])) $aviso("Linha $nl: «{$E['nome']}» só tem o nome — confirme que é mesmo uma empresa.");
    return $E;
}

/** Cada nome em «Pessoa de contacto» (separados por «;») fica também em Pessoas de contacto da empresa (para tutor). */
function importar_pessoas(int $empId, array $E, array &$res): void {
    $txt = trim((string)($E['responsavel'] ?? ''));
    if ($txt === '') return;
    $pdo = db();
    foreach (preg_split('/\s*;\s*/', $txt) as $nome) {
        $tel = null;
        if (preg_match('/(?:\+351\s*)?(\d[\d ]{7,}\d)/', $nome, $m)) { $tel = preg_replace('/\s+/', '', $m[1]); $nome = trim(str_replace($m[0], '', $nome)); }
        $nome = trim($nome, " \t,.-");
        if (!preg_match('/\pL{2,}/u', $nome)) continue;
        if (!preg_match('/\p{Lu}/u', $nome)) $nome = mb_convert_case($nome, MB_CASE_TITLE); // «joão silva» → «João Silva»
        $email = $E['email_responsavel'] ?? $E['email'] ?? null;
        $tel ??= $E['telefone_responsavel'] ?? (isset($E['telefone']) ? preg_replace('/\s+/', '', (string)$E['telefone']) : null);
        $st = $pdo->prepare('SELECT * FROM pessoas WHERE empresa_id = ?');
        $st->execute([$empId]);
        $ex = null;
        foreach ($st as $p) if (norm_txt($p['nome']) === norm_txt($nome)) { $ex = $p; break; }
        if (!$ex) {
            $pdo->prepare('INSERT INTO pessoas (empresa_id, nome, email, telefone, cargo, tutor) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$empId, $nome, $email, $tel, $E['cargo_responsavel'] ?? null, 'Sim']);
            $res['pessoas']['novos']++;
            continue;
        }
        $ch = array_filter(['email' => $email, 'telefone' => $tel], fn($v, $k) => $v && ($ex[$k] === null || $ex[$k] === ''), ARRAY_FILTER_USE_BOTH);
        if ($ch) {
            $sets = implode(', ', array_map(fn($k) => "$k = :$k", array_keys($ch)));
            $pdo->prepare("UPDATE pessoas SET $sets, atualizado_em = CURRENT_TIMESTAMP WHERE id = :id")->execute($ch + ['id' => $ex['id']]);
            $res['pessoas']['atualizados']++;
        } else $res['pessoas']['iguais']++;
    }
}

/**
 * Cria ou atualiza um registo.
 * - Registo já existente antes da importação: valores do ficheiro substituem os atuais (notas são acrescentadas).
 * - Registo criado/atualizado nesta mesma importação (ex.: empresa repetida em várias linhas): só preenche campos vazios.
 */
function importar_upsert(string $table, ?int $id, array $data, array $defaults, array &$tocados, array &$res, callable $aviso, int $nl, bool $soVazios = false): int {
    global $entities;
    $pdo = db();
    $row = [];
    foreach ($entities[$table]['fields'] as $f) {
        if (!array_key_exists($f['name'], $data)) continue;
        $v = $data[$f['name']];
        if ($v === null || (is_string($v) && trim($v) === '')) continue;
        if ($f['type'] === 'number') {
            if (!is_numeric($v)) { $aviso("Linha $nl: «{$f['label']}» não é numérico ($v) — ignorado."); continue; }
            $v = (float)$v;
        } elseif ($f['type'] === 'ref') $v = (int)$v;
        elseif ($f['type'] === 'select' && !in_array($v, $f['options'], true)) {
            $aviso("Linha $nl: valor «{$v}» inválido em «{$f['label']}» — ignorado."); continue;
        } elseif ($f['type'] === 'date' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$v)) {
            $aviso("Linha $nl: data «{$v}» inválida em «{$f['label']}» — ignorada."); continue;
        } elseif ($f['type'] === 'tel') $v = preg_replace('/\s+/', '', (string)$v); // 217 656 530 -> 217656530
        else $v = trim((string)$v);
        $row[$f['name']] = $v;
    }

    if (!$id) {
        $row += $defaults;
        $cols = array_keys($row);
        $pdo->prepare("INSERT INTO $table (" . implode(',', $cols) . ') VALUES (:' . implode(', :', $cols) . ')')->execute($row);
        $id = (int)$pdo->lastInsertId();
        $tocados[$table][$id] = true;
        $res[$table]['novos']++;
        return $id;
    }

    $st = $pdo->prepare("SELECT * FROM $table WHERE id = ?");
    $st->execute([$id]);
    $cur = $st->fetch();
    $jaTocado = isset($tocados[$table][$id]);
    $textareas = array_column(array_filter($entities[$table]['fields'], fn($f) => $f['type'] === 'textarea'), 'name');
    $changes = [];
    foreach ($row as $k => $v) {
        $old = $cur[$k];
        if ($old === null || $old === '') { $changes[$k] = $v; continue; }
        if ((string)$old === (string)$v) continue;
        if (in_array($k, $textareas, true)) {
            if (!str_contains((string)$old, (string)$v)) $changes[$k] = $old . "\n" . $v;
        } elseif ($soVazios && !$jaTocado) {
            if ($k === 'estado' && $old === 'Por contactar') $changes[$k] = $v; // o estado por omissão pode avançar
        } elseif (!$jaTocado) $changes[$k] = $v;
        else {
            $lbl = array_column($entities[$table]['fields'], 'label', 'name')[$k] ?? $k;
            $aviso("Linha $nl: «{$lbl}» de «" . ($cur['nome'] ?? "registo $id") . "» difere de outra linha ({$v} / {$old}); mantido «{$old}».");
        }
    }
    if ($changes) {
        $sets = implode(', ', array_map(fn($k) => "$k = :$k", array_keys($changes)));
        $pdo->prepare("UPDATE $table SET $sets, atualizado_em = CURRENT_TIMESTAMP WHERE id = :id")->execute($changes + ['id' => $id]);
    }
    if (!$jaTocado) $res[$table][$changes ? 'atualizados' : 'iguais']++;
    $tocados[$table][$id] = true;
    return $id;
}
