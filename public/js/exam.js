// Passage d'examen : minuteur, sauvegarde automatique, soumission automatique
(function () {
  const form = document.getElementById('exam-form');
  if (!form) return;
  const deadline = new Date(form.dataset.deadline).getTime();
  const timer = document.getElementById('timer');
  const ind = document.getElementById('saved');
  let dirty = false, submitting = false;

  function tick() {
    const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
    timer.textContent = (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    timer.classList.toggle('low', left < 300);
    if (left === 0 && !submitting) { submitting = true; ind.textContent = 'Temps écoulé – envoi…'; form.submit(); }
  }
  tick(); setInterval(tick, 1000);

  function save() {
    if (!dirty || submitting) return;
    dirty = false;
    const data = new URLSearchParams(new FormData(form));
    ind.textContent = 'Enregistrement…';
    fetch(form.dataset.save, { method: 'POST', body: data, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, credentials: 'same-origin' })
      .then(r => r.json().catch(() => ({})).then(j => {
        if (j.expired) { location.reload(); return; }
        ind.textContent = r.ok ? '✓ Enregistré ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '⚠ Non enregistré';
      }))
      .catch(() => { dirty = true; ind.textContent = '⚠ Hors ligne – nouvel essai…'; });
  }
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('change', () => { dirty = true; save(); });
  setInterval(save, 15000);

  form.addEventListener('submit', e => {
    if (submitting) return;
    const total = form.querySelectorAll('.q').length;
    const answered = [...form.querySelectorAll('.q')].filter(q =>
      q.querySelector('input:checked') || [...q.querySelectorAll('textarea, input[type=text]')].some(t => t.value.trim())).length;
    const msg = answered < total ? `Vous avez répondu à ${answered}/${total} questions. Envoyer quand même ?` : 'Envoyer définitivement votre examen ?';
    if (!confirm(msg)) { e.preventDefault(); return; }
    submitting = true;
  });
  window.addEventListener('beforeunload', e => { if (!submitting && dirty) { save(); e.preventDefault(); e.returnValue = ''; } });

  // Compteur de mots pour les rédactions
  form.querySelectorAll('textarea[data-words]').forEach(t => {
    const out = document.getElementById(t.dataset.words);
    const upd = () => { out.textContent = (t.value.trim().match(/\S+/g) || []).length + ' mots'; };
    t.addEventListener('input', upd); upd();
  });
})();
