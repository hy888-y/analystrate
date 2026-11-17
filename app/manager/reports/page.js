import { requirePerm } from '@/lib/auth';
import Reports from './Reports';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports & Analytics · TaskLedger' };
export default async function Page() { await requirePerm('reports.view'); return <Reports />; }
