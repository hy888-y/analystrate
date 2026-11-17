import { requirePerm } from '@/lib/auth';
import AuditLog from './AuditLog';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit log · TaskLedger' };
export default async function Page() { await requirePerm('audit.view'); return <AuditLog />; }
