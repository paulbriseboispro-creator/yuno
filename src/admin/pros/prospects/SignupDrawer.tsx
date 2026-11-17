/**
 * Le détail d'une personne inscrite depuis la landing (Pros › Prospects, ligne
 * « Inscription »). Reprend ce que montrait l'ancienne page Inscriptions : ce
 * qui s'est passé, comment la joindre, ce qu'elle a déclaré (taille, fréquence,
 * outil), ce qu'il faut savoir avant d'appeler, l'avancement du compte, l'alerte
 * reçue par Paul et chaque parcours. Le funnel et les provenances vivent dans
 * Pilotage › Acquisition. Données : `admin_pro_signups.people` (une personne).
 */
import { Link } from 'react-router-dom';
import { Mail, MessageCircle, Phone } from 'lucide-react';
import { Badge, Card, Drawer, KeyValue, Status, Timeline, useAdminT, type KeyValueItem, type TimelineItem } from '@/admin/ui';
import { fmtDate, fmtNum, fmtPlural } from '@/lib/adminFormat';
import { whatsappUrl } from '@/lib/yunoLinks';
import { KNOWN_TOOLS } from '@/lib/proSignup';
import { KNOWN_DEVICES, alertChannels, journeyResult, personPhones, sourceText, type SignupPerson } from '@/lib/proSignupPeople';
import { accountHref, accountKey } from '../accounts';

const SIZE_LABEL: Record<string, string> = {
  lt300: '< 300', '300_800': '300–800', '800_1500': '800–1 500', gt1500: '1 500+',
  lt200: '< 200', '200_500': '200–500', '500_1500': '500–1 500',
};
const FREQ_LABEL: Record<string, string> = { '1': '1', '2_4': '2–4', '5plus': '5+', '5_plus': '5+' };

export function SignupDrawer({ person: p, onClose }: { person: SignupPerson | null; onClose: () => void }) {
  const { t, lang } = useAdminT();
  if (!p) return null;
  const phones = personPhones(p.phones, p.country);
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
  const title = p.org_name || name || p.email || phones[0]?.pretty || '—';
  const acc = p.account;
  const retries = p.retries_after_account;
  const kindKey = p.kind === 'club' || p.kind === 'organizer' || p.kind === 'promoter' ? p.kind : 'other';
  const accHref = acc ? (acc.venue_id ? accountHref(accountKey('venue', acc.venue_id)) : accountHref(accountKey('org', acc.user_id))) : null;

  const outcome = p.outcome === 'account'
    ? <Status tone="positive">{t('adm.signups.outcome.account', { d: fmtDate(acc?.created_at, lang, 'datetime') })}</Status>
    : p.outcome === 'deleted' ? <Status tone="neutral">{t('adm.signups.outcome.deleted')}</Status>
    : p.outcome === 'request' ? <Status tone="neutral">{t('adm.signups.outcome.request')}</Status>
    : p.outcome === 'invited' ? <Status tone="neutral">{t('adm.signups.outcome.invited')}</Status>
    : <Status tone="warning">{t('adm.signups.outcome.blocked', { s: t(`adm.signups.step.${p.furthest_step ?? 'opened'}`) })}</Status>;

  const waText = t(retries > 0 ? 'adm.signups.waRetry' : acc ? 'adm.signups.waAccount' : 'adm.signups.waLead', { name: p.first_name || '', org: p.org_name || '' });
  const wa = phones[0] ? whatsappUrl(phones[0].wa, waText) : null;

  const invite = p.invited && p.invite
    ? [t('adm.signups.invited'),
       p.invite.source === 'demo_preview' ? t('adm.signups.invite.demo')
         : p.invite.offer === 'founder' ? t('adm.signups.invite.founder')
         : p.invite.offer ? t('adm.signups.invite.standard') : null].filter(Boolean).join(' · ')
    : null;

  const facts: KeyValueItem[] = [
    { label: t('adm.pros.pr.col.who'), value: name || null },
    { label: t('adm.signups.email'), value: p.emails?.length > 1 ? p.emails.join(', ') : p.email },
    { label: t('adm.signups.phone'), value: phones.length ? phones.map((x) => x.pretty).join(' / ') : t('adm.signups.noPhone'), mono: phones.length > 0 },
    { label: t('adm.pros.pr.col.source'), value: sourceText(p.origin, t) },
    { label: t('adm.signups.cityLang'), value: [p.city, p.lang?.toUpperCase()].filter(Boolean).join(' · ') || null },
    { label: t('adm.signups.size'), value: p.size_band ? SIZE_LABEL[p.size_band] ?? p.size_band : null },
    { label: t('adm.signups.frequency'), value: p.frequency && FREQ_LABEL[p.frequency] ? t('adm.signups.perMonth', { n: FREQ_LABEL[p.frequency] }) : null },
    { label: t('adm.signups.currentTool'), value: p.current_tool && p.current_tool !== 'none' ? KNOWN_TOOLS[p.current_tool] ?? p.current_tool : null },
  ];

  const warnings: { text: string; tone: 'warning' | 'neutral' }[] = [];
  if (retries > 0) warnings.push({ text: fmtPlural(retries, lang, t('adm.signups.retriesOne'), t('adm.signups.retriesMany')), tone: 'warning' });
  if (acc && p.deleted_accounts > 0) warnings.push({ text: t('adm.signups.recreated'), tone: 'neutral' });
  if (p.next_night && p.outcome !== 'deleted') warnings.push({ text: t(`adm.signups.nextNight.${p.next_night}`), tone: p.next_night === 'week' || p.next_night === 'month' ? 'warning' : 'neutral' });

  const alerts: TimelineItem[] = p.alerts.map((a, i) => ({
    id: `a${i}`, at: a.sent_at ?? a.at, tone: a.status === 'sent' ? 'neutral' : a.status === 'failed' ? 'negative' : 'warning',
    title: a.status === 'sent' ? t(`adm.signups.alert.${a.kind}`) : t(a.status === 'failed' ? 'adm.signups.alertFailed' : 'adm.signups.alertPending'),
    body: a.status === 'sent' ? alertChannels(a).map((c) => t(`adm.signups.ch.${c}`)).join(', ') : undefined,
  }));
  const journeys: TimelineItem[] = p.journeys.map((j) => {
    const r = journeyResult(j);
    return {
      id: j.id, at: j.at, tone: r.key === 'account' ? 'positive' : r.key === 'stopped' ? 'warning' : 'neutral',
      title: r.key === 'stopped' ? t('adm.signups.j.stopped', { s: t(`adm.signups.step.${r.step}`) }) : t(`adm.signups.j.${r.key}`),
      body: [sourceText(j, t), j.device && KNOWN_DEVICES.has(j.device) ? t(`adm.signups.dev.${j.device}`) : null, j.has_email ? null : t('adm.signups.j.noEmail')].filter(Boolean).join(' · '),
    };
  });

  return (
    <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={title} description={outcome}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-1.5">
          <Badge>{t(`adm.signups.kind.${kindKey}`)}</Badge>
          {p.product === 'crm' && <Badge>{t('adm.signups.product.crm')}</Badge>}
          {invite && <Badge tone="accent">{invite}</Badge>}
          {p.contacted_at && <Badge tone="positive">{t('adm.signups.contacted')}</Badge>}
        </div>

        <div className="flex flex-wrap gap-2">
          {wa && <a className="a-btn a-btn--sm" href={wa} target="_blank" rel="noreferrer"><MessageCircle className="h-3.5 w-3.5" />{t('adm.signups.whatsapp')}</a>}
          {phones[0] && <a className="a-btn a-btn--sm" href={`tel:${phones[0].e164}`}><Phone className="h-3.5 w-3.5" />{t('adm.signups.call')}</a>}
          {p.email && <a className="a-btn a-btn--sm" href={`mailto:${p.email}`}><Mail className="h-3.5 w-3.5" />{t('adm.signups.email')}</a>}
          {accHref && <Link className="a-btn a-btn--sm" to={accHref}>{t('adm.signups.open')}</Link>}
        </div>

        {warnings.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {warnings.map((w) => <Status key={w.text} tone={w.tone}>{w.text}</Status>)}
          </div>
        )}

        <KeyValue items={facts.filter((f) => f.value)} />

        {acc && (
          <Card title={t('adm.signups.progress')}>
            <div className="flex flex-wrap gap-1.5">
              {([['console', !!acc.console_opened_at], ['night', acc.events > 0], ['pay', acc.payments], ['live', acc.live]] as const).map(([k, ok]) => (
                <Badge key={k} tone={ok ? 'positive' : 'neutral'}>
                  {t(`adm.signups.p.${k}`)}{k === 'night' && acc.events > 1 ? ` · ${fmtNum(acc.events, lang)}` : ''}
                </Badge>
              ))}
            </div>
          </Card>
        )}

        {p.admin_notes && <Card title={t('adm.signups.notes')}><p className="a-t2 whitespace-pre-wrap text-[13px]">{p.admin_notes}</p></Card>}

        {alerts.length > 0 && <section className="flex flex-col gap-2"><h3 className="a-t1 text-[14px] font-semibold">{t('adm.signups.alertsTitle')}</h3><Timeline items={alerts} /></section>}

        <section className="flex flex-col gap-2">
          <h3 className="a-t1 text-[14px] font-semibold">{fmtPlural(p.journeys.length, lang, t('adm.signups.journeysOne'), t('adm.signups.journeysMany'))}</h3>
          <Timeline items={journeys} />
        </section>
      </div>
    </Drawer>
  );
}
