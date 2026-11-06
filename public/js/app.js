// Menu mobile + confirmation des actions destructrices
document.addEventListener('click', e => {
  const t = e.target.closest('.menu-toggle');
  if (t) document.querySelector('.nav').classList.toggle('open');
});
document.addEventListener('submit', e => {
  const msg = e.target.getAttribute('data-confirm');
  if (msg && !confirm(msg)) e.preventDefault();
});

// Formulaire de question : afficher les champs selon le type
document.querySelectorAll('[data-qform]').forEach(form => {
  const sel = form.querySelector('[name=type]');
  const sync = () => form.querySelectorAll('[data-for]').forEach(el => {
    el.hidden = !el.getAttribute('data-for').split(' ').includes(sel.value);
  });
  sel.addEventListener('change', sync); sync();
});

// Cocher / décocher tous
document.querySelectorAll('[data-check-all]').forEach(cb => cb.addEventListener('change', () => {
  document.querySelectorAll(cb.getAttribute('data-check-all')).forEach(x => { if (!x.closest('[hidden]')) x.checked = cb.checked; });
}));

// Filtre de liste
document.querySelectorAll('[data-filter]').forEach(inp => inp.addEventListener('input', () => {
  const v = inp.value.toLowerCase();
  document.querySelectorAll(inp.getAttribute('data-filter')).forEach(el => { el.hidden = !el.textContent.toLowerCase().includes(v); });
}));
