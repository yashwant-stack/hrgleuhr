// Search only the material metadata already authorized for the current view.
function searchMaterials(materials, query) {
  const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/(.)\1{2,}/gu, '$1').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const terms = normalize(query).split(/\s+/).filter(Boolean).slice(0, 12);
  if (!terms.length) return materials.map(material => ({ material, score: 0 }));
  function distance(a, b) {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= b.length; j++) rows[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(rows[i-1][j]+1, rows[i][j-1]+1, rows[i-1][j-1]+(a[i-1] === b[j-1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) rows[i][j] = Math.min(rows[i][j], rows[i-2][j-2]+1);
    }
    return rows[a.length][b.length];
  }
  const matches = materials.map(material => {
    const title = normalize(material.title);
    const words = [...new Set(normalize([material.title, material.originalName, material.group, material.format, ...(material.roles || [])].join(' ')).split(' '))];
    let score = 0;
    for (const term of terms) {
      let best = 0;
      for (const word of words) {
        if (word === term) best = Math.max(best, 100);
        else if (word.startsWith(term)) best = Math.max(best, 80);
        else if (term.length >= 3 && word.includes(term)) best = Math.max(best, 65);
        else if (term.length >= 4 && term.length <= 50 && word.length <= 50) {
          const tolerance = term.length >= 7 ? 2 : 1;
          if (Math.abs(term.length - word.length) <= tolerance) {
            const edits = distance(term, word);
            if (edits <= tolerance) best = Math.max(best, 50 - edits * 10);
          }
        }
      }
      if (!best) return null;
      score += best + (title.includes(term) ? 25 : 0);
    }
    if (title === normalize(query)) score += 200;
    return { material, score };
  }).filter(Boolean);
  return matches.sort((a,b) => b.score-a.score || a.material.title.localeCompare(b.material.title));
}
