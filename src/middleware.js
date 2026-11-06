const crypto = require('crypto');
const session = require('express-session');
const { get, run } = require('./db');

// Store de session sur SQLite
class SqliteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = get('SELECT data, expires FROM sessions WHERE sid = ?', sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 864e5;
      run('INSERT INTO sessions (sid, data, expires) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires=excluded.expires',
        sid, JSON.stringify(sess), exp);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) { try { run('DELETE FROM sessions WHERE sid = ?', sid); cb && cb(null); } catch (e) { cb && cb(e); } }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}
setInterval(() => { try { run('DELETE FROM sessions WHERE expires < ?', Date.now()); } catch {} }, 36e5).unref();

// Charge l'utilisateur courant + variables communes aux vues
function loadUser(req, res, next) {
  res.locals.user = null;
  if (req.session.userId) {
    const u = get('SELECT id, name, email, role, level, active FROM users WHERE id = ?', req.session.userId);
    if (u && u.active) { req.user = u; res.locals.user = u; }
    else delete req.session.userId;
  }
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.path = req.path;
  res.locals.centerName = process.env.CENTER_NAME || 'Deutschzentrum';
  next();
}

// Protection CSRF pour tous les POST (le champ _csrf est ajouté dans chaque formulaire)
function csrf(req, res, next) {
  if (req.method !== 'POST') return next();
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!token || token !== req.session.csrf) return res.status(403).render('error', { title: 'Erreur', message: 'Session expirée, veuillez réessayer.' });
  next();
}

function flash(req, type, msg) { req.session.flash = { type, msg }; }

const requireAuth = (req, res, next) => (req.user ? next() : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)));
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  if (!roles.includes(req.user.role)) return res.status(403).render('error', { title: 'Accès refusé', message: "Vous n'avez pas accès à cette page." });
  next();
};

module.exports = { SqliteStore, loadUser, csrf, flash, requireAuth, requireRole };
