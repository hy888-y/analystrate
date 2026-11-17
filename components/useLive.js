'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

// Loads data and reloads it whenever any of the given tables change (live sync between portals)
export function useLive(loader, tables, key = '') {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const loaderRef = useRef(loader); loaderRef.current = loader;
  const timer = useRef();

  const reload = useCallback(async () => {
    try { const d = await loaderRef.current(createClient()); setData(d); setError(null); }
    catch (e) { setError(e.message || 'Could not load data.'); }
  }, []);

  useEffect(() => {
    reload();
    const sb = createClient();
    const ch = sb.channel(`live:${tables.join(',')}:${key}:${Math.random().toString(36).slice(2)}`);
    tables.forEach((t) => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => {
      clearTimeout(timer.current); timer.current = setTimeout(reload, 300);
    }));
    ch.subscribe();
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => { clearTimeout(timer.current); sb.removeChannel(ch); window.removeEventListener('focus', onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, error, reload };
}

export async function must(q) {
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
