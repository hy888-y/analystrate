import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC = ['/login', '/forgot-password', '/auth/'];
const ADMIN_ONLY = { '/manager/users': 'users.manage', '/manager/audit': 'audit.view' };
const strip = (o) => { const { maxAge, expires, ...rest } = o || {}; return rest; };

export async function middleware(request) {
  const path = request.nextUrl.pathname;
  const remember = request.cookies.get('yl_rem')?.value !== '0';
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, remember ? options : strip(options)));
      },
    },
  });

  // Validates the session with Supabase (not just the cookie)
  const { data: { user } } = await supabase.auth.getUser();
  const isPublic = PUBLIC.some((p) => path.startsWith(p));

  const go = (to, params) => {
    const url = request.nextUrl.clone();
    url.pathname = to; url.search = '';
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const r = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  if (!user) {
    if (isPublic) return response;
    return go('/login', path !== '/' && path !== '/reset-password' ? { next: path } : undefined);
  }

  // Automatic logout after inactivity (checked on the server for every page request)
  // Remember me: stay signed in up to 7 days without activity; otherwise SESSION_IDLE_MINUTES.
  const idleMs = remember ? 7 * 24 * 3600000 : Number(process.env.NEXT_PUBLIC_SESSION_IDLE_MINUTES || 30) * 60000;
  const last = Number(request.cookies.get('yl_last')?.value || 0);
  if (!path.startsWith('/auth/') && last && Date.now() - last > idleMs) {
    await supabase.auth.signOut();
    const r = go('/login', { e: 'timeout' });
    r.cookies.delete('yl_last');
    return r;
  }

  if (path.startsWith('/auth/') || path === '/forgot-password') return response;

  const { data: prof } = await supabase.from('profiles').select('role,status,must_change_password').eq('id', user.id).single();
  if (!prof || prof.status !== 'active') {
    await supabase.auth.signOut();
    return go('/login', { e: 'inactive' });
  }
  const home = prof.role === 'staff' ? '/staff' : '/manager';
  if (path === '/login') return go(home);
  if (prof.must_change_password && path !== '/reset-password') return go('/reset-password', { forced: '1' });
  if (path === '/') return go(home);

  // Role-based route protection: typing a URL by hand cannot bypass it
  if (path.startsWith('/manager') && prof.role === 'staff') return go('/staff', { denied: '1' });
  const staffPreview = prof.role === 'admin' && (request.cookies.get('tl_preview')?.value || '').startsWith('staff:');
  if (path.startsWith('/staff') && prof.role !== 'staff' && !staffPreview) return go('/manager');
  for (const [prefix, perm] of Object.entries(ADMIN_ONLY)) {
    if (path.startsWith(prefix) && prof.role !== 'admin') {
      if (perm === 'admin') return go('/manager', { denied: '1' });
      const { data: ok } = await supabase.rpc('has_perm', { p: perm });
      if (!ok) return go('/manager', { denied: '1' });
    }
  }

  response.cookies.set('yl_last', String(Date.now()), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/',
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  });
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
