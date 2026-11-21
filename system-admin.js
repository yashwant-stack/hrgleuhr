export const SYSTEM_ADMIN_EMAIL = 'mizraem@gleuhr.com';
export const isSystemAdmin = user => user?.active !== false && user?.role === 'admin' && String(user?.email || '').trim().toLowerCase() === SYSTEM_ADMIN_EMAIL;
export const canManageUsers = (db, user) => isSystemAdmin(user) || (user?.role === 'admin' && !db.users.some(isSystemAdmin));
