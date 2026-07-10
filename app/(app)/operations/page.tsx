import { redirect } from 'next/navigation';
import { getCurrentWorkspace } from '@/lib/workspace';
import OperationsClient from './OperationsClient';

export default async function OperationsPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) redirect(`/login?error=${encodeURIComponent(error || 'Not signed in')}`);
  return <OperationsClient workspace={workspace} />;
}
