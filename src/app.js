require('./env');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { SqliteStore, loadUser, csrf } = require('./middleware');
const { DATA_DIR } = require('./db');
const { expireOverdue } = require('./grading');

const app = express();
const PROD = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');
Object.assign(app.locals, require('./helpers'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      mediaSrc: ["'self'"],
      frameSrc: ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://player.vimeo.com'],
      upgradeInsecureRequests: PROD && process.env.HTTPS !== 'false' ? [] : null,
    },
  },
}));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: PROD ? '7d' : 0 }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

if (!process.env.SESSION_SECRET && PROD) throw new Error('SESSION_SECRET manquant dans .env');
app.use(session({
  store: new SqliteStore(),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  name: 'dz.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD && process.env.HTTPS !== 'false', maxAge: 7 * 864e5 },
}));
// Les fichiers déposés passent par une route protégée (voir routes/files.js)
app.use(loadUser);

// Les formulaires multipart (upload) sont analysés par multer dans la route ; on vérifie le CSRF ensuite
app.use((req, res, next) => (req.is('multipart/form-data') ? next() : csrf(req, res, next)));

app.use('/', require('./routes/public'));
app.use('/', require('./routes/auth'));
app.use('/files', require('./routes/files'));
app.use('/', require('./routes/student'));
app.use('/teach', require('./routes/teacher'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).render('error', { title: 'Page introuvable', message: "Cette page n'existe pas." }));
app.use((err, req, res, next) => {
  console.error(err);
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux.' : 'Une erreur est survenue.';
  res.status(err.status || 500).render('error', { title: 'Erreur', message: msg });
});

setInterval(() => { try { expireOverdue(); } catch (e) { console.error(e); } }, 60000).unref();

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`Plateforme démarrée sur http://localhost:${PORT} (data: ${DATA_DIR})`));
}
module.exports = app;
