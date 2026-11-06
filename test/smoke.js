// Test de bout en bout : lance l'app sur une base temporaire et parcourt les parcours principaux
const os = require('os'), fs = require('fs'), path = require('path');
const assert = require('assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-test-'));
process.env.NODE_ENV = 'test';
process.argv.push('--demo');
const { execFileSync } = require('child_process');
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '../src/seed.js'), '--demo'], { env: process.env, stdio: 'inherit' });
const app = require('../src/app');
const { get } = require('../src/db');

function client(base) {
  let cookie = '';
  const req = async (method, url, body) => {
    const r = await fetch(base + url, { method, redirect: 'manual', headers: { cookie, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: body ? new URLSearchParams(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, location: r.headers.get('location'), text: await r.text() };
  };
  const csrf = async (url = '/login') => (await req('GET', url)).text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  return { req, csrf, cookie: () => cookie, async login(email, password) { const t = await csrf(); return req('POST', '/login', { _csrf: t, email, password }); } };
}

(async () => {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  let fails = 0;
  const check = async (c, url, code = 200) => {
    const r = await c.req('GET', url);
    const ok = r.status === code;
    if (!ok) { fails++; console.log('✗', url, r.status, r.text.slice(0, 300)); } else console.log('✓', url);
    return r;
  };
  try {
    const pub = client(base);
    await check(pub, '/');
    await check(pub, '/login'); await check(pub, '/register');
    await check(pub, '/dashboard', 302); await check(pub, '/admin', 302);
    let t = await pub.csrf('/');
    let r = await pub.req('POST', '/contact', { _csrf: t, name: 'Test Lead', phone: '0600000000', level: 'B1' });
    assert.equal(r.status, 302);
    r = await pub.req('POST', '/contact', { name: 'x', phone: '1' });
    assert.equal(r.status, 403, 'CSRF doit bloquer');

    // Étudiant
    const st = client(base);
    r = await st.login('etudiant@centre.ma', 'Etudiant123!');
    assert.equal(r.location, '/dashboard');
    for (const u of ['/dashboard', '/courses', '/exams', '/results', '/profile', '/courses/1', '/lessons/1']) await check(st, u);
    await check(st, '/admin', 403); await check(st, '/teach', 403);
    // Passer l'examen A1 (id 2)
    t = await st.csrf('/exams/2');
    r = await st.req('POST', '/exams/2/start', { _csrf: t });
    const attemptUrl = r.location; assert.match(attemptUrl, /^\/attempts\/\d+$/);
    const page = await check(st, attemptUrl);
    const qids = [...page.text.matchAll(/name="q\[k(\d+)\]"/g)].map(m => m[1]);
    const uniq = [...new Set(qids)];
    const answers = { _csrf: t };
    const qs = uniq.map(id => get('SELECT * FROM questions WHERE id = ?', id));
    qs.forEach(q => { answers[`q[k${q.id}]`] = q.type === 'essay' ? 'Sehr geehrte Damen und Herren, ich möchte einen Kurs besuchen.' : q.type === 'short' ? 'Habe' : q.answer; });
    r = await st.req('POST', attemptUrl + '/save', answers);
    assert.equal(r.status, 200);
    r = await st.req('POST', attemptUrl + '/submit', answers);
    assert.match(r.location, /^\/results\/\d+$/);
    const res = await check(st, r.location);
    assert.ok(res.text.includes('En cours de correction'), 'rédaction → correction manuelle: ' + res.text.slice(res.text.indexOf('<main'), res.text.indexOf('<main') + 600));
    const attemptId = attemptUrl.split('/').pop();
    const a = get('SELECT * FROM attempts WHERE id = ?', attemptId);
    assert.equal(a.status, 'pending_review'); assert.equal(a.score, 10); assert.equal(a.max_score, 20);

    // Test de niveau
    t = await st.csrf('/exams/1');
    r = await st.req('POST', '/exams/1/start', { _csrf: t });
    r = await st.req('POST', r.location + '/submit', { _csrf: t });
    const pr = get("SELECT * FROM attempts WHERE exam_id = 1");
    assert.equal(pr.status, 'graded'); assert.match(pr.feedback, /A1/);

    // Professeur
    const pf = client(base);
    r = await pf.login('prof@centre.ma', 'Prof12345!');
    assert.equal(r.location, '/teach');
    for (const u of ['/teach', '/teach/courses', '/teach/courses/1', '/teach/courses/new', '/teach/lessons/1/edit', '/teach/courses/1/lessons/new',
      '/teach/exams', '/teach/exams/new', '/teach/exams/2', '/teach/exams/2?q=1', '/teach/exams/2/results', '/teach/exams/2/results.csv', '/teach/review',
      '/teach/attempts/' + attemptId, '/teach/groups/1', '/teach/students/3']) await check(pf, u);
    await check(pf, '/admin', 403);
    t = await pf.csrf('/teach');
    const essay = qs.find(q => q.type === 'essay');
    r = await pf.req('POST', `/teach/attempts/${attemptId}/grade`, { _csrf: t, [`points[k${essay.id}]`]: '7.5', [`comments[k${essay.id}]`]: 'Gut!', feedback: 'Weiter so' });
    assert.equal(r.status, 302);
    const g = get('SELECT * FROM attempts WHERE id = ?', attemptId);
    assert.equal(g.status, 'graded'); assert.equal(g.score, 17.5);
    // créer un cours, une question QCM
    r = await pf.req('POST', '/teach/courses', { _csrf: t, title: 'B1 Test', level: 'B1', published: '1' });
    assert.match(r.location, /\/teach\/courses\/\d+/);
    r = await pf.req('POST', '/teach/exams', { _csrf: t, title: 'Quiz B1', level: 'B1', kind: 'quiz', duration_min: '10', pass_percent: '50', max_attempts: '0', published: '1' });
    const examId = r.location.split('/').pop();
    const fd = new FormData();
    fd.set('_csrf', t); fd.set('section', 'Wortschatz'); fd.set('type', 'mcq'); fd.set('prompt', 'Test?'); fd.set('points', '2');
    ['a', 'b', 'c', ''].forEach(o => fd.append('options[]', o)); fd.set('correct', '2');
    fd.set('media', new Blob(['ID3fake'], { type: 'audio/mpeg' }), 'hoeren.mp3');
    const qr = await fetch(base + `/teach/exams/${examId}/questions`, { method: 'POST', body: fd, redirect: 'manual', headers: { cookie: pf.cookie() } });
    assert.equal(qr.status, 302, 'upload question');
    const nq = get('SELECT * FROM questions WHERE exam_id = ?', examId);
    assert.equal(nq.answer, '2'); assert.equal(JSON.parse(nq.options).length, 3); assert.ok(nq.media_path);
    await check(pf, '/files/' + nq.media_path);
    await check(pub, '/files/' + nq.media_path, 302);
    // grades
    r = await pf.req('POST', '/teach/groups/1/grades', { _csrf: t, title: 'Mündlich 1', skill: 'Sprechen', max_score: '20', 'score[k3]': '15' });
    assert.equal(get("SELECT score FROM grades WHERE title = 'Mündlich 1'").score, 15);
    await check(st, '/results');

    // Admin
    const ad = client(base);
    r = await ad.login('admin@centre.ma', 'Admin12345!');
    assert.equal(r.location, '/admin');
    for (const u of ['/admin', '/admin/users', '/admin/users?role=student&q=you', '/admin/users/new', '/admin/users/3', '/admin/groups', '/admin/groups/1', '/admin/leads', '/admin/announcements', '/teach']) await check(ad, u);
    t = await ad.csrf('/admin');
    r = await ad.req('POST', '/admin/users/import', { _csrf: t, csv: 'Ali Test;ali@test.ma;0611;A2\nBad line' });
    assert.ok(r.text.includes('ali@test.ma'), r.status + r.text.slice(0, 800));
    r = await ad.req('POST', '/admin/users/3/reset-password', { _csrf: t });
    assert.equal(r.status, 302);
    const back = await ad.req('GET', '/admin/backup'); assert.equal(back.status, 200);
  } catch (e) { fails++; console.error(e); }
  server.close();
  console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests sont passés ✔');
  process.exit(fails ? 1 : 0);
})();

