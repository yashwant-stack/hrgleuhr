const key = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

export function designationOptions(db) {
  const names = [...(db.trainingTemplates?.Lists || []).map(row => row.Designation), 'Front Desk Manager', ...Object.keys(db.customDesignations || {})];
  return [...new Map(names.filter(Boolean).map(name => [key(name), name])).values()];
}

// Called inside the store transaction so designation and template mapping persist together.
export function addDesignation(db, value, baseValue = 'All') {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 100) fail('Enter a designation between 1 and 100 characters');
  if (['__proto__', 'prototype', 'constructor', 'all', 'other'].includes(key(name))) fail('Enter a specific designation name');
  const names = designationOptions(db);
  const existing = names.find(option => key(option) === key(name));
  if (existing) return { designation: existing, created: false };
  const base = ['All', ...names].find(option => key(option) === key(baseValue));
  if (!base || key(base) === 'other') fail('Select a valid base designation');
  db.customDesignations ??= {};
  db.customDesignations[name] = base;
  db.trainingTemplates.Lists.push({ Designation: name, 'Custom Designation': name, 'Use Checklist Of': base });
  return { designation: name, created: true };
}
