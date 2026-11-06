const router = require('express').Router();
const { all, get, run, SECTIONS } = require('../db');
const { requireAuth, flash } = require('../middleware');
const G = require('../grading');

router.use(['/dashboard', '/courses', '/lessons', '/exams', '/attempts', '/results'], requireAuth);

const canSeeCourse = (user, course) =>
  course && (user.role !== 'student' || (course.published && get('SELECT 1 AS ok FROM enrollments WHERE user_id = ? AND course_id = ?', user.id, course.id)));

router.get('/dashboard', (req, res) => {
  if (req.user.role !== 'student') return res.redirect(req.user.role === 'admin' ? '/admin' : '/teach');
  const uid = req.user.id;
  const courses = all(`SELECT c.*, (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS total,
      (SELECT COUNT(*) FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.course_id = c.id AND p.user_id = ?) AS done
    FROM courses c JOIN enrollments e ON e.course_id = c.id WHERE e.user_id = ? AND c.published = 1 ORDER BY c.level`, uid, uid);
  const exams = availableExams(req.user).filter(e => !e.open && e.remaining !== 0).slice(0, 5);
  const results = all(`SELECT a.*, e.title, e.kind, e.pass_percent FROM attempts a JOIN exams e ON e.id = a.exam_id
    WHERE a.user_id = ? AND a.status != 'in_progress' ORDER BY a.submitted_at DESC LIMIT 5`, uid);
  const news = all('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 3');
  const groups = all(`SELECT g.*, u.name AS teacher FROM groups_ g JOIN group_members m ON m.group_id = g.id
    LEFT JOIN users u ON u.id = g.teacher_id WHERE m.user_id = ?`, uid);
  const placement = get("SELECT id FROM exams WHERE kind = 'placement' AND published = 1 LIMIT 1");
  const placementDone = placement && get("SELECT 1 AS x FROM attempts WHERE exam_id = ? AND user_id = ? AND status != 'in_progress'", placement.id, uid);
  res.render('student/dashboard', { title: 'Tableau de bord', courses, exams, results, news, groups, placement, placementDone });
});

// ---------- Cours ----------
router.get('/courses', (req, res) => {
  const mine = all(`SELECT c.*, (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS total
    FROM courses c JOIN enrollments e ON e.course_id = c.id WHERE e.user_id = ? AND c.published = 1 ORDER BY c.level`, req.user.id);
  res.render('student/courses', { title: 'Mes cours', courses: mine });
});

router.get('/courses/:id', (req, res) => {
  const course = get('SELECT c.*, u.name AS teacher FROM courses c LEFT JOIN users u ON u.id = c.teacher_id WHERE c.id = ?', req.params.id);
  if (!canSeeCourse(req.user, course)) return res.status(404).render('error', { title: 'Cours', message: 'Cours introuvable ou non attribué.' });
  const lessons = all(`SELECT l.id, l.title, l.position, p.completed_at FROM lessons l
    LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = ? WHERE l.course_id = ? ORDER BY l.position, l.id`, req.user.id, course.id);
  const exams = all('SELECT * FROM exams WHERE course_id = ? AND published = 1', course.id);
  res.render('student/course', { title: course.title, course, lessons, exams });
});

router.get('/lessons/:id', (req, res) => {
  const lesson = get('SELECT * FROM lessons WHERE id = ?', req.params.id);
  const course = lesson && get('SELECT * FROM courses WHERE id = ?', lesson.course_id);
  if (!canSeeCourse(req.user, course)) return res.status(404).render('error', { title: 'Leçon', message: 'Leçon introuvable.' });
  const siblings = all('SELECT id, title FROM lessons WHERE course_id = ? ORDER BY position, id', course.id);
  const idx = siblings.findIndex(s => s.id === lesson.id);
  const done = get('SELECT 1 AS x FROM lesson_progress WHERE user_id = ? AND lesson_id = ?', req.user.id, lesson.id);
  res.render('student/lesson', { title: lesson.title, lesson, course, prev: siblings[idx - 1], next: siblings[idx + 1], done, embed: toEmbed(lesson.video_url) });
});

router.post('/lessons/:id/done', (req, res) => {
  const lesson = get('SELECT * FROM lessons WHERE id = ?', req.params.id);
  const course = lesson && get('SELECT * FROM courses WHERE id = ?', lesson.course_id);
  if (!canSeeCourse(req.user, course)) return res.status(404).end();
  run('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id) VALUES (?,?)', req.user.id, lesson.id);
  const next = get('SELECT id FROM lessons WHERE course_id = ? AND (position > ? OR (position = ? AND id > ?)) ORDER BY position, id LIMIT 1',
    course.id, lesson.position, lesson.position, lesson.id);
  res.redirect(next ? '/lessons/' + next.id : '/courses/' + course.id);
});

function toEmbed(url) {
  if (!url) return null;
  let m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return 'https://www.youtube-nocookie.com/embed/' + m[1];
  m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return 'https://player.vimeo.com/video/' + m[1];
  return null;
}

// ---------- Examens ----------
function availableExams(user) {
  // Examens publiés : test de niveau, examens libres (sans cours) du niveau de l'étudiant, ou examens des cours suivis
  const rows = all(`SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS nq,
      (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id AND a.user_id = ?) AS used,
      (SELECT id FROM attempts a WHERE a.exam_id = e.id AND a.user_id = ? AND a.status = 'in_progress') AS open
    FROM exams e WHERE e.published = 1 AND (
      e.kind = 'placement'
      OR (e.course_id IS NULL AND (? IS NULL OR e.level = ?))
      OR e.course_id IN (SELECT course_id FROM enrollments WHERE user_id = ?)
    ) ORDER BY e.kind = 'placement' DESC, e.level, e.created_at DESC`, user.id, user.id, user.level || null, user.level || null, user.id);
  return rows.map(r => ({ ...r, remaining: r.max_attempts > 0 ? Math.max(0, r.max_attempts - r.used) : -1 }));
}

function canTakeExam(user, exam) {
  if (!exam) return false;
  if (user.role !== 'student') return true;
  return availableExams(user).some(e => e.id === exam.id);
}

router.get('/exams', (req, res) => res.render('student/exams', { title: 'Examens', exams: availableExams(req.user) }));

router.get('/exams/:id', (req, res) => {
  const exam = get('SELECT * FROM exams WHERE id = ?', req.params.id);
  if (!canTakeExam(req.user, exam)) return res.status(404).render('error', { title: 'Examen', message: 'Examen introuvable.' });
  const sections = all('SELECT section, COUNT(*) AS n, SUM(points) AS pts FROM questions WHERE exam_id = ? GROUP BY section', exam.id);
  const attempts = all('SELECT * FROM attempts WHERE exam_id = ? AND user_id = ? ORDER BY started_at DESC', exam.id, req.user.id);
  res.render('student/exam-intro', { title: exam.title, exam, sections, attempts });
});

router.post('/exams/:id/start', (req, res) => {
  const exam = get('SELECT * FROM exams WHERE id = ?', req.params.id);
  if (!canTakeExam(req.user, exam)) return res.status(404).end();
  const { attempt, error } = G.startOrResume(exam, req.user.id);
  if (error) { flash(req, 'error', error); return res.redirect('/exams/' + exam.id); }
  res.redirect('/attempts/' + attempt.id);
});

function ownAttempt(req) {
  const a = get('SELECT * FROM attempts WHERE id = ?', req.params.id);
  return a && a.user_id === req.user.id ? a : null;
}

router.get('/attempts/:id', (req, res) => {
  let attempt = ownAttempt(req);
  if (!attempt) return res.status(404).render('error', { title: 'Examen', message: 'Tentative introuvable.' });
  if (attempt.status === 'in_progress' && new Date(attempt.deadline_at) < new Date()) attempt = G.submit(attempt.id);
  if (attempt.status !== 'in_progress') return res.redirect('/results/' + attempt.id);
  const exam = get('SELECT * FROM exams WHERE id = ?', attempt.exam_id);
  const questions = all('SELECT id, section, type, prompt, options, points, media_path FROM questions WHERE exam_id = ? ORDER BY position, id', exam.id)
    .map(q => ({ ...q, options: q.options ? JSON.parse(q.options) : [] }));
  const saved = Object.fromEntries(all('SELECT question_id, response FROM answers WHERE attempt_id = ?', attempt.id).map(a => [a.question_id, a.response]));
  const bySection = SECTIONS.map(s => ({ name: s, questions: questions.filter(q => q.section === s) })).filter(s => s.questions.length);
  res.render('student/exam-take', { title: exam.title, exam, attempt, bySection, saved, layout: 'exam' });
});

// Sauvegarde automatique (AJAX) et soumission finale
router.post('/attempts/:id/save', (req, res) => {
  const attempt = ownAttempt(req);
  if (!attempt || attempt.status !== 'in_progress') return res.status(409).json({ ok: false });
  if (new Date(attempt.deadline_at).getTime() + 60000 < Date.now()) { G.submit(attempt.id); return res.status(409).json({ ok: false, expired: true }); }
  G.saveResponses(attempt.id, req.body.q || {});
  res.json({ ok: true });
});

router.post('/attempts/:id/submit', (req, res) => {
  const attempt = ownAttempt(req);
  if (!attempt) return res.status(404).end();
  if (attempt.status === 'in_progress') {
    // tolérance de 2 minutes après l'échéance pour les réponses envoyées
    if (new Date(attempt.deadline_at).getTime() + 120000 > Date.now()) G.saveResponses(attempt.id, req.body.q || {});
    G.submit(attempt.id);
  }
  res.redirect('/results/' + attempt.id);
});

// ---------- Résultats & notes ----------
router.get('/results', (req, res) => {
  const attempts = all(`SELECT a.*, e.title, e.level, e.kind, e.pass_percent FROM attempts a JOIN exams e ON e.id = a.exam_id
    WHERE a.user_id = ? AND a.status != 'in_progress' ORDER BY a.submitted_at DESC`, req.user.id);
  const grades = all(`SELECT gr.*, g.name AS group_name, u.name AS teacher FROM grades gr LEFT JOIN groups_ g ON g.id = gr.group_id
    LEFT JOIN users u ON u.id = gr.created_by WHERE gr.user_id = ? ORDER BY gr.created_at DESC`, req.user.id);
  res.render('student/results', { title: 'Mes notes', attempts, grades });
});

router.get('/results/:id', (req, res) => {
  const attempt = ownAttempt(req);
  if (!attempt) return res.status(404).render('error', { title: 'Résultat', message: 'Résultat introuvable.' });
  const exam = get('SELECT * FROM exams WHERE id = ?', attempt.exam_id);
  const showAnswers = attempt.status === 'graded';
  const rows = all(`SELECT q.*, an.response, an.points_awarded, an.comment FROM questions q
    LEFT JOIN answers an ON an.question_id = q.id AND an.attempt_id = ? WHERE q.exam_id = ? ORDER BY q.position, q.id`, attempt.id, exam.id)
    .map(q => ({ ...q, options: q.options ? JSON.parse(q.options) : [] }));
  const sections = SECTIONS.map(s => {
    const qs = rows.filter(q => q.section === s);
    return { name: s, pts: qs.reduce((a, q) => a + (q.points_awarded || 0), 0), max: qs.reduce((a, q) => a + q.points, 0), n: qs.length };
  }).filter(s => s.n);
  res.render('student/result', { title: 'Résultat', attempt, exam, rows, sections, showAnswers });
});

module.exports = router;
