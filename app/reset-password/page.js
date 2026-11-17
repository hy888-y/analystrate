import { Suspense } from 'react';
import ResetForm from '@/components/ResetForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set password · TaskLedger' };
export default function ResetPage() {
  return <Suspense fallback={null}><ResetForm /></Suspense>;
}
