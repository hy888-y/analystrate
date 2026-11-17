import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Handles links from invitation and password-reset emails.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = safeNext(searchParams.get('next'));
  if (token_hash && type) {
    const supabase = createClient({ remember: false });
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      const r = NextResponse.redirect(`${origin}${next}`);
      r.cookies.set('yl_last', String(Date.now()), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
      return r;
    }
  }
  return NextResponse.redirect(`${origin}/login?e=link`);
}
function safeNext(n) { return n && n.startsWith('/') && !n.startsWith('//') ? n : '/reset-password'; }
