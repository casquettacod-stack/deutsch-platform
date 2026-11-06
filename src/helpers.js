// Fonctions disponibles dans toutes les vues EJS
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Mini-Markdown sûr : # titres, **gras**, *italique*, listes "- ", liens, tableaux non gérés
function md(text) {
  const lines = esc(text).split(/\r?\n/);
  let html = '', inList = false;
  for (const raw of lines) {
    let l = raw
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    if (/^\s*[-•]\s+/.test(l)) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + l.replace(/^\s*[-•]\s+/, '') + '</li>'; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    const h = l.match(/^(#{1,3})\s+(.*)$/);
    if (h) html += `<h${h[1].length + 1}>${h[2]}</h${h[1].length + 1}>`;
    else if (l.trim()) html += '<p>' + l + '</p>';
  }
  return html + (inList ? '</ul>' : '');
}

const fmtDate = d => {
  if (!d) return '—';
  const dt = new Date(String(d).includes('T') ? d : String(d).replace(' ', 'T') + 'Z');
  return dt.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Africa/Casablanca' });
};
const pct = (s, m) => (m ? Math.round((s / m) * 100) : 0);
const STATUS = { in_progress: 'En cours', pending_review: 'En correction', graded: 'Corrigé' };
const KIND = { exam: 'Examen', quiz: 'Quiz', placement: 'Test de niveau' };
const QTYPE = { mcq: 'Choix multiple', tf: 'Richtig / Falsch', short: 'Réponse courte', essay: 'Rédaction (correction manuelle)' };
const SECTION_ICON = { Lesen: '📖', Hören: '🎧', Schreiben: '✍️', Sprechen: '🗣️', Grammatik: '🧩', Wortschatz: '🔤' };
const isAudio = f => /\.(mp3|m4a|wav|ogg)$/i.test(f || '');
const isImage = f => /\.(png|jpe?g|gif|webp)$/i.test(f || '');
const isVideo = f => /\.(mp4|webm)$/i.test(f || '');

const plain = s => String(s || '').replace(/[*#\[\]]/g, '').replace(/\s+/g, ' ').trim();
module.exports = { plain, esc, md, fmtDate, pct, STATUS, KIND, QTYPE, SECTION_ICON, isAudio, isImage, isVideo };
