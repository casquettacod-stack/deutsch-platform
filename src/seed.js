// Initialisation : crée le compte admin et (option --demo) du contenu d'exemple
// Usage : node src/seed.js            → admin seulement
//         node src/seed.js --demo     → admin + prof + étudiant + cours + examens d'exemple
require('./env');
const bcrypt = require('bcryptjs');
const { get, run, tx } = require('./db');

const email = process.env.ADMIN_EMAIL || 'admin@centre.ma';
const password = process.env.ADMIN_PASSWORD || 'Admin12345!';

function ensureUser(name, mail, pwd, role, level = null) {
  const u = get('SELECT id FROM users WHERE email = ?', mail);
  if (u) return u.id;
  return Number(run('INSERT INTO users (name, email, password_hash, role, level) VALUES (?,?,?,?,?)', name, mail, bcrypt.hashSync(pwd, 10), role, level).lastInsertRowid);
}

const adminId = ensureUser('Administrateur', email, password, 'admin');
console.log(`✔ Admin : ${email} / ${process.env.ADMIN_PASSWORD ? '(mot de passe du .env)' : password}`);

if (!process.argv.includes('--demo')) process.exit(0);
if (get("SELECT id FROM exams WHERE kind = 'placement'")) { console.log('Contenu de démo déjà présent.'); process.exit(0); }

const teacherId = ensureUser('Frau Schneider', 'prof@centre.ma', 'Prof12345!', 'teacher');
const studentId = ensureUser('Youssef Étudiant', 'etudiant@centre.ma', 'Etudiant123!', 'student');

const addQ = (examId, list) => list.forEach((q, i) => run(
  'INSERT INTO questions (exam_id, section, type, prompt, options, answer, points, position) VALUES (?,?,?,?,?,?,?,?)',
  examId, q.s, q.t, q.p, q.o ? JSON.stringify(q.o) : null, q.a ?? null, q.pts || 1, i + 1));

tx(() => {
  // ----- Test de niveau -----
  const pl = run(`INSERT INTO exams (title, level, kind, description, duration_min, pass_percent, max_attempts, published, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`, 'Einstufungstest – Test de niveau', 'A1', 'placement',
    "Répondez sans dictionnaire. Les questions deviennent progressivement plus difficiles. Si vous ne savez pas, passez à la suivante.\nÀ la fin, la plateforme vous recommande un niveau.",
    25, 0, 2, 1, adminId).lastInsertRowid;
  addQ(pl, [
    { s: 'Grammatik', t: 'mcq', p: 'Ich ___ aus Marokko.', o: ['bin', 'komme', 'heiße', 'wohnt'], a: '1' },
    { s: 'Grammatik', t: 'mcq', p: 'Wie ___ du?', o: ['heißt', 'heiße', 'heißen', 'heißt ihr'], a: '0' },
    { s: 'Wortschatz', t: 'mcq', p: 'Was ist das Gegenteil von „groß“?', o: ['lang', 'klein', 'alt', 'schnell'], a: '1' },
    { s: 'Grammatik', t: 'mcq', p: 'Das ist ___ Buch.', o: ['der', 'die', 'das', 'den'], a: '2' },
    { s: 'Grammatik', t: 'mcq', p: 'Ich habe ___ Bruder und zwei Schwestern.', o: ['ein', 'einen', 'eine', 'einem'], a: '1' },
    { s: 'Grammatik', t: 'mcq', p: 'Gestern ___ ich ins Kino gegangen.', o: ['habe', 'bin', 'war', 'wurde'], a: '1' },
    { s: 'Grammatik', t: 'mcq', p: 'Ich wohne seit drei Jahren ___ Casablanca.', o: ['nach', 'zu', 'in', 'bei'], a: '2' },
    { s: 'Grammatik', t: 'mcq', p: 'Kannst du mir ___ helfen?', o: ['mich', 'mir', 'dir', 'dich'], a: '2' },
    { s: 'Grammatik', t: 'mcq', p: 'Ich lerne Deutsch, ___ ich in Deutschland arbeiten möchte.', o: ['denn', 'weil', 'deshalb', 'obwohl'], a: '1' },
    { s: 'Grammatik', t: 'mcq', p: 'Wenn ich mehr Zeit ___, würde ich mehr reisen.', o: ['habe', 'hätte', 'hatte', 'haben'], a: '1' },
    { s: 'Grammatik', t: 'mcq', p: 'Das ist der Mann, ___ ich gestern geholfen habe.', o: ['der', 'den', 'dem', 'dessen'], a: '2' },
    { s: 'Wortschatz', t: 'mcq', p: 'Er hat sich ___ die neue Stelle beworben.', o: ['für', 'um', 'auf', 'an'], a: '1' },
    { s: 'Grammatik', t: 'mcq', p: 'Das Haus ___ im Jahr 1990 gebaut.', o: ['wird', 'wurde', 'hat', 'ist worden'], a: '1' },
    { s: 'Grammatik', t: 'mcq', p: '___ des schlechten Wetters fand das Konzert statt.', o: ['Wegen', 'Trotz', 'Während', 'Statt'], a: '1' },
    { s: 'Wortschatz', t: 'mcq', p: 'Die Firma hat beschlossen, die Produktion ins Ausland zu ___.', o: ['verlegen', 'verlängern', 'verlieren', 'vertreten'], a: '0' },
    { s: 'Grammatik', t: 'mcq', p: 'Er tut so, als ___ er nichts davon gewusst.', o: ['hat', 'hätte', 'habe', 'würde'], a: '1' },
    { s: 'Wortschatz', t: 'mcq', p: 'Sein Vorschlag stieß bei den Kollegen auf wenig ___.', o: ['Gegenliebe', 'Rücksicht', 'Vorsicht', 'Ansicht'], a: '0' },
    { s: 'Lesen', t: 'tf', p: '„Die Bäckerei ist montags bis freitags von 7 bis 18 Uhr geöffnet, samstags bis 13 Uhr.“\n\nAm Samstagnachmittag kann man dort Brot kaufen.', a: 'false' },
    { s: 'Lesen', t: 'tf', p: '„Trotz intensiver Bemühungen konnte das Projekt nicht fristgerecht abgeschlossen werden.“\n\nDas Projekt wurde rechtzeitig fertig.', a: 'false' },
    { s: 'Grammatik', t: 'short', p: 'Ergänzen Sie das Verb „sein“: Wir ___ Studenten.', a: 'sind' },
  ]);

  // ----- Cours A1 -----
  const c = run('INSERT INTO courses (title, level, description, teacher_id, published) VALUES (?,?,?,?,1)',
    'Deutsch A1 – Grundkurs', 'A1', 'Premier cours pour débutants complets : se présenter, compter, parler de sa famille, faire des courses.\nPréparation à l’examen **Start Deutsch 1 / Goethe-Zertifikat A1**.', teacherId).lastInsertRowid;
  const lessons = [
    ['Lektion 1 – Hallo! Ich bin…', '# Sich vorstellen\n**Hallo! / Guten Tag!** – Bonjour\n**Ich heiße …** – Je m’appelle …\n**Ich komme aus Marokko.** – Je viens du Maroc.\n**Ich wohne in Rabat.** – J’habite à Rabat.\n\n## Les verbes au présent\n- ich heiße · du heißt · er/sie heißt\n- ich komme · du kommst · er/sie kommt\n\n## Übung\nPrésentez-vous en 4 phrases et envoyez un message vocal à votre professeur.'],
    ['Lektion 2 – Zahlen und Uhrzeit', '# Die Zahlen 0–100\neins, zwei, drei, vier, fünf, sechs, sieben, acht, neun, zehn …\n\n**Wie spät ist es?** – Quelle heure est-il ?\n- Es ist acht Uhr.\n- Es ist halb neun (8h30).'],
    ['Lektion 3 – Meine Familie', '# Die Familie\n- der Vater, die Mutter, die Eltern\n- der Bruder, die Schwester, die Geschwister\n\n**Ich habe einen Bruder und eine Schwester.**\n\n## Les articles possessifs\nmein Vater · meine Mutter · meine Eltern'],
  ];
  lessons.forEach(([t, body], i) => run('INSERT INTO lessons (course_id, title, content, position) VALUES (?,?,?,?)', c, t, body, i + 1));
  run('INSERT INTO enrollments (user_id, course_id) VALUES (?,?)', studentId, c);

  // ----- Examen blanc A1 -----
  const ex = run(`INSERT INTO exams (title, level, kind, description, course_id, duration_min, pass_percent, max_attempts, published, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, 'Modelltest A1 – Start Deutsch 1', 'A1', 'exam',
    'Examen blanc sur le modèle de l’examen officiel : **Lesen, Hören, Schreiben**. Le Sprechen est évalué en classe.', c, 45, 60, 3, 1, teacherId).lastInsertRowid;
  addQ(ex, [
    { s: 'Lesen', t: 'tf', p: '**Text:** „Liebe Anna, ich komme am Samstag um 15 Uhr zu dir. Ich bringe Kuchen mit. Bis dann, Sara“\n\nSara kommt am Sonntag.', a: 'false', pts: 2 },
    { s: 'Lesen', t: 'tf', p: '(même texte) Sara bringt Kuchen mit.', a: 'true', pts: 2 },
    { s: 'Lesen', t: 'mcq', p: 'Im Bahnhof steht: „Gleis 3: ICE nach Berlin, Abfahrt 10:15“. Wann fährt der Zug?', o: ['Um 3 Uhr', 'Um 10:15 Uhr', 'Um 10:50 Uhr'], a: '1', pts: 2 },
    { s: 'Hören', t: 'mcq', p: '(Le professeur peut joindre un fichier audio ici.) Sie hören: „Der Termin beim Arzt ist am Dienstag um neun Uhr.“ — Wann ist der Termin?', o: ['Montag, 9 Uhr', 'Dienstag, 9 Uhr', 'Dienstag, 10 Uhr'], a: '1', pts: 2 },
    { s: 'Grammatik', t: 'short', p: 'Ergänzen Sie: Ich ___ (haben) zwei Kinder.', a: 'habe', pts: 1 },
    { s: 'Grammatik', t: 'mcq', p: 'Wo ___ du?', o: ['wohne', 'wohnst', 'wohnt'], a: '1', pts: 1 },
    { s: 'Schreiben', t: 'essay', p: 'Sie möchten am Wochenende einen Deutschkurs besuchen. Schreiben Sie eine E-Mail an die Sprachschule (ca. 30 Wörter):\n- Warum schreiben Sie?\n- Wann haben Sie Zeit?\n- Fragen Sie nach dem Preis.', pts: 10 },
  ]);

  run('INSERT INTO announcements (title, body, created_by) VALUES (?,?,?)', 'Willkommen auf unserer Plattform!',
    'Bienvenue ! Passez le **test de niveau**, puis retrouvez vos cours et vos examens ici. Viel Erfolg!', adminId);
  run('INSERT INTO groups_ (name, level, teacher_id, schedule) VALUES (?,?,?,?)', 'A1 – Abendkurs', 'A1', teacherId, 'Lun/Mer 18:00–20:00');
  run('INSERT INTO group_members (group_id, user_id) VALUES ((SELECT MAX(id) FROM groups_), ?)', studentId);
});
console.log('✔ Démo : prof@centre.ma / Prof12345!  ·  etudiant@centre.ma / Etudiant123!');
