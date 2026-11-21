// Public portal address used in emails and generated links.
// Order: APP_URL (set this to the final domain) → Vercel's production domain → legacy address.
export const LEGACY_APP_URL = 'https://hrgleuhr.vercel.app';

export function appUrl(env = process.env) {
  const vercelDomain = env.VERCEL_PROJECT_PRODUCTION_URL && 'https://' + env.VERCEL_PROJECT_PRODUCTION_URL;
  return String(env.APP_URL || vercelDomain || LEGACY_APP_URL).trim().replace(/\/+$/, '');
}
