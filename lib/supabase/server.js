import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// remember=false turns the login cookies into browser-session cookies
// (they disappear when the browser is closed).
export function stripPersistence(options) {
  const { maxAge, expires, ...rest } = options || {};
  return rest;
}

export function createClient({ remember } = {}) {
  const store = cookies();
  const keep = remember ?? store.get('yl_rem')?.value !== '0';
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return store.getAll(); },
        setAll(list) {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, keep ? options : stripPersistence(options)));
          } catch { /* called from a Server Component: middleware refreshes the session instead */ }
        },
      },
    }
  );
}
