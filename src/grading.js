const { all, get, run, tx } = require('./db');

const norm = s => String(s || '').trim().toLowerCase()
  .replace(/ß/g, 'ss').replace(/\s+/g, ' ').replace(/[.!?,;]+$/, '');

// Correction automatique d'une question (null = correction manuelle)
function autoGrade(q, response) {
  if (q.type === 'essay') return null;
  if (response == null || response === '') return 0;
  if (q.type === 'mcq' || q.type === 'tf') return String(response) === String(q.answer) ? q.points : 0;
  if (q.type === 'short') {
    const accepted = String(q.answer || '').split('|').map(norm).filter(Boolean);
    return accepted.includes(norm(response)) ? q.points : 0;
  }
  return 0;
}

function placementLevel(percent) {
  if (percent < 20) return 'A1';
  if (percent < 40) return 'A2';
  if (percent < 60) return 'B1';
  if (percent < 75) return 'B2';
  if (percent < 90) return 'C1';
  return 'C2';
}

function startOrResume(exam, userId) {
  const open = get("SELECT * FROM attempts WHERE exam_id = ? AND user_id = ? AND status = 'in_progress'", exam.id, userId);
  if (open) return { attempt: open };
  const used = get('SELECT COUNT(*) AS n FROM attempts WHERE exam_id = ? AND user_id = ?', exam.id, userId).n;
  if (exam.max_attempts > 0 && used >= exam.max_attempts) return { error: 'Nombre maximal de tentatives atteint.' };
  const deadline = new Date(Date.now() + exam.duration_min * 60000).toISOString();
  const r = run('INSERT INTO attempts (exam_id, user_id, deadline_at) VALUES (?,?,?)', exam.id, userId, deadline);
  return { attempt: get('SELECT * FROM attempts WHERE id = ?', r.lastInsertRowid) };
}

function saveResponses(attemptId, responses) {
  const qs = all('SELECT q.id FROM questions q JOIN attempts a ON a.exam_id = q.exam_id WHERE a.id = ?', attemptId);
  const valid = new Set(qs.map(q => String(q.id)));
  tx(() => {
    for (const [key, val] of Object.entries(responses || {})) {
      const qid = String(key).replace(/^k/, '');
      if (!valid.has(qid)) continue;
      run(`INSERT INTO answers (attempt_id, question_id, response) VALUES (?,?,?)
           ON CONFLICT(attempt_id, question_id) DO UPDATE SET response = excluded.response`,
        attemptId, Number(qid), String(val).slice(0, 20000));
    }
  });
}

// Recalcule le score à partir des réponses
function recompute(attemptId) {
  const rows = all(`SELECT q.points, an.points_awarded FROM questions q
    JOIN attempts a ON a.exam_id = q.exam_id
    LEFT JOIN answers an ON an.question_id = q.id AND an.attempt_id = a.id
    WHERE a.id = ?`, attemptId);
  const max = rows.reduce((s, r) => s + r.points, 0);
  const score = rows.reduce((s, r) => s + (r.points_awarded || 0), 0);
  return { score: Math.round(score * 100) / 100, max };
}

function submit(attemptId) {
  const attempt = get('SELECT * FROM attempts WHERE id = ?', attemptId);
  if (!attempt || attempt.status !== 'in_progress') return attempt;
  const exam = get('SELECT * FROM exams WHERE id = ?', attempt.exam_id);
  const qs = all('SELECT * FROM questions WHERE exam_id = ?', attempt.exam_id);
  let needsReview = false;
  tx(() => {
    for (const q of qs) {
      const an = get('SELECT response FROM answers WHERE attempt_id = ? AND question_id = ?', attemptId, q.id);
      const pts = autoGrade(q, an && an.response);
      if (pts === null && an && an.response && an.response.trim()) needsReview = true;
      run(`INSERT INTO answers (attempt_id, question_id, response, points_awarded) VALUES (?,?,?,?)
           ON CONFLICT(attempt_id, question_id) DO UPDATE SET points_awarded = excluded.points_awarded`,
        attemptId, q.id, an ? an.response : null, pts === null ? (an && an.response && an.response.trim() ? null : 0) : pts);
    }
    const { score, max } = recompute(attemptId);
    const status = needsReview ? 'pending_review' : 'graded';
    run("UPDATE attempts SET submitted_at = datetime('now'), status = ?, score = ?, max_score = ? WHERE id = ?", status, score, max, attemptId);
    if (exam.kind === 'placement' && max > 0) {
      const lvl = placementLevel((score / max) * 100);
      run('UPDATE attempts SET feedback = ? WHERE id = ?', `Niveau recommandé : ${lvl}`, attemptId);
      run("UPDATE users SET level = ? WHERE id = ? AND (level IS NULL OR level = '')", lvl, attempt.user_id);
    }
  });
  return get('SELECT * FROM attempts WHERE id = ?', attemptId);
}

// Correction manuelle par le professeur
function review(attemptId, points, comments, feedback) {
  tx(() => {
    const qs = all(`SELECT q.id, q.points FROM questions q JOIN attempts a ON a.exam_id = q.exam_id WHERE a.id = ?`, attemptId);
    for (const q of qs) {
      const raw = points['k' + q.id];
      if (raw === undefined || raw === '') continue;
      const p = Math.max(0, Math.min(q.points, Number(raw) || 0));
      run(`INSERT INTO answers (attempt_id, question_id, points_awarded, comment) VALUES (?,?,?,?)
           ON CONFLICT(attempt_id, question_id) DO UPDATE SET points_awarded = excluded.points_awarded, comment = excluded.comment`,
        attemptId, q.id, p, (comments['k' + q.id] || '').slice(0, 2000) || null);
    }
    const { score, max } = recompute(attemptId);
    run("UPDATE attempts SET status = 'graded', score = ?, max_score = ?, feedback = COALESCE(NULLIF(?, ''), feedback) WHERE id = ?", score, max, feedback || '', attemptId);
  });
}

// Ferme automatiquement les tentatives dont le temps est écoulé
function expireOverdue() {
  const overdue = all("SELECT id FROM attempts WHERE status = 'in_progress' AND deadline_at < ?", new Date(Date.now() - 60000).toISOString());
  overdue.forEach(a => submit(a.id));
}

module.exports = { autoGrade, startOrResume, saveResponses, submit, review, expireOverdue, placementLevel };
