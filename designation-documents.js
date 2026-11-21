const designationKey = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

export function welcomeDocuments(db, designation) {
  return (db.designationDocuments || [])
    .filter(file => file.purpose === 'welcome' && designationKey(file.designation) === designationKey(designation))
    .map(({ id, filename, bytes, hash, contentType }) => ({ id, filename, bytes, hash, contentType }));
}

export function rememberWelcomeDocuments(db, designation, files, actor, at) {
  db.designationDocuments ??= [];
  for (const file of files) {
    if (welcomeDocuments(db, designation).some(existing => existing.id === file.id || existing.hash === file.hash && existing.filename === file.filename)) continue;
    db.designationDocuments.push({ ...file, designation, purpose: 'welcome', addedBy: actor, addedAt: at });
  }
}
