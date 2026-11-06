const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { all, get, run, tx, LEVELS, SECTIONS, DATA_DIR } = require('../db');
const { requireRole, flash } = require('../middleware');
const { single } = require('../upload');
const G = require('../grading');

router.use(requireRole('teacher', 'admin'));
router.use((req, res, next) => { res.locals.LEVELS = LEVELS; res.locals.SECTIONS = SECTIONS; next(); });

const lvl = v => (LEVELS.includes(v) ? v : 'A1');
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const removeFile = name => { if (name) fs.rm(path.join(DATA_DIR, 'uploads', path.basename(name)), () => {}); };
const notFound = (res, what = 'Élément') => res.status(404).render('error', { title: what, message: `${what} introuvable.` });

// ---------- Tableau de bord ----------
router.get('/', (req, res) => {
  const pending = all(`SELECT a.id, a.submitted_at, e.title, u.name FROM attempts a JOIN exams e ON e.id = a.exam_id
    JOIN users u ON u.id = a.user_id WHERE a.status = 'pending_review' ORDER BY a.submitted_at LIMIT 10`);
  const groups = all(`SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS n FROM groups_ g
    WHERE g.teacher_id = ? OR ? = 'admin' ORDER BY g.level, g.name`, req.user.id, req.user.role);
  const stats = {
    courses: get('SELECT COUNT(*) AS n FROM courses').n,
    exams: get('SELECT COUNT(*) AS n FROM exams').n,
    students: get("SELECT COUNT(*) AS n FROM users WHERE role = 'student' AND active = 1").n,
    pending: get("SELECT COUNT(*) AS n FROM attempts WHERE status = 'pending_review'").n,
  };
  res.render('teacher/dashboard', { title: 'Espace professeur', pending, groups, stats });
});

// ---------- Cours ----------
router.get('/courses', (req, res) => {
  const courses = all(`SELECT c.*, u.name AS teacher, (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS nl,
    (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS ns FROM courses c LEFT JOIN users u ON u.id = c.teacher_id ORDER BY c.level, c.title`);
  res.render('teacher/courses', { title: 'Cours', courses });
});

router.get('/courses/new', (req, res) => res.render('teacher/course-form', { title: 'Nouveau cours', course: { level: 'A1' }, teachers: teachers() }));

router.post('/courses', (req, res) => {
  const b = req.body;
  const r = run('INSERT INTO courses (title, level, description, teacher_id, published) VALUES (?,?,?,?,?)',
    b.title || 'Sans titre', lvl(b.level), b.description || '', int(b.teacher_id, req.user.id), b.published ? 1 : 0);
  flash(req, 'success', 'Cours créé. Ajoutez maintenant des leçons.');
  res.redirect('/teach/courses/' + r.lastInsertRowid);
});

router.get('/courses/:id', (req, res) => {
  const course = get('SELECT * FROM courses WHERE id = ?', req.params.id);
  if (!course) return notFound(res, 'Cours');
  const lessons = all('SELECT * FROM lessons WHERE course_id = ? ORDER BY position, id', course.id);
  const enrolled = all(`SELECT u.id, u.name, u.email, u.level,
      (SELECT COUNT(*) FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.course_id = ? AND p.user_id = u.id) AS done
    FROM users u JOIN enrollments e ON e.user_id = u.id WHERE e.course_id = ? ORDER BY u.name`, course.id, course.id);
  const others = all(`SELECT id, name, email, level FROM users WHERE role = 'student' AND active = 1
    AND id NOT IN (SELECT user_id FROM enrollments WHERE course_id = ?) ORDER BY (level = ?) DESC, name`, course.id, course.level);
  const groups = all('SELECT * FROM groups_ ORDER BY level, name');
  res.render('teacher/course', { title: course.title, course, lessons, enrolled, others, groups, teachers: teachers() });
});

router.post('/courses/:id', (req, res) => {
  const b = req.body;
  run('UPDATE courses SET title = ?, level = ?, description = ?, teacher_id = ?, published = ? WHERE id = ?',
    b.title || 'Sans titre', lvl(b.level), b.description || '', int(b.teacher_id, null), b.published ? 1 : 0, req.params.id);
  flash(req, 'success', 'Cours enregistré.');
  res.redirect('/teach/courses/' + req.params.id);
});

router.post('/courses/:id/delete', (req, res) => {
  all('SELECT file_path FROM lessons WHERE course_id = ?', req.params.id).forEach(l => removeFile(l.file_path));
  run('DELETE FROM courses WHERE id = ?', req.params.id);
  flash(req, 'success', 'Cours supprimé.');
  res.redirect('/teach/courses');
});

router.post('/courses/:id/enroll', (req, res) => {
  const cid = Number(req.params.id);
  const ids = [].concat(req.body.user_ids || []).map(Number).filter(Boolean);
  tx(() => {
    ids.forEach(uid => run('INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?,?)', uid, cid));
    if (req.body.group_id) all('SELECT user_id FROM group_members WHERE group_id = ?', req.body.group_id)
      .forEach(m => run('INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?,?)', m.user_id, cid));
  });
  flash(req, 'success', 'Inscriptions mises à jour.');
  res.redirect('/teach/courses/' + cid + '#students');
});

router.post('/courses/:id/unenroll/:uid', (req, res) => {
  run('DELETE FROM enrollments WHERE course_id = ? AND user_id = ?', req.params.id, req.params.uid);
  res.redirect('/teach/courses/' + req.params.id + '#students');
});

// ---------- Leçons ----------
router.get('/courses/:id/lessons/new', (req, res) => {
  const course = get('SELECT * FROM courses WHERE id = ?', req.params.id);
  if (!course) return notFound(res, 'Cours');
  const pos = get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM lessons WHERE course_id = ?', course.id).p;
  res.render('teacher/lesson-form', { title: 'Nouvelle leçon', course, lesson: { position: pos } });
});

router.post('/courses/:id/lessons', single('file'), (req, res) => {
  const b = req.body;
  run('INSERT INTO lessons (course_id, title, content, video_url, file_path, file_name, position) VALUES (?,?,?,?,?,?,?)',
    req.params.id, b.title || 'Leçon', b.content || '', b.video_url || '', req.file ? req.file.filename : null, req.file ? req.file.originalname : null, int(b.position, 0));
  flash(req, 'success', 'Leçon ajoutée.');
  res.redirect('/teach/courses/' + req.params.id);
});

router.get('/lessons/:id/edit', (req, res) => {
  const lesson = get('SELECT * FROM lessons WHERE id = ?', req.params.id);
  if (!lesson) return notFound(res, 'Leçon');
  res.render('teacher/lesson-form', { title: 'Modifier la leçon', course: get('SELECT * FROM courses WHERE id = ?', lesson.course_id), lesson });
});

router.post('/lessons/:id', single('file'), (req, res) => {
  const lesson = get('SELECT * FROM lessons WHERE id = ?', req.params.id);
  if (!lesson) return notFound(res, 'Leçon');
  const b = req.body;
  let fp = lesson.file_path, fn = lesson.file_name;
  if (req.file || b.remove_file) { removeFile(fp); fp = req.file ? req.file.filename : null; fn = req.file ? req.file.originalname : null; }
  run('UPDATE lessons SET title = ?, content = ?, video_url = ?, file_path = ?, file_name = ?, position = ? WHERE id = ?',
    b.title || 'Leçon', b.content || '', b.video_url || '', fp, fn, int(b.position, 0), lesson.id);
  flash(req, 'success', 'Leçon enregistrée.');
  res.redirect('/teach/courses/' + lesson.course_id);
});

router.post('/lessons/:id/delete', (req, res) => {
  const lesson = get('SELECT * FROM lessons WHERE id = ?', req.params.id);
  if (!lesson) return notFound(res, 'Leçon');
  removeFile(lesson.file_path);
  run('DELETE FROM lessons WHERE id = ?', lesson.id);
  res.redirect('/teach/courses/' + lesson.course_id);
});

// ---------- Examens ----------
router.get('/exams', (req, res) => {
  const exams = all(`SELECT e.*, c.title AS course, (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS nq,
    (SELECT SUM(points) FROM questions q WHERE q.exam_id = e.id) AS pts,
    (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id AND a.status != 'in_progress') AS na
    FROM exams e LEFT JOIN courses c ON c.id = e.course_id ORDER BY e.kind = 'placement' DESC, e.level, e.created_at DESC`);
  res.render('teacher/exams', { title: 'Examens', exams });
});

router.get('/exams/new', (req, res) => res.render('teacher/exam-form', { title: 'Nouvel examen', exam: { level: 'A1', kind: 'exam', duration_min: 60, pass_percent: 60, max_attempts: 1 }, courses: courses() }));

function examFields(b) {
  return [b.title || 'Examen', lvl(b.level), ['exam', 'quiz', 'placement'].includes(b.kind) ? b.kind : 'exam', b.description || '',
    int(b.course_id, null) || null, Math.max(1, int(b.duration_min, 60)), Math.min(100, Math.max(0, int(b.pass_percent, 60))), Math.max(0, int(b.max_attempts, 1)), b.published ? 1 : 0];
}

router.post('/exams', (req, res) => {
  const r = run('INSERT INTO exams (title, level, kind, description, course_id, duration_min, pass_percent, max_attempts, published, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ...examFields(req.body), req.user.id);
  flash(req, 'success', 'Examen créé. Ajoutez les questions.');
  res.redirect('/teach/exams/' + r.lastInsertRowid);
});

router.get('/exams/:id', (req, res) => {
  const exam = get('SELECT * FROM exams WHERE id = ?', req.params.id);
  if (!exam) return notFound(res, 'Examen');
  const questions = all('SELECT * FROM questions WHERE exam_id = ? ORDER BY position, id', exam.id).map(q => ({ ...q, options: q.options ? JSON.parse(q.options) : [] }));
  const edit = req.query.q ? questions.find(q => q.id === Number(req.query.q)) : null;
  res.render('teacher/exam', { title: exam.title, exam, questions, courses: courses(), edit });
});

router.post('/exams/:id', (req, res) => {
  run('UPDATE exams SET title=?, level=?, kind=?, description=?, course_id=?, duration_min=?, pass_percent=?, max_attempts=?, published=? WHERE id = ?',
    ...examFields(req.body), req.params.id);
  flash(req, 'success', 'Paramètres enregistrés.');
  res.redirect('/teach/exams/' + req.params.id);
});

router.post('/exams/:id/delete', (req, res) => {
  all('SELECT media_path FROM questions WHERE exam_id = ?', req.params.id).forEach(q => removeFile(q.media_path));
  run('DELETE FROM exams WHERE id = ?', req.params.id);
  flash(req, 'success', 'Examen supprimé.');
  res.redirect('/teach/exams');
});

router.post('/exams/:id/duplicate', (req, res) => {
  const e = get('SELECT * FROM exams WHERE id = ?', req.params.id);
  if (!e) return notFound(res, 'Examen');
  const id = tx(() => {
    const r = run('INSERT INTO exams (title, level, kind, description, course_id, duration_min, pass_percent, max_attempts, published, created_by) VALUES (?,?,?,?,?,?,?,?,0,?)',
      e.title + ' (copie)', e.level, e.kind, e.description, e.course_id, e.duration_min, e.pass_percent, e.max_attempts, req.user.id);
    // les médias sont partagés entre copies : on ne copie pas media_path pour éviter une suppression croisée
    all('SELECT * FROM questions WHERE exam_id = ?', e.id).forEach(q => run('INSERT INTO questions (exam_id, section, type, prompt, options, answer, points, position) VALUES (?,?,?,?,?,?,?,?)',
      r.lastInsertRowid, q.section, q.type, q.prompt, q.options, q.answer, q.points, q.position));
    return r.lastInsertRowid;
  });
  flash(req, 'success', 'Examen dupliqué (fichiers audio à ré-ajouter).');
  res.redirect('/teach/exams/' + id);
});

// Questions
function questionFields(b) {
  const type = ['mcq', 'tf', 'short', 'essay'].includes(b.type) ? b.type : 'mcq';
  let options = null, answer = null;
  if (type === 'mcq') {
    const opts = [].concat(b.options || []).map(s => String(s).trim());
    const keep = opts.map((o, i) => ({ o, i })).filter(x => x.o);
    options = JSON.stringify(keep.map(x => x.o));
    const ci = keep.findIndex(x => String(x.i) === String(b.correct));
    answer = String(Math.max(0, ci));
  } else if (type === 'tf') answer = b.tf === 'false' ? 'false' : 'true';
  else if (type === 'short') answer = (b.answer || '').trim();
  return { type, section: SECTIONS.includes(b.section) ? b.section : 'Grammatik', prompt: b.prompt || '', options, answer, points: Math.max(0, Number(b.points) || 1), position: int(b.position, 0) };
}

router.post('/exams/:id/questions', single('media'), (req, res) => {
  const f = questionFields(req.body);
  run('INSERT INTO questions (exam_id, section, type, prompt, options, answer, points, media_path, position) VALUES (?,?,?,?,?,?,?,?,?)',
    req.params.id, f.section, f.type, f.prompt, f.options, f.answer, f.points, req.file ? req.file.filename : null,
    f.position || get('SELECT COALESCE(MAX(position),0)+1 AS p FROM questions WHERE exam_id = ?', req.params.id).p);
  flash(req, 'success', 'Question ajoutée.');
  res.redirect('/teach/exams/' + req.params.id + '#add');
});

router.post('/questions/:id', single('media'), (req, res) => {
  const q = get('SELECT * FROM questions WHERE id = ?', req.params.id);
  if (!q) return notFound(res, 'Question');
  const f = questionFields(req.body);
  let media = q.media_path;
  if (req.file || req.body.remove_media) { removeFile(media); media = req.file ? req.file.filename : null; }
  run('UPDATE questions SET section=?, type=?, prompt=?, options=?, answer=?, points=?, media_path=?, position=? WHERE id = ?',
    f.section, f.type, f.prompt, f.options, f.answer, f.points, media, f.position, q.id);
  flash(req, 'success', 'Question modifiée.');
  res.redirect('/teach/exams/' + q.exam_id + '#q' + q.id);
});

router.post('/questions/:id/delete', (req, res) => {
  const q = get('SELECT * FROM questions WHERE id = ?', req.params.id);
  if (!q) return notFound(res, 'Question');
  removeFile(q.media_path);
  run('DELETE FROM questions WHERE id = ?', q.id);
  res.redirect('/teach/exams/' + q.exam_id);
});

// Résultats d'un examen + export CSV
function examResults(examId) {
  return all(`SELECT a.*, u.name, u.email FROM attempts a JOIN users u ON u.id = a.user_id
    WHERE a.exam_id = ? AND a.status != 'in_progress' ORDER BY a.submitted_at DESC`, examId);
}
router.get('/exams/:id/results', (req, res) => {
  const exam = get('SELECT * FROM exams WHERE id = ?', req.params.id);
  if (!exam) return notFound(res, 'Examen');
  res.render('teacher/exam-results', { title: 'Résultats – ' + exam.title, exam, attempts: examResults(exam.id) });
});
router.get('/exams/:id/results.csv', (req, res) => {
  const exam = get('SELECT * FROM exams WHERE id = ?', req.params.id);
  if (!exam) return notFound(res, 'Examen');
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['Nom', 'Email', 'Soumis le', 'Statut', 'Score', 'Max', '%', 'Résultat'].map(esc).join(';')];
  examResults(exam.id).forEach(a => {
    const pct = a.max_score ? Math.round((a.score / a.max_score) * 100) : 0;
    lines.push([a.name, a.email, a.submitted_at, a.status, a.score, a.max_score, pct, a.status === 'graded' ? (pct >= exam.pass_percent ? 'Bestanden' : 'Nicht bestanden') : 'En correction'].map(esc).join(';'));
  });
  res.attachment(`resultats-exam-${exam.id}.csv`).type('text/csv').send('﻿' + lines.join('\n'));
});

// ---------- Correction manuelle ----------
router.get('/review', (req, res) => {
  const pending = all(`SELECT a.*, e.title, e.level, u.name FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN users u ON u.id = a.user_id
    WHERE a.status = 'pending_review' ORDER BY a.submitted_at`);
  res.render('teacher/review-list', { title: 'À corriger', pending });
});

router.get('/attempts/:id', (req, res) => {
  const attempt = get('SELECT a.*, u.name, u.email FROM attempts a JOIN users u ON u.id = a.user_id WHERE a.id = ?', req.params.id);
  if (!attempt) return notFound(res, 'Copie');
  const exam = get('SELECT * FROM exams WHERE id = ?', attempt.exam_id);
  const rows = all(`SELECT q.*, an.response, an.points_awarded, an.comment FROM questions q
    LEFT JOIN answers an ON an.question_id = q.id AND an.attempt_id = ? WHERE q.exam_id = ? ORDER BY q.position, q.id`, attempt.id, exam.id)
    .map(q => ({ ...q, options: q.options ? JSON.parse(q.options) : [] }));
  res.render('teacher/attempt', { title: 'Copie de ' + attempt.name, attempt, exam, rows });
});

router.post('/attempts/:id/grade', (req, res) => {
  const attempt = get('SELECT * FROM attempts WHERE id = ?', req.params.id);
  if (!attempt || attempt.status === 'in_progress') return notFound(res, 'Copie');
  G.review(attempt.id, req.body.points || {}, req.body.comments || {}, req.body.feedback);
  flash(req, 'success', 'Correction enregistrée. La note est visible par l’étudiant.');
  const next = get("SELECT id FROM attempts WHERE status = 'pending_review' ORDER BY submitted_at LIMIT 1");
  res.redirect(next ? '/teach/attempts/' + next.id : '/teach/review');
});

router.post('/attempts/:id/reset', (req, res) => {
  const attempt = get('SELECT * FROM attempts WHERE id = ?', req.params.id);
  if (!attempt) return notFound(res, 'Copie');
  run('DELETE FROM attempts WHERE id = ?', attempt.id);
  flash(req, 'success', 'Tentative supprimée : l’étudiant peut repasser l’examen.');
  res.redirect('/teach/exams/' + attempt.exam_id + '/results');
});

// ---------- Groupes & carnet de notes ----------
router.get('/groups/:id', (req, res) => {
  const group = get('SELECT g.*, u.name AS teacher FROM groups_ g LEFT JOIN users u ON u.id = g.teacher_id WHERE g.id = ?', req.params.id);
  if (!group) return notFound(res, 'Groupe');
  if (req.user.role !== 'admin' && group.teacher_id !== req.user.id) return res.status(403).render('error', { title: 'Accès refusé', message: 'Ce groupe ne vous est pas attribué.' });
  const members = all(`SELECT u.id, u.name, u.email, u.level FROM users u JOIN group_members m ON m.user_id = u.id WHERE m.group_id = ? ORDER BY u.name`, group.id);
  const grades = all('SELECT * FROM grades WHERE group_id = ? ORDER BY created_at', group.id);
  const titles = [...new Set(grades.map(g => g.title))];
  const matrix = members.map(m => {
    const mine = grades.filter(g => g.user_id === m.id);
    const cells = titles.map(t => mine.find(g => g.title === t) || null);
    const avg = mine.length ? (mine.reduce((s, g) => s + (g.score / g.max_score) * 20, 0) / mine.length).toFixed(2) : null;
    return { ...m, cells, avg };
  });
  res.render('teacher/group', { title: group.name, group, members, titles, matrix });
});

router.post('/groups/:id/grades', (req, res) => {
  const group = get('SELECT * FROM groups_ WHERE id = ?', req.params.id);
  if (!group || (req.user.role !== 'admin' && group.teacher_id !== req.user.id)) return notFound(res, 'Groupe');
  const { title, skill, max_score } = req.body;
  const max = Math.max(1, Number(max_score) || 20);
  const scores = req.body.score || {};
  let n = 0;
  tx(() => {
    for (const [key, val] of Object.entries(scores)) {
      const uid = Number(String(key).replace(/^k/, ''));
      if (val === '' || val == null || !uid) continue;
      if (!get('SELECT 1 AS x FROM group_members WHERE group_id = ? AND user_id = ?', group.id, uid)) continue;
      run('DELETE FROM grades WHERE group_id = ? AND user_id = ? AND title = ?', group.id, uid, title);
      run('INSERT INTO grades (user_id, group_id, title, skill, score, max_score, comment, created_by) VALUES (?,?,?,?,?,?,?,?)',
        uid, group.id, (title || 'Note').slice(0, 120), skill || null, Math.min(max, Math.max(0, Number(val))), max, (req.body.comment?.['k' + uid] || '').slice(0, 500) || null, req.user.id);
      n++;
    }
  });
  flash(req, 'success', `${n} note(s) enregistrée(s).`);
  res.redirect('/teach/groups/' + group.id);
});

router.post('/grades/:id/delete', (req, res) => {
  const g = get('SELECT * FROM grades WHERE id = ?', req.params.id);
  if (g) run('DELETE FROM grades WHERE id = ?', g.id);
  res.redirect(g && g.group_id ? '/teach/groups/' + g.group_id : '/teach');
});

// Fiche étudiant (vue professeur)
router.get('/students/:id', (req, res) => {
  const s = get("SELECT id, name, email, phone, level, created_at FROM users WHERE id = ? AND role = 'student'", req.params.id);
  if (!s) return notFound(res, 'Étudiant');
  const attempts = all(`SELECT a.*, e.title, e.pass_percent FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE a.user_id = ? ORDER BY a.started_at DESC`, s.id);
  const grades = all('SELECT gr.*, g.name AS group_name FROM grades gr LEFT JOIN groups_ g ON g.id = gr.group_id WHERE gr.user_id = ? ORDER BY gr.created_at DESC', s.id);
  const courses = all('SELECT c.* FROM courses c JOIN enrollments e ON e.course_id = c.id WHERE e.user_id = ?', s.id);
  res.render('teacher/student', { title: s.name, s, attempts, grades, courses });
});

function teachers() { return all("SELECT id, name FROM users WHERE role IN ('teacher','admin') AND active = 1 ORDER BY name"); }
function courses() { return all('SELECT id, title, level FROM courses ORDER BY level, title'); }

module.exports = router;
