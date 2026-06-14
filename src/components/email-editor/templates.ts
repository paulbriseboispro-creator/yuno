// Shared block-type metadata and starter templates for the unified email editor.
import {
  Heading, Type, Image as ImageIcon, MousePointerClick, CalendarDays, Minus, MoveVertical,
} from 'lucide-react';
import { newBlock, type EmailBlock } from '@/lib/emailCampaign';

export type EmailType = 'informational' | 'promotional';
type TFn = (key: string) => string;

export const BLOCK_TYPES: { type: EmailBlock['type']; labelKey: string; Icon: any }[] = [
  { type: 'header', labelKey: 'em.block.header', Icon: Heading },
  { type: 'text', labelKey: 'em.block.text', Icon: Type },
  { type: 'image', labelKey: 'em.block.image', Icon: ImageIcon },
  { type: 'cta', labelKey: 'em.block.cta', Icon: MousePointerClick },
  { type: 'event', labelKey: 'em.block.event', Icon: CalendarDays },
  { type: 'divider', labelKey: 'em.block.divider', Icon: Minus },
  { type: 'spacer', labelKey: 'em.block.spacer', Icon: MoveVertical },
];

export type TemplatePreset = {
  id: string;
  name: string;
  subject: string;
  type: EmailType;
  blocks: (ctx: { name: string; logoUrl?: string | null }) => EmailBlock[];
};

export function getTemplatePresets(t: TFn): TemplatePreset[] {
  return [
    {
      id: 'info_reminder',
      name: t('em.tpl.info_reminder.name'),
      subject: t('em.tpl.info_reminder.subject'),
      type: 'informational',
      blocks: (c) => [
        newBlock('header', { venue_name: c.name, logo_url: c.logoUrl }),
        newBlock('text', { html: t('em.tpl.info_reminder.body') }),
        newBlock('cta', { label: t('em.tpl.cta.ticket'), url: 'https://yunoapp.eu/my-orders' }),
      ],
    },
    {
      id: 'info_change',
      name: t('em.tpl.info_change.name'),
      subject: t('em.tpl.info_change.subject'),
      type: 'informational',
      blocks: (c) => [
        newBlock('header', { venue_name: c.name, logo_url: c.logoUrl }),
        newBlock('text', { html: t('em.tpl.info_change.body') }),
      ],
    },
    {
      id: 'marketing_event',
      name: t('em.tpl.marketing_event.name'),
      subject: t('em.tpl.marketing_event.subject'),
      type: 'promotional',
      blocks: (c) => [
        newBlock('header', { venue_name: c.name, logo_url: c.logoUrl }),
        newBlock('text', { html: t('em.tpl.marketing_event.body') }),
        newBlock('cta', { label: t('em.tpl.cta.event'), url: 'https://yunoapp.eu' }),
      ],
    },
    {
      id: 'marketing_offer',
      name: t('em.tpl.marketing_offer.name'),
      subject: t('em.tpl.marketing_offer.subject'),
      type: 'promotional',
      blocks: (c) => [
        newBlock('header', { venue_name: c.name, logo_url: c.logoUrl }),
        newBlock('text', { html: t('em.tpl.marketing_offer.body') }),
        newBlock('cta', { label: t('em.tpl.cta.profit'), url: 'https://yunoapp.eu' }),
      ],
    },
    {
      id: 'newsletter',
      name: t('em.tpl.newsletter.name'),
      subject: t('em.tpl.newsletter.subject'),
      type: 'promotional',
      blocks: (c) => [
        newBlock('header', { venue_name: c.name, logo_url: c.logoUrl }),
        newBlock('text', { html: t('em.tpl.newsletter.body') }),
      ],
    },
  ];
}
