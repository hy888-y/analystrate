'use server';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

// Always gives the same answer, so nobody can use this page to find out which emails exist.
export async function requestReset(_prev, formData) {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid company email.' };
  const site = process.env.NEXT_PUBLIC_SITE_URL || '';
  try {
    await createClient({ remember: false }).auth.resetPasswordForEmail(email, { redirectTo: `${site}/auth/callback?next=/reset-password` });
  } catch { /* same response either way */ }
  await logAudit({ actorEmail: email, action: 'auth.reset_requested' });
  return { done: true };
}
