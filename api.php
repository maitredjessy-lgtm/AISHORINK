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
        'siege' => "Abidjan, Côte d'Ivoire (à compléter)", 'tel' => '', 'email' => '', 'cotMaitre' => 2000,
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

/* ---- Titre : Grand Maître du style en Côte d'Ivoire (une seule fois) ---- */
if (getOne('meta', 'seed_grand_maitre') === null) {
    $asso = getOne('asso', 'main');
    if ($asso) {
        $poste = "Grand Maître du Shorinjiryu Kenkokan en Côte d'Ivoire";
        $bureau = $asso['bureau'] ?? [];
        $deja = false; foreach ($bureau as $b) if (stripos($b['nom'] ?? '', 'coulibaly') !== false) $deja = true;
        if (!$deja) array_unshift($bureau, ['poste' => $poste, 'nom' => 'COULIBALY Daouda (6e DAN)']);
        $asso['bureau'] = $bureau;
        if (trim($asso['histoireCI'] ?? '') === '') {
            $asso['histoireCI'] = "Le Grand Maître du Shorinjiryu Kenkokan en Côte d'Ivoire est Maître COULIBALY Daouda, 6e DAN.\n"
                . "Le premier club, KOSHIKI IVOIRE, situé à Abidjan (Abobo PK 18, non loin de l'ancien marché), est aussi le siège de l'Association Ivoirienne de Shorinjiryu Kenkokan Karatedo (AISHORINK).";
        }
        putOne('asso', 'main', $asso);
    }
    putOne('meta', 'seed_grand_maitre', ['done' => true]);
}

/* ---- Autres maîtres + club ACADÉMIE SHORINJIRYU CLUB (une seule fois) ----
   Grades : 2e DAN = 11, 3e DAN = 12, 4e DAN = 13. Mots de passe aléatoires : l'administrateur les définit. */
if (getOne('meta', 'seed_maitres_1') === null) {
    $maitres = [
        ['u_sidibe', 'SIDIBÉ Adama', 'adama.sidibe', 13],
        ['u_ouattara', 'OUATTARA Bouara Rokya', 'rokya.ouattara', 13],
        ['u_kabore', 'KABORÉ Djessy Paul Rhany', 'djessy.kabore', 12],
        ['u_togola', 'TOGOLA Sorry', 'sorry.togola', 11],
    ];
    foreach ($maitres as [$id, $nom, $login, $grade]) {
        if (getOne('users', $id) !== null) continue;
        foreach (getAll('users') as $u) if (strtolower($u['login']) === $login) $login .= '2';
        putOne('users', $id, ['id' => $id, 'login' => $login, 'hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT),
            'role' => 'maitre', 'nom' => $nom, 'grade' => $grade, 'cot' => new stdClass()]);
    }
    if (getOne('clubs', 'c_academie') === null) {
        $n = 0; foreach (getAll('clubs') as $c) $n = max($n, (int)substr($c['matricule'] ?? 'AISK-0', 5));
        putOne('clubs', 'c_academie', ['id' => 'c_academie', 'matricule' => sprintf('AISK-%03d', $n + 1), 'nom' => 'ACADÉMIE SHORINJIRYU CLUB',
            'ville' => 'Anyama', 'adresse' => "Anyama résidentiel, à l'école Henriette Dagry Diabaté", 'tel' => '', 'email' => '', 'creation' => '', 'cotEleve' => 0,
            'maitreId' => 'u_kabore', 'seances' => [], 'presence' => new stdClass(),
            'prospectus' => ['inscription' => '', 'jours' => '', 'prixGrades' => '']]);
    }
    $asso = getOne('asso', 'main');
    if ($asso) {
        $bureau = $asso['bureau'] ?? [];
        $deja = false; foreach ($bureau as $b) if (stripos($b['poste'] ?? '', 'présidente') !== false || stripos($b['poste'] ?? '', 'president') !== false) $deja = true;
        if (!$deja) array_unshift($bureau, ['poste' => "Présidente de l'Association", 'nom' => 'OUATTARA Bouara Rokya (4e DAN)']);
        $asso['bureau'] = $bureau;
        putOne('asso', 'main', $asso);
    }
    putOne('meta', 'seed_maitres_1', ['done' => true]);
}

/* ---- Cotisation mensuelle des maîtres : 2 000 FCFA (une seule fois, remplace l'ancienne valeur par défaut) ---- */
if (getOne('meta', 'seed_cot2000') === null) {
    $asso = getOne('asso', 'main');
    if ($asso && (int)($asso['cotMaitre'] ?? 0) === 5000) { $asso['cotMaitre'] = 2000; putOne('asso', 'main', $asso); }
    putOne('meta', 'seed_cot2000', ['done' => true]);
}

/* ---- Coordonnées officielles de l'association (d'après le calendrier d'activités 2025) ---- */
if (getOne('meta', 'seed_asso_contact') === null) {
    $asso = getOne('asso', 'main');
    if ($asso) {
        $siege = $asso['siege'] ?? '';
        if ($siege === '' || stripos($siege, 'compléter') !== false || strpos($siege, 'KOSHIKI IVOIRE –') === 0)
            $asso['siege'] = "KOSHIKI IVOIRE – Abobo PK 18, route d'Anyama, Autoroute Mohamed VI, non loin de l'ancien marché, Abidjan (Côte d'Ivoire)";
        $defaults = [
            'bp' => '13 BP 3177 Abidjan 13',
            'tel' => '05 05 55 32 19 / 07 78 99 06 84 / 01 42 42 03 30',
            'email' => 'aishorink.karateciv@yahoo.fr / aishorink.karateciv@gmail.com',
            'devise' => "Développement spirituel de l'individualité dans l'esprit et le corps",
            'statut' => "Association reconnue par l'État de Côte d'Ivoire. Récépissé de déclaration n°230/MEMAT/DGAP/DAG/SDVAC du 22 mars 2004 (Ministère d'État, Ministère de l'Administration du Territoire).",
        ];
        foreach ($defaults as $k => $v) if (trim((string)($asso[$k] ?? '')) === '') $asso[$k] = $v;
        putOne('asso', 'main', $asso);
    }
    $kc = getOne('clubs', 'c_koshiki');
    if ($kc && strpos($kc['adresse'] ?? '', "Abobo PK 18, non loin") === 0) {
        $kc['adresse'] = "Abobo PK 18, route d'Anyama, Autoroute Mohamed VI, non loin de l'ancien marché (siège de l'association)";
        putOne('clubs', 'c_koshiki', $kc);
    }
    putOne('meta', 'seed_asso_contact', ['done' => true]);
}

/* ---- Bureau officiel (communiqué de la Présidente du 20/02/2026) ---- */
if (getOne('meta', 'seed_bureau_2026') === null) {
    $asso = getOne('asso', 'main');
    if ($asso) {
        $provisoire = ["Présidente de l'Association", "Grand Maître du Shorinjiryu Kenkokan en Côte d'Ivoire", 'Administrateur général'];
        $ancien = $asso['bureau'] ?? [];
        $personnalise = false;
        foreach ($ancien as $b) if (!in_array($b['poste'] ?? '', $provisoire, true)) $personnalise = true;
        if (!$personnalise) {
            $B = fn($g, $p, $n) => ['groupe' => $g, 'poste' => $p, 'nom' => $n];
            $asso['bureau'] = [
                $B('Présidence', 'Présidente', 'OUATTARA Bouara Rokya, épse KONAN (4e DAN)'),
                $B('Grand Maître', "Grand Maître du Shorinjiryu Kenkokan en Côte d'Ivoire", 'COULIBALY Daouda (6e DAN)'),
                $B('Vice-présidence', '1er Vice-Président', "N'ZI Honoré N'Zi"),
                $B('Vice-présidence', '2e Vice-Président', 'BEUGRÉ Djidji Lambert'),
                $B('Secrétariat général', 'Secrétaire Général', 'TOGOLA Sorry (2e DAN)'),
                $B('Secrétariat général', 'Secrétaire Général Adjoint', 'SERE Ali'),
                $B('Trésorerie générale', 'Trésorière Générale', 'BAMBA Awa'),
                $B('Trésorerie générale', 'Trésorière Générale Adjointe', 'KOUADIO Amenant Siata'),
                $B('Direction technique', 'Directeur Technique', 'DIALLO Ibrahim'),
                $B('Direction technique', 'Directeur Technique Adjoint', 'DIGBEU Evariste'),
                $B('Communication', 'Chargé de Communication', 'ESSE Decho Louis Constant'),
                $B('Organisation', "Chargé à l'Organisation", 'BAMBA Awa'),
                $B('Organisation', "Chargé à l'Organisation Adjoint", 'TRAORÉ Mariam'),
                $B('Commission des grades', 'Président', 'COULIBALY Daouda (6e DAN)'),
                $B('Commission des grades', 'Vice-Président', 'SIDIBÉ Adama (4e DAN)'),
                $B('Conseillers', 'Conseiller', 'COULIBALY Daouda'),
                $B('Conseillers', 'Conseiller', 'SIDIBÉ Adama'),
                $B('Conseillers', 'Conseiller', 'BEUGRÉ Djidji Lambert'),
            ];
            $asso['bureauDate'] = '20/02/2026';
            putOne('asso', 'main', $asso);
        }
    }
    putOne('meta', 'seed_bureau_2026', ['done' => true]);
}

/* ---- Alignement sur le communiqué du 20/02/2026 : orthographe des noms + téléphones ---- */
if (getOne('meta', 'seed_communique_noms') === null) {
    $fix = fn($t) => preg_replace(['/\bRokya\b/u', '/\bSorry\b/u', '/\bAdama\b/u'], ['Rokia', 'Sory', 'Adaman'], (string)$t);
    $asso = getOne('asso', 'main');
    if ($asso) {
        foreach ($asso['bureau'] ?? [] as $i => $b) $asso['bureau'][$i]['nom'] = $fix($b['nom'] ?? '');
        $ancienTel = '05 05 55 32 19 / 07 78 99 06 84 / 01 42 42 03 30';
        if (trim($asso['tel'] ?? '') === '' || $asso['tel'] === $ancienTel) $asso['tel'] = '05 84 44 80 33 / 07 00 73 73 80 / 07 78 99 06 84';
        putOne('asso', 'main', $asso);
    }
    foreach (['u_ouattara', 'u_togola', 'u_sidibe'] as $uid) {
        $u = getOne('users', $uid);
        if ($u) { $u['nom'] = $fix($u['nom']); putOne('users', $uid, $u); }
    }
    putOne('meta', 'seed_communique_noms', ['done' => true]);
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
    usort($clubs, fn($a, $b) => strcmp($a['matricule'] ?? '', $b['matricule'] ?? ''));
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
