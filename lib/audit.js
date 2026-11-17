import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export async function logAudit({ actorId = null, actorEmail = null, action, targetType = null, targetId = null, details = null }) {
  try {
    await createAdminClient().from('audit_log').insert({
      actor_id: actorId, actor_email: actorEmail, action, target_type: targetType, target_id: targetId ? String(targetId) : null, details,
    });
  } catch { /* audit failures must never block the user action */ }
}
