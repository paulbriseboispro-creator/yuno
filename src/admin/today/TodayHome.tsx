/**
 * « Aujourd'hui », PROVISOIRE (lot 0) : le « À faire aujourd'hui » de
 * l'ex-Admin CRM, puis le Cockpit de la Suite, tels quels. Le lot 1 le
 * remplace par la file unique `admin_today` (une ligne par chose à faire,
 * chacune avec son action), six chiffres, les feux et le fil d'activité.
 */
import { lazy, Suspense, useMemo } from 'react';
import { buildTodo } from '@/crm/lib/admin';
import { TodoCard } from '@/crm/admin/pages/CockpitPage';
import { useAdminAccounts } from '@/crm/admin/data';
import { CrmFrame, PageBoundary, SuiteFrame } from '../shell/frames';
import { PageLoading } from '../shell/AdminShell';

const AdminCockpit = lazy(() => import('@/pages/admin/AdminCockpit'));

function CrmTodo() {
  const q = useAdminAccounts();
  const todo = useMemo(() => (q.data ? buildTodo(q.data.accounts) : []), [q.data]);
  if (!q.data) return null;
  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: '24px clamp(16px,3vw,40px) 8px' }}>
      <TodoCard todo={todo} />
    </div>
  );
}

export default function TodayHome() {
  return (
    <>
      {/* Deux blocs, deux pare-feu : l'un qui casse laisse l'autre lisible. */}
      <PageBoundary resetKey="crm-todo"><CrmFrame><CrmTodo /></CrmFrame></PageBoundary>
      <PageBoundary resetKey="cockpit">
        <SuiteFrame><Suspense fallback={<PageLoading />}><AdminCockpit /></Suspense></SuiteFrame>
      </PageBoundary>
    </>
  );
}
