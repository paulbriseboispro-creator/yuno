/**
 * La phrase-réponse d'un compte : depuis quand il vend, ce qu'il a vendu sur
 * 30 jours, ce qu'il prépare, où en est son Yuno CRM. Rien d'inventé : chaque
 * morceau sort d'admin_account (accountStory) ou de la ligne de liste.
 */
import { fmtDate, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { useAdminT } from '@/admin/ui';
import type { AccountRow } from '../accounts';
import type { accountStory } from '../story';

export function AccountSentence({ story, row, className }: { story: ReturnType<typeof accountStory>; row: Pick<AccountRow, 'type' | 'status'> | null; className?: string }) {
  const { t, lang } = useAdminT();
  const month = story.since ? new Intl.DateTimeFormat(lang, { month: 'long', year: story.since.slice(0, 4) === String(new Date().getFullYear()) ? undefined : 'numeric' }).format(new Date(`${story.since}-15T12:00:00Z`)) : null;
  const parts: React.ReactNode[] = [];
  const agency = row?.type === 'agency';
  if (agency) {
    parts.push(story.sales30 > 0
      ? <>{t('adm.pros.v3.s.agency')} <b>{fmtNum(story.sales30, lang)}</b> {t('adm.pros.v3.s.attributed')}</>
      : t('adm.pros.v3.s.agencyNone'));
  } else if (month) {
    parts.push(<>{t('adm.pros.v3.s.since')} <b>{month}</b></>);
    parts.push(story.sales30 > 0
      ? <><b>{fmtNum(story.sales30, lang)}</b> {t(story.sales30 === 1 ? 'adm.pros.v3.s.sale30' : 'adm.pros.v3.s.sales30')}</>
      : story.lastSaleAt ? t('adm.pros.v3.s.quiet', { when: fmtRelative(story.lastSaleAt, lang) }) : t('adm.pros.v3.s.quiet30'));
  } else {
    parts.push(t(row?.status === 'invited' ? 'adm.pros.v3.s.invited' : 'adm.pros.v3.s.never'));
  }
  if (!agency) {
    parts.push(story.upcoming > 0
      ? <><b>{fmtNum(story.upcoming, lang)}</b> {t(story.upcoming === 1 ? 'adm.pros.v3.s.upOne' : 'adm.pros.v3.s.up')}</>
      : t('adm.pros.v3.s.noUp'));
  }
  if (story.crmState === 'trial') parts.push(story.trialEndsAt ? <>{t('adm.pros.v3.s.trialUntil')} <b>{fmtDate(story.trialEndsAt, lang)}</b></> : t('adm.pros.v3.s.trial'));
  else if (story.crmState === 'paid') parts.push(t('adm.pros.v3.s.crmPaid'));
  else if (story.crmState === 'late') parts.push(t('adm.pros.v3.s.crmLate'));
  else if (story.crmState === 'paused' || story.crmState === 'churned') parts.push(t('adm.pros.v3.s.crmPaused'));
  return (
    <p className={className ?? 'a-hero-sentence'}>
      {parts.map((p, i) => <span key={i}>{i > 0 ? ', ' : ''}{p}</span>)}.
    </p>
  );
}
