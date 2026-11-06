const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { all, get, run, tx, LEVELS, DATA_DIR } = require('../db');
const { requireRole, flash } = require('../middleware');
const path = require('path');

router.use(requireRole('admin'));
router.use((req, res, next) => { res.locals.LEVELS = LEVELS; next(); });

const ROLES = ['student', 'teacher', 'admin'];
const lvlOrNull = v => (LEVELS.includes(v) ? v : null);
const tempPassword = () => crypto.randomBytes(6).toString('base64url');

router.get('/', (req, res) => {
  const count = sql => get(sql).n;
  const stats = {
    students: count("SELECT COUNT(*) AS n FROM users WHERE role = 'student' AND active = 1"),
    teachers: count("SELECT COUNT(*) AS n FROM users WHERE role = 'teacher' AND active = 1"),
    courses: count('SELECT COUNT(*) AS n FROM courses WHERE published = 1'),
    groups: count('SELECT COUNT(*) AS n FROM groups_'),
    attempts: count("SELECT COUNT(*) AS n FROM attempts WHERE submitted_at >= datetime('now','-30 days')"),
    leads: count('SELECT COUNT(*) AS n FROM leads WHERE handled = 0'),
  };
  const byLevel = all("SELECT COALESCE(level,'?') AS level, COUNT(*) AS n FROM users WHERE role = 'student' AND active = 1 GROUP BY level ORDER BY level");
  const leads = all('SELECT * FROM leads WHERE handled = 0 ORDER BY created_at DESC LIMIT 5');
  const recent = all(`SELECT a.*, e.title, u.name FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN users u ON u.id = a.user_id
    WHERE a.status != 'in_progress' ORDER BY a.submitted_at DESC LIMIT 8`);
  res.render('admin/dashboard', { title: 'Administration', stats, byLevel, leads, recent });
});

// ---------- Utilisateurs ----------
router.get('/users', (req, res) => {
  const role = ROLES.includes(req.query.role) ? req.query.role : null;
  const q = (req.query.q || '').trim();
  const users = all(`SELECT u.*, (SELECT GROUP_CONCAT(g.name, ', ') FROM groups_ g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = u.id) AS groups
    FROM users u WHERE (? IS NULL OR role = ?) AND (? = '' OR name LIKE ? OR email LIKE ? OR phone LIKE ?) ORDER BY u.created_at DESC LIMIT 500`,
    role, role, q, `%${q}%`, `%${q}%`, `%${q}%`);
  res.render('admin/users', { title: 'Utilisateurs', users, role, q });
});

router.get('/users/new', (req, res) => res.render('admin/user-form', { title: 'Nouvel utilisateur', u: { role: req.query.role || 'student', name: req.query.name || '', phone: req.query.phone || '', email: req.query.email || '', level: req.query.level || '' }, lead: req.query.lead || '' }));

router.post('/users', (req, res) => {
  const b = req.body;
  const email = (b.email || '').trim();
  if (!b.name || !/^\S+@\S+\.\S+$/.test(email)) { flash(req, 'error', 'Nom et e-mail valide obligatoires.'); return res.redirect('/admin/users/new'); }
  if (get('SELECT id FROM users WHERE email = ?', email)) { flash(req, 'error', 'Cet e-mail existe déjà.'); return res.redirect('/admin/users/new'); }
  const pwd = b.password && b.password.length >= 8 ? b.password : tempPassword();
  const r = run('INSERT INTO users (name, email, phone, password_hash, role, level) VALUES (?,?,?,?,?,?)',
    b.name.trim(), email, b.phone || '', bcrypt.hashSync(pwd, 10), ROLES.includes(b.role) ? b.role : 'student', lvlOrNull(b.level));
  if (b.lead) run('UPDATE leads SET handled = 1 WHERE id = ?', b.lead);
  flash(req, 'success', `Compte créé. Identifiants à transmettre : ${email} / ${pwd}`);
  res.redirect('/admin/users/' + r.lastInsertRowid);
});

// Import CSV : nom;email;téléphone;niveau
router.post('/users/import', (req, res) => {
  const lines = String(req.body.csv || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const created = [];
  tx(() => {
    for (const line of lines) {
      const [name, email, phone, level] = line.split(/[;,\t]/).map(s => (s || '').trim());
      if (!name || !/^\S+@\S+\.\S+$/.test(email || '') || get('SELECT id FROM users WHERE email = ?', email)) continue;
      const pwd = tempPassword();
      run('INSERT INTO users (name, email, phone, password_hash, role, level) VALUES (?,?,?,?,?,?)', name, email, phone || '', bcrypt.hashSync(pwd, 10), 'student', lvlOrNull((level || '').toUpperCase()));
      created.push({ name, email, pwd });
    }
  });
  res.render('admin/import-result', { title: 'Import terminé', created });
});

router.get('/users/:id', (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) return res.redirect('/admin/users');
  const groups = all('SELECT g.* FROM groups_ g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ?', u.id);
  res.render('admin/user-form', { title: u.name, u, groups, lead: '' });
});

router.post('/users/:id', (req, res) => {
  const b = req.body;
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) return res.redirect('/admin/users');
  const email = (b.email || '').trim();
  const clash = get('SELECT id FROM users WHERE email = ? AND id != ?', email, u.id);
  if (clash || !/^\S+@\S+\.\S+$/.test(email)) { flash(req, 'error', 'E-mail invalide ou déjà utilisé.'); return res.redirect('/admin/users/' + u.id); }
  const role = u.id === req.user.id ? u.role : (ROLES.includes(b.role) ? b.role : u.role); // on ne peut pas se retirer ses propres droits
  run('UPDATE users SET name = ?, email = ?, phone = ?, role = ?, level = ?, active = ? WHERE id = ?',
    b.name || u.name, email, b.phone || '', role, lvlOrNull(b.level), u.id === req.user.id ? 1 : (b.active ? 1 : 0), u.id);
  flash(req, 'success', 'Utilisateur enregistré.');
  res.redirect('/admin/users/' + u.id);
});

router.post('/users/:id/reset-password', (req, res) => {
  const pwd = tempPassword();
  run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(pwd, 10), req.params.id);
  // déconnecte l'utilisateur de toutes ses sessions
  all('SELECT sid, data FROM sessions').forEach(s => { try { if (JSON.parse(s.data).userId === Number(req.params.id)) run('DELETE FROM sessions WHERE sid = ?', s.sid); } catch {} });
  flash(req, 'success', `Nouveau mot de passe temporaire : ${pwd}`);
  res.redirect('/admin/users/' + req.params.id);
});

router.post('/users/:id/delete', (req, res) => {
  if (Number(req.params.id) === req.user.id) { flash(req, 'error', 'Vous ne pouvez pas supprimer votre propre compte.'); return res.redirect('/admin/users'); }
  run('DELETE FROM users WHERE id = ?', req.params.id);
  flash(req, 'success', 'Utilisateur supprimé.');
  res.redirect('/admin/users');
});

// ---------- Groupes ----------
router.get('/groups', (req, res) => {
  const groups = all(`SELECT g.*, u.name AS teacher, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS n
    FROM groups_ g LEFT JOIN users u ON u.id = g.teacher_id ORDER BY g.level, g.name`);
  res.render('admin/groups', { title: 'Groupes / Klassen', groups, teachers: teachers() });
});

const groupFields = b => [b.name || 'Groupe', LEVELS.includes(b.level) ? b.level : 'A1', Number(b.teacher_id) || null, b.schedule || '', b.start_date || null, b.end_date || null];

router.post('/groups', (req, res) => {
  const r = run('INSERT INTO groups_ (name, level, teacher_id, schedule, start_date, end_date) VALUES (?,?,?,?,?,?)', ...groupFields(req.body));
  res.redirect('/admin/groups/' + r.lastInsertRowid);
});

router.get('/groups/:id', (req, res) => {
  const group = get('SELECT * FROM groups_ WHERE id = ?', req.params.id);
  if (!group) return res.redirect('/admin/groups');
  const members = all('SELECT u.* FROM users u JOIN group_members m ON m.user_id = u.id WHERE m.group_id = ? ORDER BY u.name', group.id);
  const others = all(`SELECT id, name, email, level FROM users WHERE role = 'student' AND active = 1 AND id NOT IN (SELECT user_id FROM group_members WHERE group_id = ?)
    ORDER BY (level = ?) DESC, name`, group.id, group.level);
  res.render('admin/group', { title: group.name, group, members, others, teachers: teachers() });
});

router.post('/groups/:id', (req, res) => {
  run('UPDATE groups_ SET name=?, level=?, teacher_id=?, schedule=?, start_date=?, end_date=? WHERE id = ?', ...groupFields(req.body), req.params.id);
  flash(req, 'success', 'Groupe enregistré.');
  res.redirect('/admin/groups/' + req.params.id);
});

router.post('/groups/:id/members', (req, res) => {
  [].concat(req.body.user_ids || []).forEach(uid => run('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?,?)', req.params.id, uid));
  res.redirect('/admin/groups/' + req.params.id);
});

router.post('/groups/:id/members/:uid/remove', (req, res) => {
  run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', req.params.id, req.params.uid);
  res.redirect('/admin/groups/' + req.params.id);
});

router.post('/groups/:id/delete', (req, res) => {
  run('DELETE FROM groups_ WHERE id = ?', req.params.id);
  res.redirect('/admin/groups');
});

// ---------- Demandes d'inscription ----------
router.get('/leads', (req, res) => res.render('admin/leads', { title: "Demandes d'inscription", leads: all('SELECT * FROM leads ORDER BY handled, created_at DESC LIMIT 500') }));
router.post('/leads/:id/toggle', (req, res) => { run('UPDATE leads SET handled = 1 - handled WHERE id = ?', req.params.id); res.redirect('/admin/leads'); });
router.post('/leads/:id/delete', (req, res) => { run('DELETE FROM leads WHERE id = ?', req.params.id); res.redirect('/admin/leads'); });

// ---------- Annonces ----------
router.get('/announcements', (req, res) => res.render('admin/announcements', { title: 'Annonces', items: all('SELECT * FROM announcements ORDER BY created_at DESC') }));
router.post('/announcements', (req, res) => {
  if (req.body.title && req.body.body) run('INSERT INTO announcements (title, body, created_by) VALUES (?,?,?)', req.body.title, req.body.body, req.user.id);
  res.redirect('/admin/announcements');
});
router.post('/announcements/:id/delete', (req, res) => { run('DELETE FROM announcements WHERE id = ?', req.params.id); res.redirect('/admin/announcements'); });

// ---------- Sauvegarde ----------
router.get('/backup', (req, res) => {
  const file = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  require('../db').db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  res.download(file, `sauvegarde-${new Date().toISOString().slice(0, 10)}.db`, () => require('fs').rm(file, () => {}));
});

function teachers() { return all("SELECT id, name FROM users WHERE role IN ('teacher','admin') AND active = 1 ORDER BY name"); }

module.exports = router;
