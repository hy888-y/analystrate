import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Fallback for email links that use the "code" format.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const n = searchParams.get('next');
  const next = n && n.startsWith('/') && !n.startsWith('//') ? n : '/reset-password';
  if (code) {
    const { error } = await createClient({ remember: false }).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?e=link`);
}
