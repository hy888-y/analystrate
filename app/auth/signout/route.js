import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

export async function POST(request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await logAudit({ actorId: user.id, actorEmail: user.email, action: 'auth.logout', targetType: 'user', targetId: user.id });
    await supabase.auth.signOut();
  }
  const reason = new URL(request.url).searchParams.get('reason');
  const r = NextResponse.redirect(new URL(reason === 'timeout' ? '/login?e=timeout' : '/login?e=signedout', request.url), { status: 303 });
  r.cookies.delete('yl_last');
  return r;
}
