const router = require('express').Router();
const path = require('path');
const { DATA_DIR } = require('../db');
const { requireAuth } = require('../middleware');

// Fichiers de cours / audio d'examen : accessibles uniquement aux utilisateurs connectés
router.get('/:name', requireAuth, (req, res) => {
  const name = path.basename(req.params.name);
  if (!/^[a-f0-9]{32}\.[a-z0-9]+$/.test(name)) return res.status(404).end();
  const opts = { root: path.join(DATA_DIR, 'uploads'), headers: { 'Cache-Control': 'private, max-age=3600' } };
  if (req.query.dl && req.query.as) res.attachment(path.basename(String(req.query.as)));
  res.sendFile(name, opts, err => { if (err && !res.headersSent) res.status(404).end(); });
});

module.exports = router;
