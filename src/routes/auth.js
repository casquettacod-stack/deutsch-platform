const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { get, run } = require('../db');
const { flash, requireAuth } = require('../middleware');

// Limiteur simple contre le brute-force (par IP)
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const h = (hits.get(ip) || []).filter(t => now - t < 15 * 60000);
  h.push(now); hits.set(ip, h);
  return h.length > 20;
}

const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : null);
const home = u => (u.role === 'admin' ? '/admin' : u.role === 'teacher' ? '/teach' : '/dashboard');

router.get('/login', (req, res) => res.render('public/login', { title: 'Connexion', next: req.query.next || '' }));

router.post('/login', (req, res) => {
  if (tooMany(req.ip)) { flash(req, 'error', 'Trop de tentatives. Réessayez dans 15 minutes.'); return res.redirect('/login'); }
  const { email, password } = req.body;
  const u = get('SELECT * FROM users WHERE email = ?', String(email || '').trim());
  if (!u || !u.active || !bcrypt.compareSync(String(password || ''), u.password_hash)) {
    flash(req, 'error', 'E-mail ou mot de passe incorrect.');
    return res.redirect('/login');
  }
  req.session.regenerate(err => {
    if (err) throw err;
    req.session.userId = u.id;
    res.redirect(safeNext(req.body.next) || home(u));
  });
});

router.get('/register', (req, res) => {
  if (process.env.ALLOW_REGISTRATION === 'false') return res.render('error', { title: 'Inscription', message: "Les inscriptions se font à l'accueil du centre." });
  res.render('public/register', { title: 'Inscription' });
});

router.post('/register', (req, res) => {
  if (process.env.ALLOW_REGISTRATION === 'false') return res.redirect('/login');
  const { name, email, phone, password, password2 } = req.body;
  const err = !name || !email || !password ? 'Tous les champs obligatoires doivent être remplis.'
    : !/^\S+@\S+\.\S+$/.test(email) ? 'E-mail invalide.'
    : password.length < 8 ? 'Le mot de passe doit contenir au moins 8 caractères.'
    : password !== password2 ? 'Les mots de passe ne correspondent pas.'
    : get('SELECT id FROM users WHERE email = ?', email.trim()) ? 'Cet e-mail est déjà utilisé.' : null;
  if (err) { flash(req, 'error', err); return res.redirect('/register'); }
  const r = run('INSERT INTO users (name, email, phone, password_hash, role) VALUES (?,?,?,?,?)',
    name.trim().slice(0, 120), email.trim().slice(0, 160), (phone || '').slice(0, 40), bcrypt.hashSync(password, 10), 'student');
  req.session.regenerate(() => {
    req.session.userId = Number(r.lastInsertRowid);
    flash(req, 'success', 'Bienvenue ! Passez le test de niveau (Einstufungstest) pour connaître votre niveau.');
    res.redirect('/dashboard');
  });
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

router.get('/profile', requireAuth, (req, res) => res.render('student/profile', { title: 'Mon profil', me: get('SELECT * FROM users WHERE id = ?', req.user.id) }));

router.post('/profile', requireAuth, (req, res) => {
  const { name, phone, current, password } = req.body;
  const me = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (name) run('UPDATE users SET name = ?, phone = ? WHERE id = ?', name.slice(0, 120), (phone || '').slice(0, 40), me.id);
  if (password) {
    if (!bcrypt.compareSync(current || '', me.password_hash)) { flash(req, 'error', 'Mot de passe actuel incorrect.'); return res.redirect('/profile'); }
    if (password.length < 8) { flash(req, 'error', 'Nouveau mot de passe trop court (8 caractères min).'); return res.redirect('/profile'); }
    run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(password, 10), me.id);
  }
  flash(req, 'success', 'Profil mis à jour.');
  res.redirect('/profile');
});

module.exports = router;
