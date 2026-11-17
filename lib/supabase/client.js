'use client';
import { createBrowserClient } from '@supabase/ssr';

let client;
export function createClient() {
  if (client) return client;
  const sessionOnly = typeof document !== 'undefined' && /(?:^|;\s*)yl_rem_ui=0/.test(document.cookie);
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    sessionOnly ? { cookieOptions: { maxAge: undefined } } : undefined
  );
  return client;
}
