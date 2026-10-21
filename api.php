<?php
/* AISHORINK – API serveur (PHP + SQLite).
   Toutes les règles d'accès sont appliquées ici, côté serveur. */
declare(strict_types=1);

session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS']) || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https']);
session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function out($data, int $code = 200): void { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit; }
function fail(string $msg, int $code = 400): void { out(['error' => $msg], $code); }

/* ---- Base de données ---- */
$dir = getenv('DATA_DIR') ?: __DIR__ . '/data';
if (!is_dir($dir)) {
    mkdir($dir, 0750, true);
    file_put_contents($dir . '/.htaccess', "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
    file_put_contents($dir . '/web.config', '<?xml version="1.0"?><configuration><system.webServer><authorization><deny users="*"/></authorization></system.webServer></configuration>');
}
$pdo = new PDO('sqlite:' . $dir . '/aishorink.sqlite');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE IF NOT EXISTS docs(coll TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(coll,id))');

function getAll(string $coll): array {
    global $pdo;
    $st = $pdo->prepare('SELECT json FROM docs WHERE coll=?'); $st->execute([$coll]);
    return array_map(fn($r) => json_decode($r['json'], true), $st->fetchAll(PDO::FETCH_ASSOC));
}
function getOne(string $coll, string $id): ?array {
    global $pdo;
    $st = $pdo->prepare('SELECT json FROM docs WHERE coll=? AND id=?'); $st->execute([$coll, $id]);
    $r = $st->fetchColumn();
    return $r === false ? null : json_decode($r, true);
}
function putOne(string $coll, string $id, array $doc): void {
    global $pdo;
    $pdo->prepare('INSERT OR REPLACE INTO docs(coll,id,json) VALUES(?,?,?)')->execute([$coll, $id, json_encode($doc, JSON_UNESCAPED_UNICODE)]);
}
function delOne(string $coll, string $id): void {
    global $pdo;
    $pdo->prepare('DELETE FROM docs WHERE coll=? AND id=?')->execute([$coll, $id]);
}

/* ---- Données initiales ---- */
if (getOne('asso', 'main') === null) {
    putOne('asso', 'main', [
        'nom' => "Association Ivoirienne de Shorinjiryu Kenkokan Karatedo (AISHORINK)",
        'siege' => "Abidjan, Côte d'Ivoire (à compléter)", 'tel' => '', 'email' => '', 'cotMaitre' => 5000,
        'bureau' => [['poste' => 'Administrateur général', 'nom' => 'À compléter']],
    ]);
    putOne('users', 'u_admin', ['id' => 'u_admin', 'login' => 'admin', 'hash' => password_hash('admin2026', PASSWORD_DEFAULT),
        'role' => 'admin', 'nom' => 'Administrateur général', 'grade' => null, 'cot' => new stdClass()]);
}

/* ---- Premier club : KOSHIKI IVOIRE (une seule fois, ne remplace rien d'existant) ---- */
if (getOne('meta', 'seed_koshiki') === null) {
    $dejaLa = false;
    foreach (getAll('clubs') as $c) if (stripos($c['nom'] ?? '', 'koshiki') !== false) $dejaLa = true;
    $adresse = "Abobo PK 18, non loin de l'ancien marché";
    if (!$dejaLa) {
        $n = 0; foreach (getAll('clubs') as $c) $n = max($n, (int)substr($c['matricule'] ?? 'AISK-0', 5));
        putOne('clubs', 'c_koshiki', ['id' => 'c_koshiki', 'matricule' => sprintf('AISK-%03d', $n + 1), 'nom' => 'KOSHIKI IVOIRE',
            'ville' => 'Abidjan', 'adresse' => $adresse . " (siège de l'association)", 'tel' => '', 'email' => '', 'creation' => '', 'cotEleve' => 0,
            'maitreId' => '', 'seances' => [], 'presence' => new stdClass(),
            'prospectus' => ['inscription' => '', 'jours' => '', 'prixGrades' => '']]);
    }
    $asso = getOne('asso', 'main');
    if ($asso && (stripos($asso['siege'] ?? '', 'compléter') !== false || ($asso['siege'] ?? '') === '')) {
        $asso['siege'] = "KOSHIKI IVOIRE – " . $adresse . ", Abidjan (Côte d'Ivoire)";
        putOne('asso', 'main', $asso);
    }
    putOne('meta', 'seed_koshiki', ['done' => true]);
}

/* ---- Maître de KOSHIKI IVOIRE : Coulibaly Daouda, 6e DAN (une seule fois) ---- */
if (getOne('meta', 'seed_koshiki_maitre') === null) {
    $c = getOne('clubs', 'c_koshiki');
    if ($c && ($c['maitreId'] ?? '') === '' && getOne('users', 'u_coulibaly') === null) {
        $login = 'coulibaly';
        foreach (getAll('users') as $u) if (strtolower($u['login']) === $login) $login = 'coulibaly.daouda';
        /* Mot de passe aléatoire inconnu de tous : l'administrateur en définit un via Administration → Maîtres → Modifier. */
        putOne('users', 'u_coulibaly', ['id' => 'u_coulibaly', 'login' => $login, 'hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT),
            'role' => 'maitre', 'nom' => 'COULIBALY Daouda', 'grade' => 15, 'cot' => new stdClass()]);
        $c['maitreId'] = 'u_coulibaly';
        putOne('clubs', 'c_koshiki', $c);
    }
    putOne('meta', 'seed_koshiki_maitre', ['done' => true]);
}

/* ---- Requête ---- */
$in = [];
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST requis', 405);
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) fail('Content-Type invalide', 415);
$raw = file_get_contents('php://input');
if (strlen($raw) > 8 * 1024 * 1024) fail('Requête trop volumineuse', 413);
$in = json_decode($raw, true) ?: [];
$action = $_GET['action'] ?? '';

function currentUser(): ?array {
    return isset($_SESSION['uid']) ? getOne('users', $_SESSION['uid']) : null;
}
function ownClubId(?array $u): ?string {
    if (!$u) return null;
    foreach (getAll('clubs') as $c) if (($c['maitreId'] ?? '') === $u['id']) return $c['id'];
    return null;
}
function canClub(?array $u, ?string $clubId): bool {
    if (!$u || !$clubId) return false;
    return $u['role'] === 'admin' || ownClubId($u) === $clubId;
}

/* ---- Actions ---- */
if ($action === 'login') {
    if (($_SESSION['fails'] ?? 0) >= 3) sleep(min(5, $_SESSION['fails'] - 2));
    $login = (string)($in['login'] ?? ''); $pw = (string)($in['password'] ?? '');
    foreach (getAll('users') as $u) {
        if (hash_equals(strtolower($u['login']), strtolower($login)) && password_verify($pw, $u['hash'])) {
            session_regenerate_id(true);
            $_SESSION['uid'] = $u['id']; $_SESSION['fails'] = 0;
            out(['ok' => true]);
        }
    }
    $_SESSION['fails'] = ($_SESSION['fails'] ?? 0) + 1;
    fail('Identifiant ou mot de passe incorrect.', 401);
}
if ($action === 'logout') { session_destroy(); out(['ok' => true]); }

if ($action === 'state') {
    $u = currentUser(); $admin = $u && $u['role'] === 'admin';
    $users = array_map(function ($x) use ($admin) {
        unset($x['hash']);
        if (!$admin) unset($x['login']);
        return $x;
    }, getAll('users'));
    $clubs = array_map(function ($c) use ($u) {
        if (!canClub($u, $c['id'])) { unset($c['presence'], $c['seances']); }
        return $c;
    }, getAll('clubs'));
    $eleves = array_values(array_filter(getAll('eleves'), fn($e) => canClub($u, $e['clubId'] ?? null)));
    out(['meId' => $u['id'] ?? null, 'asso' => getOne('asso', 'main'), 'users' => $users, 'clubs' => $clubs, 'eleves' => $eleves,
         'activites' => getAll('activites'), 'finances' => getAll('finances'),
         'examens' => $admin ? getAll('examens') : []]);
}

if ($action === 'sync') {
    $u = currentUser();
    if (!$u) fail('Connexion requise.', 401);
    $admin = $u['role'] === 'admin';
    $ops = $in['ops'] ?? [];
    if (!is_array($ops) || count($ops) > 2000) fail('Opérations invalides.');
    $pdo->beginTransaction();
    try {
        foreach ($ops as $op) {
            $coll = (string)($op['coll'] ?? ''); $id = (string)($op['id'] ?? ''); $kind = $op['op'] ?? '';
            if (!preg_match('/^[A-Za-z0-9_]{1,40}$/', $id)) throw new RuntimeException('Identifiant invalide.');
            if (!in_array($coll, ['asso', 'users', 'clubs', 'eleves', 'activites', 'finances', 'examens'], true)) throw new RuntimeException('Collection invalide.');

            if ($kind === 'del') {
                if ($coll === 'eleves') {
                    $e = getOne('eleves', $id);
                    if ($e && !canClub($u, $e['clubId'])) throw new RuntimeException('Accès refusé.', 403);
                } else {
                    if (!$admin) throw new RuntimeException('Accès refusé.', 403);
                    if ($coll === 'asso' || ($coll === 'users' && $id === 'u_admin')) throw new RuntimeException('Suppression interdite.');
                    if ($coll === 'clubs') foreach (getAll('eleves') as $e) if ($e['clubId'] === $id) delOne('eleves', $e['id']);
                }
                delOne($coll, $id);
                continue;
            }
            if ($kind !== 'put' || !is_array($op['doc'] ?? null)) throw new RuntimeException('Opération invalide.');
            $doc = $op['doc']; $old = getOne($coll, $id);

            switch ($coll) {
                case 'asso':
                    if (!$admin || $id !== 'main') throw new RuntimeException('Accès refusé.', 403);
                    putOne('asso', 'main', $doc); break;
                case 'activites': case 'finances': case 'examens':
                    if (!$admin) throw new RuntimeException('Accès refusé.', 403);
                    $doc['id'] = $id; putOne($coll, $id, $doc); break;
                case 'users':
                    if (!$admin) throw new RuntimeException('Accès refusé.', 403);
                    $login = trim((string)($doc['login'] ?? ''));
                    if ($login === '') throw new RuntimeException('Identifiant requis.');
                    foreach (getAll('users') as $o) if ($o['id'] !== $id && strtolower($o['login']) === strtolower($login)) throw new RuntimeException('Identifiant déjà utilisé.');
                    $hash = $old['hash'] ?? null;
                    if (!empty($doc['pw'])) $hash = password_hash((string)$doc['pw'], PASSWORD_DEFAULT);
                    if (!$hash) throw new RuntimeException('Mot de passe requis.');
                    putOne('users', $id, [
                        'id' => $id, 'login' => $login, 'hash' => $hash, 'role' => $old['role'] ?? 'maitre',
                        'nom' => (string)($doc['nom'] ?? ''), 'grade' => $doc['grade'] ?? null,
                        'cot' => $doc['cot'] ?? new stdClass(),
                    ]); break;
                case 'clubs':
                    $doc['id'] = $id;
                    if ($admin) { putOne('clubs', $id, $doc); break; }
                    if (!$old || ($old['maitreId'] ?? '') !== $u['id']) throw new RuntimeException('Accès refusé.', 403);
                    foreach (['nom', 'ville', 'adresse', 'tel', 'email', 'creation', 'cotEleve', 'prospectus', 'seances', 'presence'] as $f)
                        if (array_key_exists($f, $doc)) $old[$f] = $doc[$f];
                    putOne('clubs', $id, $old); break;
                case 'eleves':
                    $doc['id'] = $id;
                    $target = $doc['clubId'] ?? null;
                    if (!canClub($u, $target) || ($old && !canClub($u, $old['clubId']))) throw new RuntimeException('Accès refusé.', 403);
                    if (!getOne('clubs', (string)$target)) throw new RuntimeException('Club inconnu.');
                    putOne('eleves', $id, $doc); break;
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        $c = (int)$e->getCode();
        fail($e->getMessage(), $c === 403 ? 403 : 400);
    }
    out(['ok' => true]);
}

fail('Action inconnue', 404);
