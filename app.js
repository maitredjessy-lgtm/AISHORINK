/* AISHORINK – Association Ivoirienne de Shorinjiryu Kenkokan Karatedo
   Application connectée à api.php (PHP + SQLite). */
'use strict';

/* ---------- Grades ---------- */
const GRADES = [];
[['Blanche', '#f4f4f4'], ['Jaune', '#f5d90a'], ['Orange', '#f28c28'], ['Verte', '#2e9e4f'], ['Marron', '#7a4a21']]
  .forEach(([c, col]) => [1, 2].forEach(n => GRADES.push({ nom: `Ceinture ${c} ${n}`, col, rang: GRADES.length })));
for (let n = 1; n <= 10; n++) GRADES.push({ nom: `Ceinture noire ${n}${n === 1 ? 'er' : 'e'} DAN`, col: '#111', rang: GRADES.length });

/* ---------- Utilitaires ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const fmtD = d => d ? d.split('-').reverse().join('/') : '—';
const money = n => (Number(n) || 0).toLocaleString('fr-FR') + ' FCFA';
const thisMonth = () => new Date().toISOString().slice(0, 7);
const belt = r => r == null || !GRADES[r] ? '<span class="tag">—</span>' :
  `<span class="belt" style="background:${GRADES[r].col};color:${GRADES[r].col === '#111' || GRADES[r].col === '#7a4a21' || GRADES[r].col === '#2e9e4f' ? '#fff' : '#111'}">${GRADES[r].nom.replace('Ceinture ', '')}</span>`;
const gradeOpts = GRADES.map(g => [g.rang, g.nom]);

/* ---------- Données (synchronisées avec api.php) ---------- */
let db = { asso: { bureau: [] }, users: [], clubs: [], eleves: [], activites: [], finances: [], examens: [], meId: null };
let snap = {}, queue = Promise.resolve();

async function api(action, body) {
  let r;
  try {
    r = await fetch('api.php?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  } catch (e) { throw new Error('Serveur injoignable.'); }
  let d = null; try { d = await r.json(); } catch (e) { throw new Error('Réponse invalide du serveur (api.php est-il exécuté par PHP ?).'); }
  if (!r.ok) throw new Error(d.error || 'Erreur ' + r.status);
  return d;
}
function snapOf() {
  const m = { 'asso/main': JSON.stringify(db.asso) };
  ['users', 'clubs', 'eleves', 'activites', 'finances', 'examens'].forEach(c => db[c].forEach(d => { m[c + '/' + d.id] = JSON.stringify(d); }));
  return m;
}
async function loadState(skipWait) {
  if (!skipWait) await queue;
  db = await api("state");
  db.eleves.forEach(e => { if (Array.isArray(e.pay)) e.pay = {}; });
  db.clubs.forEach(c => { if (Array.isArray(c.presence)) c.presence = {}; });
  db.users.forEach(u => { if (Array.isArray(u.cot)) u.cot = {}; });
  snap = snapOf();
}
/* Envoie au serveur les différences depuis le dernier état synchronisé. */
function save() {
  const now = snapOf(), ops = [];
  for (const k in now) if (now[k] !== snap[k]) { const [coll, id] = k.split('/'); ops.push({ op: 'put', coll, id, doc: JSON.parse(now[k]) }); }
  for (const k in snap) if (!(k in now)) { const [coll, id] = k.split('/'); ops.push({ op: 'del', coll, id }); }
  db.users.forEach(u => { delete u.pw; });
  snap = snapOf();
  if (!ops.length) return;
  queue = queue.then(() => api('sync', { ops })).catch(async e => {
    alert('Modification refusée : ' + e.message);
    try { await loadState(true); } catch (x) { /* hors ligne */ }
    render();
  });
}
async function init() {
  try { await loadState(); } catch (e) { $('#app').innerHTML = `<div class="card"><h2>Serveur indisponible</h2><p>${esc(e.message)}</p></div>`; throw e; }
}
const me = () => db.users.find(u => u.id === db.meId) || null;
const isAdmin = () => me()?.role === 'admin';
const clubOf = u => u && db.clubs.find(c => c.maitreId === u.id);
const canClub = id => { const u = me(); return !!u && (u.role === 'admin' || clubOf(u)?.id === id); };
const club = id => db.clubs.find(c => c.id === id);
const user = id => db.users.find(u => u.id === id);
const eleve = id => db.eleves.find(e => e.id === id);
const gradeOf = e => e.grades?.length ? Math.max(...e.grades.map(g => +g.grade)) : null;
const gradeDate = e => { const r = gradeOf(e); return e.grades.filter(g => +g.grade === r).map(g => g.date).sort().pop(); };
const clubElevesOf = id => db.eleves.filter(e => e.clubId === id);
const nextMatricule = () => 'AISK-' + String(Math.max(0, ...db.clubs.map(c => +c.matricule.split('-')[1] || 0)) + 1).padStart(3, '0');

/* ---------- Formulaire modal générique ---------- */
function resizeImg(file) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => {
        const w = 240, h = Math.round(im.height * w / im.width), c = document.createElement('canvas');
        c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h); res(c.toDataURL('image/jpeg', .8));
      };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
function openForm(title, fields, vals, onOk, okLabel = 'Enregistrer') {
  vals = vals || {};
  const d = $('#dlg');
  d.innerHTML = `<form><h2 style="margin-top:0">${esc(title)}</h2>${fields.map(f => {
    const v = vals[f.n] ?? f.def ?? '', req = f.req ? 'required' : '';
    let i;
    if (f.t === 'textarea') i = `<textarea name="${f.n}" ${req}>${esc(v)}</textarea>`;
    else if (f.t === 'select') i = `<select name="${f.n}" ${req}>${f.opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else if (f.t === 'file') i = `<input type="file" name="${f.n}" accept="image/*">`;
    else i = `<input type="${f.t || 'text'}" name="${f.n}" value="${esc(v)}" ${req} ${f.step ? `step="${f.step}"` : ''}>`;
    return `<label>${esc(f.l)}${f.req ? ' *' : ''}</label>${i}`;
  }).join('')}<div class="row" style="margin-top:18px"><span class="sp"></span><button type="button" class="btn alt" data-a="close">Annuler</button><button class="btn">${okLabel}</button></div></form>`;
  d.querySelector('form').onsubmit = async ev => {
    ev.preventDefault();
    const o = {};
    for (const f of fields) {
      const el = ev.target.elements[f.n];
      if (f.t === 'file') o[f.n] = el.files[0] ? await resizeImg(el.files[0]) : null;
      else o[f.n] = el.value;
    }
    d.close(); await onOk(o);
  };
  d.showModal();
}
const confirmDo = (msg, fn) => { if (confirm(msg)) fn(); };

/* ---------- État / routage ---------- */
const S = { exam: null, tab: 'eleves', month: thisMonth(), year: new Date().getFullYear(), atab: 'clubs' };
const go = h => { location.hash = h; };
const rerender = () => render();

function layout(route) {
  const u = me();
  const links = [['#/', 'Accueil'], ['#/association', 'Association'], ['#/activites', 'Activités'], ['#/clubs', 'Clubs'], ['#/finances', 'Finances']];
  if (u && u.role === 'maitre' && clubOf(u)) links.push([`#/espace/${clubOf(u).id}`, 'Mon club']);
  if (u?.role === 'admin') links.push(['#/admin', 'Administration']);
  $('#nav').innerHTML = links.map(([h, l]) => `<a href="${h}" class="${('#' + route) === h ? 'on' : ''}">${l}</a>`).join('');
  $('#who').innerHTML = u ? `<span>${esc(u.nom)} <span class="tag">${u.role === 'admin' ? 'Admin' : 'Maître'}</span></span><a class="btn sm alt" data-a="logout">Déconnexion</a>` : `<a class="btn sm" href="#/login">Connexion</a>`;
  $('#foot').innerHTML = `© ${new Date().getFullYear()} AISHORINK – ${esc(db.asso.nom)}<br>Siège : ${esc(db.asso.siege)}`;
}

async function render() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [, p1, p2] = h.split('/');
  layout(h);
  let html;
  switch (p1 || '') {
    case '': html = pgHome(); break;
    case 'association': html = pgAsso(); break;
    case 'activites': html = pgActs(); break;
    case 'clubs': html = pgClubs(); break;
    case 'club': html = pgClub(p2); break;
    case 'espace': html = pgEspace(p2); break;
    case 'eleve': html = pgEleve(p2); break;
    case 'finances': html = pgFin(); break;
    case 'admin': html = pgAdmin(); break;
    case 'login': html = pgLogin(); break;
    default: html = '<p class="empty">Page introuvable.</p>';
  }
  $('#app').innerHTML = html;
  window.scrollTo(0, 0);
}

const denied = () => `<div class="card"><h2>Accès réservé</h2><p>Cet espace n'est accessible qu'au maître du club concerné ou à l'administrateur général.</p><a class="btn" href="#/login">Se connecter</a></div>`;

/* ---------- Pages publiques ---------- */
function pgHome() {
  const nextActs = db.activites.filter(a => a.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  return `<div class="hero"><img class="heroLogo" src="img/logo.jpg" alt=""><h1>空手道 – AISHORINK</h1><p><b>${esc(db.asso.nom)}</b><br>Discipline, respect, persévérance : le Shorinjiryu Kenkokan Karatedo en Côte d'Ivoire.</p>
  <a class="btn" href="#/clubs">Trouver un club</a> <a class="btn alt" href="#/activites">Voir les activités</a></div>
  <div class="grid">
   <div class="card"><div class="stat">${db.clubs.length}</div>Clubs affiliés</div>
   <div class="card"><div class="stat">${db.users.filter(u => u.role === 'maitre').length}</div>Maîtres</div>
   <div class="card"><div class="stat">${db.eleves.length}</div>Pratiquants</div>
   <div class="card"><div class="stat">${db.activites.length}</div>Activités enregistrées</div>
  </div>
  <h2>Prochaines activités</h2>
  ${nextActs.length ? `<div class="grid">${nextActs.map(actCard).join('')}</div>` : '<p class="empty">Aucune activité programmée.</p>'}
  <h2>Siège de l'association</h2><div class="card">${esc(db.asso.siege)}<br>${esc(db.asso.tel)} ${esc(db.asso.email)}</div>`;
}

function pgAsso() {
  const masters = db.users.filter(u => u.role === 'maitre').sort((a, b) => (b.grade ?? -1) - (a.grade ?? -1));
  const a = isAdmin();
  return `<h1>L'association</h1><p class="sub">${esc(db.asso.nom)}</p>
  <div class="card"><dl><dt>Siège</dt><dd>${esc(db.asso.siege)}</dd><dt>Téléphone</dt><dd>${esc(db.asso.tel) || '—'}</dd><dt>Email</dt><dd>${esc(db.asso.email) || '—'}</dd><dt>Cotisation mensuelle des maîtres</dt><dd>${money(db.asso.cotMaitre)}</dd></dl>
  ${a ? '<p><button class="btn sm" data-a="editAsso">Modifier</button></p>' : ''}</div>
  <h2>Organigramme / Bureau ${a ? '<button class="btn sm" data-a="addBureau">+ Ajouter</button>' : ''}</h2>
  <table><tr><th>Poste</th><th>Nom</th>${a ? '<th></th>' : ''}</tr>${db.asso.bureau.map((b, i) => `<tr><td>${esc(b.poste)}</td><td>${esc(b.nom)}</td>${a ? `<td><button class="btn sm dng" data-a="delBureau" data-i="${i}">Retirer</button></td>` : ''}</tr>`).join('')}</table>
  <h2>Nos origines</h2>
  <div class="origins"><figure><img src="img/kori-hisataka.jpg" alt="Kori Hisataka"><figcaption><b>Kori Hisataka</b><br>Fondateur du Shorinjiryu Kenkokan</figcaption></figure>
  <figure><img src="img/masayuki-hisataka.jpg" alt="Masayuki Hisataka"><figcaption><b>Masayuki Hisataka</b><br>Chef de l'école (Shorinjiryu Kenkokan)</figcaption></figure></div>
  <h2>Classement hiérarchique des maîtres</h2>
  ${masters.length ? `<table><tr><th>#</th><th>Maître</th><th>Grade</th><th>Club</th></tr>${masters.map((m, i) => { const c = clubOf(m); return `<tr><td>${i + 1}</td><td>${esc(m.nom)}</td><td>${belt(m.grade)}</td><td>${c ? `<a href="#/club/${c.id}">${esc(c.nom)}</a>` : '—'}</td></tr>`; }).join('')}</table>` : '<p class="empty">Aucun maître enregistré.</p>'}
  <h2>Échelle des grades</h2>
  <div class="card ladder">${[...GRADES].reverse().map(g => `<div style="margin:4px 0">${belt(g.rang)}</div>`).join('')}</div>`;
}

const actTypes = [['examen', 'Examen de ceinture'], ['competition', 'Compétition'], ['demonstration', 'Démonstration'], ['stage', 'Stage'], ['autre', 'Autre']];
function actCard(a) {
  return `<div class="card"><span class="tag">${esc(actTypes.find(t => t[0] === a.type)?.[1] || a.type)}</span><h3>${esc(a.titre)}</h3>
  <div>📅 ${fmtD(a.date)} &nbsp; 📍 ${esc(a.lieu)}</div><p>${esc(a.desc)}</p>
  ${isAdmin() ? `<button class="btn sm dng" data-a="delAct" data-id="${a.id}">Supprimer</button>` : ''}</div>`;
}
function pgActs() {
  const l = [...db.activites].sort((a, b) => b.date.localeCompare(a.date));
  return `<div class="row"><div class="sp"><h1>Activités</h1><p class="sub">Examens de ceintures, compétitions, démonstrations…</p></div>${isAdmin() ? '<button class="btn" data-a="addAct">+ Nouvelle activité</button>' : ''}</div>
  ${l.length ? `<div class="grid">${l.map(actCard).join('')}</div>` : '<p class="empty">Aucune activité.</p>'}`;
}

function pgClubs() {
  return `<div class="row"><div class="sp"><h1>Les clubs</h1><p class="sub">Chaque club possède un matricule et un espace dédié.</p></div></div>
  ${db.clubs.length ? `<div class="grid">${db.clubs.map(c => `<div class="card"><span class="tag mono">${c.matricule}</span><h3>${esc(c.nom)}</h3>
   <div>📍 ${esc(c.ville)}</div><div>👤 ${esc(user(c.maitreId)?.nom || 'Maître à désigner')}</div><p><a class="btn sm" href="#/club/${c.id}">Fiche & prospectus</a>
   ${canClub(c.id) ? `<a class="btn sm alt" href="#/espace/${c.id}">Espace du club</a>` : ''}</p></div>`).join('')}</div>` : '<p class="empty">Aucun club enregistré.</p>'}`;
}

function pgClub(id) {
  const c = club(id); if (!c) return '<p class="empty">Club introuvable.</p>';
  const m = user(c.maitreId), p = c.prospectus || {};
  return `<div class="row noprint"><a href="#/clubs">← Clubs</a><span class="sp"></span>${canClub(id) ? `<a class="btn sm" href="#/espace/${id}">Espace du club</a>` : ''}<button class="btn sm alt" onclick="print()">Imprimer</button></div>
  <h1>${esc(c.nom)} <span class="tag mono">${c.matricule}</span></h1>
  <h2>Fiche de renseignement</h2>
  <div class="card"><dl><dt>Matricule</dt><dd>${c.matricule}</dd><dt>Nom du club</dt><dd>${esc(c.nom)}</dd><dt>Ville / Adresse</dt><dd>${esc(c.ville)} – ${esc(c.adresse)}</dd>
  <dt>Maître responsable</dt><dd>${esc(m?.nom || '—')} ${m ? belt(m.grade) : ''}</dd><dt>Contact</dt><dd>${esc(c.tel) || '—'} ${esc(c.email)}</dd>
  <dt>Date de création</dt><dd>${fmtD(c.creation)}</dd><dt>Effectif</dt><dd>${clubElevesOf(id).length} pratiquant(s)</dd></dl></div>
  <h2>Prospectus d'information</h2>
  <div class="prospectus"><h3 style="margin-top:0">${esc(c.nom)} – Rejoignez-nous !</h3>
  <dl><dt>Inscriptions</dt><dd>${esc(p.inscription) || '—'}</dd><dt>Jours & horaires d'entraînement</dt><dd>${esc(p.jours) || '—'}</dd>
  <dt>Prix des passages de grade</dt><dd>${esc(p.prixGrades) || '—'}</dd><dt>Cotisation mensuelle élève</dt><dd>${c.cotEleve ? money(c.cotEleve) : '—'}</dd>
  <dt>Siège du club</dt><dd>${esc(c.adresse)}, ${esc(c.ville)}</dd><dt>Siège de l'association</dt><dd>${esc(db.asso.siege)}</dd></dl></div>`;
}

/* ---------- Espace du club (privé) ---------- */
function pgEspace(id) {
  const c = club(id); if (!c) return '<p class="empty">Club introuvable.</p>';
  if (!canClub(id)) return denied();
  const tabs = [['eleves', 'Élèves'], ['paiements', 'Paiements mensuels'], ['presences', 'Présences'], ['infos', 'Infos & prospectus']];
  let body = '';
  const els = clubElevesOf(id).sort((a, b) => a.nom.localeCompare(b.nom));
  if (S.tab === 'eleves') {
    body = `<div class="row"><span class="sp"></span><button class="btn" data-a="addEleve" data-id="${id}">+ Nouveau pratiquant</button></div>
    ${els.length ? `<div class="scroll"><table><tr><th></th><th>Nom</th><th>Grade</th><th>Début karaté</th><th></th></tr>${els.map(e => `<tr><td>${e.photo ? `<img src="${e.photo}" style="width:36px;height:44px;object-fit:cover;border-radius:4px">` : '👤'}</td>
    <td>${esc(e.nom)} ${esc(e.prenoms)}</td><td>${belt(gradeOf(e))}</td><td>${fmtD(e.debut)}</td><td><a class="btn sm" href="#/eleve/${e.id}">Fiche</a></td></tr>`).join('')}</table></div>` : '<p class="empty">Aucun pratiquant.</p>'}`;
  } else if (S.tab === 'paiements') {
    const paid = els.filter(e => e.pay?.[S.month]).length;
    body = `<div class="row"><label style="margin:0">Mois</label><input type="month" style="width:auto" value="${S.month}" data-c="month"><span class="sp"></span><span>Cotisation : <b>${money(c.cotEleve)}</b></span></div>
    <p>Payé : <b class="pos">${paid}</b> / ${els.length} &nbsp;•&nbsp; Encaissé : <b>${money(paid * (c.cotEleve || 0))}</b> &nbsp;•&nbsp; Impayés : <b class="neg">${els.length - paid}</b></p>
    <table><tr><th>Élève</th><th>État</th><th>Payé ?</th></tr>${els.map(e => `<tr><td>${esc(e.nom)} ${esc(e.prenoms)}</td><td>${e.pay?.[S.month] ? '<span class="tag ok">Payé</span>' : '<span class="tag no">Non payé</span>'}</td>
    <td><input type="checkbox" data-c="pay" data-id="${e.id}" ${e.pay?.[S.month] ? 'checked' : ''}></td></tr>`).join('') || '<tr><td colspan=3 class="empty">Aucun élève</td></tr>'}</table>`;
  } else if (S.tab === 'presences') {
    const seances = (c.seances || []).filter(d => d.startsWith(S.month)).sort();
    body = `<div class="row"><label style="margin:0">Mois</label><input type="month" style="width:auto" value="${S.month}" data-c="month"><span class="sp"></span><button class="btn" data-a="addSeance" data-id="${id}">+ Séance</button></div>
    ${seances.length ? `<div class="scroll"><table><tr><th>Élève</th>${seances.map(d => `<th class="cell">${d.slice(8)}<br><a data-a="delSeance" data-id="${id}" data-d="${d}" style="cursor:pointer;color:#a11" title="Supprimer la séance">×</a></th>`).join('')}<th>Taux</th></tr>
    ${els.map(e => { const n = seances.filter(d => c.presence?.[d]?.includes(e.id)).length; return `<tr><td>${esc(e.nom)} ${esc(e.prenoms)}</td>${seances.map(d => `<td class="cell"><input type="checkbox" data-c="pres" data-id="${e.id}" data-club="${id}" data-d="${d}" ${c.presence?.[d]?.includes(e.id) ? 'checked' : ''}></td>`).join('')}<td><b>${Math.round(100 * n / seances.length)}%</b></td></tr>`; }).join('')}</table></div>` : '<p class="empty">Aucune séance ce mois-ci. Ajoutez la date d\'un entraînement.</p>'}`;
  } else {
    const p = c.prospectus || {};
    body = `<div class="card"><dl><dt>Matricule</dt><dd>${c.matricule}</dd><dt>Nom</dt><dd>${esc(c.nom)}</dd><dt>Ville</dt><dd>${esc(c.ville)}</dd><dt>Adresse / siège du club</dt><dd>${esc(c.adresse)}</dd>
    <dt>Téléphone / Email</dt><dd>${esc(c.tel)} ${esc(c.email)}</dd><dt>Création</dt><dd>${fmtD(c.creation)}</dd><dt>Cotisation élève</dt><dd>${money(c.cotEleve)}</dd>
    <dt>Inscriptions</dt><dd>${esc(p.inscription) || '—'}</dd><dt>Jours d'entraînement</dt><dd>${esc(p.jours) || '—'}</dd><dt>Prix passages de grade</dt><dd>${esc(p.prixGrades) || '—'}</dd></dl>
    <p><button class="btn" data-a="editClub" data-id="${id}">Modifier la fiche & le prospectus</button> <a class="btn alt" href="#/club/${id}">Voir la page publique</a></p></div>`;
  }
  return `<h1>Espace – ${esc(c.nom)} <span class="tag mono">${c.matricule}</span></h1><p class="sub">Réservé au maître du club et à l'administrateur général.</p>
  <div class="tabs">${tabs.map(([k, l]) => `<a data-a="tab" data-k="${k}" class="${S.tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>${body}`;
}

/* ---------- Fiche élève ---------- */
const eleveFields = [
  { n: 'nom', l: 'Nom', req: 1 }, { n: 'prenoms', l: 'Prénoms', req: 1 }, { n: 'photo', l: 'Photo', t: 'file' },
  { n: 'naissDate', l: 'Date de naissance', t: 'date' }, { n: 'naissLieu', l: 'Lieu de naissance' },
  { n: 'debut', l: 'Date de début du karaté', t: 'date' }, { n: 'contact', l: 'Contact (téléphone / parent)' }
];
function pgEleve(id) {
  const e = eleve(id); if (!e) return '<p class="empty">Fiche introuvable.</p>';
  if (!canClub(e.clubId)) return denied();
  const c = club(e.clubId), m = user(c.maitreId);
  const grades = [...e.grades].sort((a, b) => a.date.localeCompare(b.date));
  const months = Object.keys(e.pay || {}).filter(k => e.pay[k]).length;
  let seancesN = 0, presN = 0; Object.entries(c.presence || {}).forEach(([d, l]) => { seancesN++; if (l.includes(e.id)) presN++; });
  return `<div class="row noprint"><a href="#/espace/${c.id}">← Espace du club</a><span class="sp"></span><button class="btn sm alt" onclick="print()">Imprimer</button>
   <button class="btn sm" data-a="editEleve" data-id="${id}">Modifier</button><button class="btn sm dng" data-a="delEleve" data-id="${id}">Supprimer</button></div>
  <h1>Fiche du pratiquant</h1>
  <div class="card fiche">${e.photo ? `<img class="photo" src="${e.photo}">` : '<div class="ph0">👤</div>'}
  <dl><dt>Nom & prénoms</dt><dd><b>${esc(e.nom)} ${esc(e.prenoms)}</b></dd><dt>Né(e) le</dt><dd>${fmtD(e.naissDate)} à ${esc(e.naissLieu) || '—'}</dd>
  <dt>Début du karaté</dt><dd>${fmtD(e.debut)}</dd><dt>Grade actuel</dt><dd>${belt(gradeOf(e))} ${gradeDate(e) ? '(depuis le ' + fmtD(gradeDate(e)) + ')' : ''}</dd>
  <dt>Club</dt><dd>${esc(c.nom)} <span class="tag mono">${c.matricule}</span></dd><dt>Maître</dt><dd>${esc(m?.nom || '—')}</dd><dt>Contact</dt><dd>${esc(e.contact) || '—'}</dd>
  <dt>Cotisations payées</dt><dd>${months} mois enregistré(s)</dd><dt>Assiduité</dt><dd>${seancesN ? Math.round(100 * presN / seancesN) + '% (' + presN + '/' + seancesN + ' séances)' : '—'}</dd></dl></div>
  <h2>Grades & dates de passage <button class="btn sm noprint" data-a="addGrade" data-id="${id}">+ Grade</button></h2>
  <table><tr><th>Grade</th><th>Date de passage</th><th class="noprint"></th></tr>${grades.map(g => `<tr><td>${belt(+g.grade)}</td><td>${fmtD(g.date)}</td><td class="noprint"><button class="btn sm dng" data-a="delGrade" data-id="${id}" data-g="${g.id}">×</button></td></tr>`).join('') || '<tr><td colspan=3 class="empty">Aucun grade</td></tr>'}</table>
  <h2>Prix & distinctions <button class="btn sm noprint" data-a="addPrix" data-id="${id}">+ Prix</button></h2>
  <table><tr><th>Distinction</th><th>Compétition</th><th>Date</th><th class="noprint"></th></tr>${(e.prix || []).map(p => `<tr><td>🏆 ${esc(p.titre)}</td><td>${esc(p.comp)}</td><td>${fmtD(p.date)}</td><td class="noprint"><button class="btn sm dng" data-a="delPrix" data-id="${id}" data-g="${p.id}">×</button></td></tr>`).join('') || '<tr><td colspan=4 class="empty">Aucun prix</td></tr>'}</table>
  <h2>Bilan moral et de conduite <button class="btn sm noprint" data-a="editBilan" data-id="${id}">Modifier</button></h2>
  <div class="card">${esc(e.bilan) || '<span class="empty">Non renseigné.</span>'}</div>`;
}

/* ---------- Finances ---------- */
function pgFin() {
  const a = isAdmin(), f = [...db.finances].sort((x, y) => y.date.localeCompare(x.date));
  const rec = f.filter(x => x.type === 'recette').reduce((s, x) => s + +x.montant, 0), dep = f.filter(x => x.type === 'depense').reduce((s, x) => s + +x.montant, 0);
  const masters = db.users.filter(u => u.role === 'maitre'), y = S.year;
  return `<h1>Finances de l'association</h1><p class="sub">Gestion transparente : toutes les opérations sont consultables.</p>
  <div class="grid"><div class="card"><div class="stat pos">${money(rec)}</div>Recettes</div><div class="card"><div class="stat neg">${money(dep)}</div>Dépenses</div><div class="card"><div class="stat">${money(rec - dep)}</div>Solde</div></div>
  <h2>Journal des opérations ${a ? '<button class="btn sm" data-a="addFin">+ Opération</button>' : ''}</h2>
  <div class="scroll"><table><tr><th>Date</th><th>Libellé</th><th>Type</th><th>Montant</th>${a ? '<th></th>' : ''}</tr>${f.map(x => `<tr><td>${fmtD(x.date)}</td><td>${esc(x.libelle)}</td><td><span class="tag ${x.type === 'recette' ? 'ok' : 'no'}">${x.type}</span></td>
  <td class="${x.type === 'recette' ? 'pos' : 'neg'}">${x.type === 'recette' ? '+' : '−'} ${money(x.montant)}</td>${a ? `<td><button class="btn sm dng" data-a="delFin" data-id="${x.id}">×</button></td>` : ''}</tr>`).join('') || '<tr><td colspan=5 class="empty">Aucune opération</td></tr>'}</table></div>
  <h2>Cotisations mensuelles des maîtres (${money(db.asso.cotMaitre)} / mois)</h2>
  <div class="row"><button class="btn sm alt" data-a="yr" data-d="-1">◀</button><b>${y}</b><button class="btn sm alt" data-a="yr" data-d="1">▶</button>${a ? '<span class="noprint">— cliquez sur une case pour changer l\'état</span>' : ''}</div>
  ${masters.length ? `<div class="scroll"><table><tr><th>Maître</th>${MOIS.map(m => `<th class="cell">${m.slice(0, 3)}</th>`).join('')}<th>À jour ?</th></tr>${masters.map(m => {
    const cells = MOIS.map((_, i) => { const k = `${y}-${String(i + 1).padStart(2, '0')}`, ok = m.cot?.[k]; return `<td class="cell" ${a ? `data-a="cot" data-id="${m.id}" data-k="${k}"` : ''}>${ok ? '<span class="pos">✔</span>' : '<span class="neg">✘</span>'}</td>`; }).join('');
    const now = thisMonth(), upTo = y < +now.slice(0, 4) ? 12 : y > +now.slice(0, 4) ? 0 : +now.slice(5);
    const due = MOIS.slice(0, upTo).filter((_, i) => !m.cot?.[`${y}-${String(i + 1).padStart(2, '0')}`]).length;
    return `<tr><td>${esc(m.nom)}</td>${cells}<td>${due ? `<span class="tag no">${due} mois dû(s)</span>` : '<span class="tag ok">À jour</span>'}</td></tr>`;
  }).join('')}</table></div>` : '<p class="empty">Aucun maître.</p>'}`;
}

/* ---------- Connexion / Administration ---------- */
function pgLogin() {
  return `<div class="card" style="max-width:420px;margin:30px auto"><h2 style="margin-top:0">Connexion</h2><form id="lf">
  <label>Identifiant</label><input name="l" required autocomplete="username"><label>Mot de passe</label><input type="password" name="p" required autocomplete="current-password">
  <p><button class="btn">Se connecter</button></p><p id="lerr" class="neg"></p></form>
  <p class="sub">Réservé aux maîtres de club et à l'administrateur général.</p></div>`;
}

function pgAdmin() {
  if (!isAdmin()) return denied();
  const tabs = [['clubs', 'Clubs'], ['maitres', 'Maîtres'], ['examens', 'Examens de grade'], ['data', 'Données']];
  let b = '';
  if (S.atab === 'clubs') b = `<div class="row"><span class="sp"></span><button class="btn" data-a="addClub">+ Nouveau club</button></div>
    <table><tr><th>Matricule</th><th>Club</th><th>Maître</th><th>Élèves</th><th></th></tr>${db.clubs.map(c => `<tr><td><span class="tag mono">${c.matricule}</span></td><td>${esc(c.nom)}</td><td>${esc(user(c.maitreId)?.nom || '—')}</td><td>${clubElevesOf(c.id).length}</td>
    <td><a class="btn sm" href="#/espace/${c.id}">Espace</a> <button class="btn sm alt" data-a="adminClub" data-id="${c.id}">Modifier</button> <button class="btn sm dng" data-a="delClub" data-id="${c.id}">Supprimer</button></td></tr>`).join('') || '<tr><td colspan=5 class="empty">Aucun club</td></tr>'}</table>`;
  else if (S.atab === 'maitres') b = `<div class="row"><span class="sp"></span><button class="btn" data-a="addMaitre">+ Nouveau maître (compte)</button></div>
    <table><tr><th>Nom</th><th>Identifiant</th><th>Grade</th><th>Club</th><th></th></tr>${db.users.map(u => `<tr><td>${esc(u.nom)}</td><td>${esc(u.login)}</td><td>${u.role === 'admin' ? '<span class="tag">Admin</span>' : belt(u.grade)}</td><td>${esc(clubOf(u)?.nom || '—')}</td>
    <td><button class="btn sm alt" data-a="editMaitre" data-id="${u.id}">Modifier</button> ${u.id !== 'u_admin' ? `<button class="btn sm dng" data-a="delMaitre" data-id="${u.id}">Supprimer</button>` : ''}</td></tr>`).join('')}</table>`;
  else if (S.atab === 'examens') b = examPanel();
  else b = `<div class="card"><h3>Sauvegarde</h3><p>Les données sont dans la base du serveur (dossier <code>data/</code>). Copiez ce dossier régulièrement ; l'export JSON ci-dessous est une copie lisible des données visibles.</p>
    <button class="btn" data-a="export">Exporter (JSON)</button>
    <h3>Démonstration</h3><p>Ajoute un club, un maître et des élèves d'exemple (identifiant <code>maitre1</code>, mot de passe <code>maitre2026</code>).</p><button class="btn alt" data-a="demo">Charger les données de démonstration</button></div>`;
  return `<h1>Administration</h1><div class="notice">⚠ Changez le mot de passe de l'administrateur (onglet Maîtres → Modifier) dès la première connexion.</div>
  <div class="tabs">${tabs.map(([k, l]) => `<a data-a="atab" data-k="${k}" class="${S.atab === k ? 'on' : ''}">${l}</a>`).join('')}</div>${b}`;
}

/* ---------- Formulaires métier ---------- */
const clubFields = [{ n: 'nom', l: 'Nom du club', req: 1 }, { n: 'ville', l: 'Ville', req: 1 }, { n: 'adresse', l: 'Adresse / siège du club' }, { n: 'tel', l: 'Téléphone' }, { n: 'email', l: 'Email' },
  { n: 'creation', l: 'Date de création', t: 'date' }, { n: 'cotEleve', l: 'Cotisation mensuelle élève (FCFA)', t: 'number' },
  { n: 'inscription', l: 'Inscriptions (conditions, frais, pièces…)', t: 'textarea' }, { n: 'jours', l: 'Jours et horaires d\'entraînement', t: 'textarea' }, { n: 'prixGrades', l: 'Prix des passages de grade', t: 'textarea' }];
const maitreOpts = () => [['', '— aucun —'], ...db.users.filter(u => u.role === 'maitre').map(u => [u.id, u.nom])];
function applyClub(c, o) {
  Object.assign(c, { nom: o.nom, ville: o.ville, adresse: o.adresse, tel: o.tel, email: o.email, creation: o.creation, cotEleve: +o.cotEleve || 0 });
  c.prospectus = { inscription: o.inscription, jours: o.jours, prixGrades: o.prixGrades };
}
const clubVals = c => ({ ...c, ...(c.prospectus || {}) });

/* ---------- Actions (clics) ---------- */
/* ---------- Examens de grade (admin) ---------- */
const EX_CRIT = [['kihon', 'Kihon', 15], ['kata', 'Kata', 15], ['shiai', 'Shiai', 15], ['kumite', 'Kumité', 15], ['aptitude', 'Aptitude', 10], ['conduite', 'Conduite', 10], ['plie', 'Plié karatégi', 5], ['chute', 'Chute', 5], ['anglais', 'Anglais', 5], ['oral', 'Oral', 5]];
const exTotal = c => Math.round(EX_CRIT.reduce((s, [k]) => s + (+c.notes?.[k] || 0), 0) * 100) / 100;
const exResult = (c, ex) => exTotal(c) >= (+ex.seuil || 50) ? '<span class="tag ok">Admis</span>' : '<span class="tag no">Refusé</span>';
function examPanel() {
  const ex = db.examens.find(x => x.id === S.exam);
  if (!ex) return `<div class="row"><span class="sp"></span><button class="btn" data-a="addExam">+ Nouvelle session d'examen</button></div>
    <table><tr><th>Session</th><th>Date</th><th>Lieu</th><th>Candidats</th><th></th></tr>${[...db.examens].sort((a, b) => b.date.localeCompare(a.date)).map(x => `<tr><td>${esc(x.titre)}</td><td>${fmtD(x.date)}</td><td>${esc(x.lieu)}</td><td>${x.cands.length}</td>
    <td><button class="btn sm" data-a="openExam" data-id="${x.id}">Ouvrir</button> <button class="btn sm dng" data-a="delExam" data-id="${x.id}">Supprimer</button></td></tr>`).join('') || '<tr><td colspan=5 class="empty">Aucune session</td></tr>'}</table>`;
  const ranked = [...ex.cands].sort((a, b) => exTotal(b) - exTotal(a));
  return `<div class="row noprint"><a data-a="openExam" data-id="" style="cursor:pointer">← Sessions</a><span class="sp"></span><button class="btn sm" data-a="addCand">+ Candidat</button>
    <button class="btn sm alt" data-a="applyExam">Enregistrer les grades des admis</button><button class="btn sm alt" onclick="print()">Imprimer</button></div>
  <h3>${esc(ex.titre)} – ${fmtD(ex.date)} – ${esc(ex.lieu)}</h3><p class="sub">Notes sur 100 (Kihon, Kata, Shiai, Kumité /15 · Aptitude, Conduite /10 · Plié karatégi, Chute, Anglais, Oral /5). Admis à partir de <b>${+ex.seuil || 50}</b> / 100 <a class="noprint" data-a="seuil" style="cursor:pointer">(modifier)</a>. Le classement se met à jour à la réouverture de la page.</p>
  <div class="scroll"><table><tr><th>#</th><th>Candidat</th><th>Ancien grade</th>${EX_CRIT.map(([, l, m]) => `<th>${l}<br>/${m}</th>`).join('')}<th>Total</th><th>Résultat</th><th>Nouveau grade</th><th></th></tr>
  ${ranked.map((c, i) => `<tr data-cand="${c.id}"><td>${i + 1}</td><td>${esc(c.nom)}</td><td>${belt(c.ancien)}</td>${EX_CRIT.map(([k, , m]) => `<td><input class="sc" type="number" step="0.25" min="0" max="${m}" data-c="note" data-id="${c.id}" data-k="${k}" value="${c.notes?.[k] ?? ''}"></td>`).join('')}
  <td class="tot"><b>${exTotal(c)}</b></td><td class="res">${exResult(c, ex)}</td><td><select data-c="newg" data-id="${c.id}"><option value="">—</option>${gradeOpts.map(([k, l]) => `<option value="${k}" ${c.nouveau !== '' && c.nouveau != null && +c.nouveau === +k ? 'selected' : ''}>${l.replace('Ceinture ', '')}</option>`).join('')}</select></td>
  <td><button class="btn sm dng noprint" data-a="delCand" data-id="${c.id}">×</button></td></tr>`).join('') || `<tr><td colspan=${EX_CRIT.length + 7} class="empty">Aucun candidat</td></tr>`}</table></div>`;
}
const curExam = () => db.examens.find(x => x.id === S.exam);
const A = {
  close: () => $('#dlg').close(),
  logout: async () => { await api('logout'); await loadState(); go('#/'); rerender(); },
  tab: d => { S.tab = d.k; rerender(); },
  atab: d => { S.atab = d.k; rerender(); },
  yr: d => { S.year += +d.d; rerender(); },
  editAsso: () => openForm('Association', [{ n: 'nom', l: 'Nom' }, { n: 'siege', l: 'Siège' }, { n: 'tel', l: 'Téléphone' }, { n: 'email', l: 'Email' }, { n: 'cotMaitre', l: 'Cotisation mensuelle des maîtres', t: 'number' }], db.asso,
    o => { Object.assign(db.asso, { ...o, cotMaitre: +o.cotMaitre || 0 }); save(); rerender(); }),
  addBureau: () => openForm('Membre du bureau', [{ n: 'poste', l: 'Poste', req: 1 }, { n: 'nom', l: 'Nom', req: 1 }], {}, o => { db.asso.bureau.push(o); save(); rerender(); }),
  delBureau: d => { db.asso.bureau.splice(+d.i, 1); save(); rerender(); },
  addAct: () => openForm('Nouvelle activité', [{ n: 'type', l: 'Type', t: 'select', opts: actTypes }, { n: 'titre', l: 'Titre', req: 1 }, { n: 'date', l: 'Date', t: 'date', req: 1 }, { n: 'lieu', l: 'Lieu' }, { n: 'desc', l: 'Description', t: 'textarea' }], {},
    o => { db.activites.push({ id: uid(), ...o }); save(); rerender(); }),
  delAct: d => confirmDo('Supprimer cette activité ?', () => { db.activites = db.activites.filter(a => a.id !== d.id); save(); rerender(); }),
  addFin: () => openForm('Opération financière', [{ n: 'date', l: 'Date', t: 'date', req: 1, def: new Date().toISOString().slice(0, 10) }, { n: 'type', l: 'Type', t: 'select', opts: [['recette', 'Recette'], ['depense', 'Dépense']] }, { n: 'libelle', l: 'Libellé', req: 1 }, { n: 'montant', l: 'Montant (FCFA)', t: 'number', req: 1 }], {},
    o => { db.finances.push({ id: uid(), ...o, montant: +o.montant }); save(); rerender(); }),
  delFin: d => confirmDo('Supprimer cette opération ?', () => { db.finances = db.finances.filter(f => f.id !== d.id); save(); rerender(); }),
  cot: d => { const u = user(d.id); u.cot = u.cot || {}; u.cot[d.k] = !u.cot[d.k]; save(); rerender(); },

  /* clubs */
  addClub: () => openForm('Nouveau club', [...clubFields, { n: 'maitreId', l: 'Maître responsable', t: 'select', opts: maitreOpts() }], {}, o => {
    const c = { id: uid(), matricule: nextMatricule(), maitreId: o.maitreId, seances: [], presence: {} }; applyClub(c, o); db.clubs.push(c); save(); rerender();
  }),
  adminClub: d => { const c = club(d.id); openForm('Modifier le club ' + c.matricule, [...clubFields, { n: 'maitreId', l: 'Maître responsable', t: 'select', opts: maitreOpts() }], { ...clubVals(c), maitreId: c.maitreId }, o => { applyClub(c, o); c.maitreId = o.maitreId; save(); rerender(); }); },
  editClub: d => { const c = club(d.id); openForm('Fiche du club', clubFields, clubVals(c), o => { applyClub(c, o); save(); rerender(); }); },
  delClub: d => confirmDo('Supprimer ce club ET tous ses élèves ?', () => { db.clubs = db.clubs.filter(c => c.id !== d.id); db.eleves = db.eleves.filter(e => e.clubId !== d.id); save(); rerender(); }),

  /* maîtres */
  addMaitre: () => openForm('Nouveau maître', [{ n: 'nom', l: 'Nom complet', req: 1 }, { n: 'login', l: 'Identifiant', req: 1 }, { n: 'pw', l: 'Mot de passe', t: 'password', req: 1 }, { n: 'grade', l: 'Grade', t: 'select', opts: gradeOpts, def: 10 }], {}, async o => {
    if (db.users.some(u => u.login === o.login)) return alert('Identifiant déjà utilisé.');
    db.users.push({ id: uid(), login: o.login, pw: o.pw, role: 'maitre', nom: o.nom, grade: +o.grade, cot: {} }); save(); rerender();
  }),
  editMaitre: d => { const u = user(d.id); openForm('Modifier ' + u.nom, [{ n: 'nom', l: 'Nom', req: 1 }, { n: 'login', l: 'Identifiant', req: 1 }, { n: 'pw', l: 'Nouveau mot de passe (laisser vide = inchangé)', t: 'password' }, ...(u.role === 'maitre' ? [{ n: 'grade', l: 'Grade', t: 'select', opts: gradeOpts }] : [])], u, async o => {
    u.nom = o.nom; u.login = o.login; if (o.grade !== undefined) u.grade = +o.grade; if (o.pw) u.pw = o.pw; save(); rerender();
  }); },
  delMaitre: d => confirmDo('Supprimer ce compte ?', () => { db.clubs.forEach(c => { if (c.maitreId === d.id) c.maitreId = ''; }); db.users = db.users.filter(u => u.id !== d.id); save(); rerender(); }),

  /* élèves */
  addEleve: d => openForm('Nouveau pratiquant', [...eleveFields, { n: 'grade', l: 'Grade actuel', t: 'select', opts: gradeOpts }, { n: 'gdate', l: 'Date d\'obtention du grade', t: 'date' }], {}, o => {
    const e = { id: uid(), clubId: d.id, nom: o.nom, prenoms: o.prenoms, photo: o.photo, naissDate: o.naissDate, naissLieu: o.naissLieu, debut: o.debut, contact: o.contact, grades: [{ id: uid(), grade: +o.grade, date: o.gdate || o.debut || '' }], prix: [], bilan: '', pay: {} };
    db.eleves.push(e); save(); go('#/eleve/' + e.id);
  }),
  editEleve: d => { const e = eleve(d.id); openForm('Modifier la fiche', eleveFields, e, o => { const ph = o.photo || e.photo; Object.assign(e, o, { photo: ph }); save(); rerender(); }); },
  delEleve: d => confirmDo('Supprimer définitivement cette fiche ?', () => { const e = eleve(d.id); db.eleves = db.eleves.filter(x => x.id !== d.id); save(); go('#/espace/' + e.clubId); }),
  addGrade: d => openForm('Passage de grade', [{ n: 'grade', l: 'Grade obtenu', t: 'select', opts: gradeOpts }, { n: 'date', l: 'Date de passage', t: 'date', req: 1 }], {}, o => { eleve(d.id).grades.push({ id: uid(), grade: +o.grade, date: o.date }); save(); rerender(); }),
  delGrade: d => { const e = eleve(d.id); e.grades = e.grades.filter(g => g.id !== d.g); save(); rerender(); },
  addPrix: d => openForm('Prix remporté', [{ n: 'titre', l: 'Distinction (ex : 1re place kumité –60 kg)', req: 1 }, { n: 'comp', l: 'Compétition' }, { n: 'date', l: 'Date', t: 'date' }], {}, o => { const e = eleve(d.id); (e.prix = e.prix || []).push({ id: uid(), ...o }); save(); rerender(); }),
  delPrix: d => { const e = eleve(d.id); e.prix = e.prix.filter(p => p.id !== d.g); save(); rerender(); },
  editBilan: d => { const e = eleve(d.id); openForm('Bilan moral et de conduite', [{ n: 'bilan', l: 'Appréciation du maître', t: 'textarea' }], e, o => { e.bilan = o.bilan; save(); rerender(); }); },

  /* présences */
  addSeance: d => openForm('Nouvelle séance', [{ n: 'date', l: 'Date de l\'entraînement', t: 'date', req: 1, def: new Date().toISOString().slice(0, 10) }], {}, o => {
    const c = club(d.id); c.seances = c.seances || []; if (!c.seances.includes(o.date)) c.seances.push(o.date); S.month = o.date.slice(0, 7); save(); rerender();
  }),
  delSeance: d => confirmDo('Supprimer cette séance ?', () => { const c = club(d.id); c.seances = c.seances.filter(x => x !== d.d); delete c.presence?.[d.d]; save(); rerender(); }),

  /* examens */
  addExam: () => openForm("Nouvelle session d'examen", [{ n: 'titre', l: 'Intitulé', req: 1, def: 'Examen de passage de grade' }, { n: 'date', l: 'Date', t: 'date', req: 1 }, { n: 'lieu', l: 'Lieu' }, { n: 'seuil', l: 'Total minimum pour être admis (/100)', t: 'number', def: 50 }], {},
    o => { const x = { id: uid(), ...o, seuil: +o.seuil || 50, cands: [] }; db.examens.push(x); S.exam = x.id; save(); rerender(); }),
  openExam: d => { S.exam = d.id || null; rerender(); },
  delExam: d => confirmDo('Supprimer cette session ?', () => { db.examens = db.examens.filter(x => x.id !== d.id); save(); rerender(); }),
  seuil: () => { const x = curExam(); const v = prompt('Total minimum pour être admis (/100) :', x.seuil || 50); if (v !== null && +v > 0) { x.seuil = +v; save(); rerender(); } },
  addCand: () => openForm('Ajouter un candidat', [{ n: 'eleveId', l: 'Pratiquant enregistré', t: 'select', opts: [['', '— saisie libre —'], ...[...db.eleves].sort((a, b) => a.nom.localeCompare(b.nom)).map(e => [e.id, `${e.nom} ${e.prenoms} (${club(e.clubId)?.matricule || '?'})`])] }, { n: 'nom', l: 'Nom et prénoms (si saisie libre)' }, { n: 'ancien', l: 'Ancien grade (si saisie libre)', t: 'select', opts: [['', '—'], ...gradeOpts] }], {}, o => {
    const e = eleve(o.eleveId); if (!e && !o.nom.trim()) return alert('Choisissez un pratiquant ou saisissez un nom.');
    curExam().cands.push({ id: uid(), eleveId: e ? e.id : '', nom: e ? `${e.nom} ${e.prenoms}` : o.nom.trim(), ancien: e ? gradeOf(e) : (o.ancien === '' ? null : +o.ancien), notes: {}, nouveau: '' }); save(); rerender();
  }),
  delCand: d => { const x = curExam(); x.cands = x.cands.filter(c => c.id !== d.id); save(); rerender(); },
  applyExam: () => {
    const x = curExam(); let n = 0;
    x.cands.forEach(c => {
      const e = eleve(c.eleveId); if (!e || c.nouveau === '' || c.nouveau == null || exTotal(c) < (+x.seuil || 50)) return;
      if (!e.grades.some(g => +g.grade === +c.nouveau && g.date === x.date)) { e.grades.push({ id: uid(), grade: +c.nouveau, date: x.date }); n++; }
    });
    save(); alert(n + ' grade(s) enregistré(s) dans les fiches des pratiquants (admis avec un nouveau grade choisi).'); rerender();
  },
  /* données */
  export: () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' })); a.download = 'aishorink-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); },
  demo: async () => {
    const m = { id: uid(), login: 'maitre1', pw: 'maitre2026', role: 'maitre', nom: 'Maître Kouassi Jean', grade: 14, cot: {} };
    const c = { id: uid(), matricule: nextMatricule(), nom: 'Club Exemple de Cocody', ville: 'Abidjan', adresse: 'Cocody, Gymnase municipal', tel: '07 00 00 00 00', email: '', creation: '2015-01-10', cotEleve: 3000, maitreId: m.id, seances: [], presence: {},
      prospectus: { inscription: 'Inscription : 5 000 FCFA, 2 photos, certificat médical.', jours: 'Mardi et Jeudi 18h–20h, Samedi 9h–11h', prixGrades: 'Ceintures de couleur : 5 000 FCFA – Ceinture noire : 25 000 FCFA' } };
    db.users.push(m); db.clubs.push(c);
    [['Konan', 'Awa', 2], ['Traoré', 'Ibrahim', 5], ['Yao', 'Marc', 0]].forEach(([n, p, g]) => db.eleves.push({ id: uid(), clubId: c.id, nom: n, prenoms: p, photo: null, naissDate: '2008-05-12', naissLieu: 'Abidjan', debut: '2019-09-01', contact: '', grades: [{ id: uid(), grade: g, date: '2023-06-20' }], prix: [], bilan: 'Élève assidu et respectueux.', pay: {} }));
    db.activites.push({ id: uid(), type: 'examen', titre: 'Examen de ceintures – session de fin d\'année', date: '2026-12-19', lieu: 'Abidjan', desc: 'Passage de grades pour tous les clubs.' });
    save(); rerender();
  }
};

document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-a]'); if (!t) return;
  const f = A[t.dataset.a]; if (f) { ev.preventDefault(); f(t.dataset); }
});
document.addEventListener('change', async ev => {
  const t = ev.target, c = t.dataset.c; if (!c) return;
  if (c === 'note' || c === 'newg') {
    const ex = curExam(), cd = ex.cands.find(x => x.id === t.dataset.id);
    if (c === 'newg') cd.nouveau = t.value === '' ? '' : +t.value;
    else { cd.notes = cd.notes || {}; cd.notes[t.dataset.k] = t.value === '' ? '' : Math.min(+t.value, +t.max); t.value = cd.notes[t.dataset.k]; const r = t.closest('tr'); r.querySelector('.tot').innerHTML = '<b>' + exTotal(cd) + '</b>'; r.querySelector('.res').innerHTML = exResult(cd, ex); }
    save();
  } else if (c === 'month') { S.month = t.value || thisMonth(); rerender(); }
  else if (c === 'pay') { const e = eleve(t.dataset.id); e.pay = e.pay || {}; e.pay[S.month] = t.checked; save(); rerender(); }
  else if (c === 'pres') {
    const cl = club(t.dataset.club), d = t.dataset.d; cl.presence = cl.presence || {}; const l = cl.presence[d] = cl.presence[d] || [];
    const i = l.indexOf(t.dataset.id); if (t.checked && i < 0) l.push(t.dataset.id); if (!t.checked && i >= 0) l.splice(i, 1); save(); rerender();
  }
});
document.addEventListener('submit', async ev => {
  if (ev.target.id !== 'lf') return;
  ev.preventDefault();
  try { await api('login', { login: ev.target.l.value.trim(), password: ev.target.p.value }); }
  catch (e) { $('#lerr').textContent = e.message; return; }
  await loadState();
  const u = me();
  go(u.role === 'admin' ? '#/admin' : (clubOf(u) ? '#/espace/' + clubOf(u).id : '#/'));
  rerender();
});
window.addEventListener('hashchange', () => loadState().then(render).catch(e => { $('#app').innerHTML = `<div class="card"><h2>Erreur</h2><p>${esc(e.message)}</p></div>`; }));
init().then(render);

/* ---------- Mobile : menu et tableaux ---------- */
$('#burger').addEventListener('click', () => { const o = $('#nav').classList.toggle('open'); $('#burger').setAttribute('aria-expanded', o); });
$('#nav').addEventListener('click', ev => { if (ev.target.closest('a')) { $('#nav').classList.remove('open'); $('#burger').setAttribute('aria-expanded', 'false'); } });
new MutationObserver(() => document.querySelectorAll('#app table').forEach(t => {
  if (!t.parentElement.classList.contains('scroll')) { const w = document.createElement('div'); w.className = 'scroll'; t.replaceWith(w); w.appendChild(t); }
})).observe($('#app'), { childList: true });
