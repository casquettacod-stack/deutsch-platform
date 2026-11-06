const router = require('express').Router();
const { all, run, LEVELS } = require('../db');
const { flash } = require('../middleware');

const LEVEL_INFO = {
  A1: { name: 'Débutant', hours: '80–120 h', desc: "Comprendre et utiliser des expressions familières, se présenter, poser des questions simples." },
  A2: { name: 'Élémentaire', hours: '160–200 h', desc: 'Communiquer lors de tâches simples et habituelles : famille, achats, travail, environnement proche.' },
  B1: { name: 'Intermédiaire', hours: '300–400 h', desc: 'Se débrouiller dans la plupart des situations, raconter un événement, donner son avis. Niveau souvent demandé pour Ausbildung / visa.' },
  B2: { name: 'Avancé', hours: '500–650 h', desc: 'Comprendre des textes complexes, communiquer avec aisance. Exigé pour de nombreuses études et professions (Pflege, Ärzte…).' },
  C1: { name: 'Autonome', hours: '700–800 h', desc: 'Utiliser la langue de façon souple et efficace dans la vie sociale, professionnelle et universitaire.' },
  C2: { name: 'Maîtrise', hours: '1000 h +', desc: 'Comprendre pratiquement tout, s’exprimer spontanément et très couramment, avec précision.' },
};

router.get('/', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'student' ? '/dashboard' : req.user.role === 'teacher' ? '/teach' : '/admin');
  const courses = all('SELECT c.id, c.title, c.level, c.description FROM courses c WHERE published = 1 ORDER BY level, title LIMIT 6');
  res.render('public/home', { title: 'Accueil', LEVELS, LEVEL_INFO, courses });
});

router.post('/contact', (req, res) => {
  const { name, phone, email, level, message } = req.body;
  if (!name || !phone) { flash(req, 'error', 'Nom et téléphone sont obligatoires.'); return res.redirect('/#contact'); }
  run('INSERT INTO leads (name, phone, email, level, message) VALUES (?,?,?,?,?)',
    String(name).slice(0, 120), String(phone).slice(0, 40), (email || '').slice(0, 160), LEVELS.includes(level) ? level : null, (message || '').slice(0, 2000));
  flash(req, 'success', 'Merci ! Notre équipe vous contactera très bientôt. Danke!');
  res.redirect('/#contact');
});

router.get('/health', (req, res) => res.json({ ok: true }));

module.exports = router;
