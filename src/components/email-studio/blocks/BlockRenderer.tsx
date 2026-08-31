import type { EmailBlock, EmailTheme } from '@/lib/email';
import type { CanvasCtx } from './common';
import HeaderView from './HeaderView';
import ImageView from './ImageView';
import TextView from './TextView';
import CtaView from './CtaView';
import ColumnsView from './ColumnsView';
import EventView from './EventView';
import TicketsView from './TicketsView';
import TableView from './TableView';
import CountdownView from './CountdownView';
import SocialView from './SocialView';
import DividerView from './DividerView';
import SpacerView from './SpacerView';
import HtmlView from './HtmlView';

/** Dispatch canvas — un composant par type de bloc. */
export default function BlockRenderer({ block, theme, ctx, mobile }: {
  block: EmailBlock; theme: EmailTheme; ctx: CanvasCtx; mobile?: boolean;
}) {
  switch (block.type) {
    case 'header': return <HeaderView block={block} theme={theme} ctx={ctx} />;
    case 'image': return <ImageView block={block} theme={theme} />;
    case 'text': return <TextView block={block} theme={theme} />;
    case 'cta': return <CtaView block={block} theme={theme} />;
    case 'columns': return <ColumnsView block={block} theme={theme} mobile={mobile} />;
    case 'event': return <EventView block={block} theme={theme} ctx={ctx} />;
    case 'tickets': return <TicketsView block={block} theme={theme} ctx={ctx} />;
    case 'table': return <TableView block={block} theme={theme} ctx={ctx} />;
    case 'countdown': return <CountdownView block={block} theme={theme} ctx={ctx} />;
    case 'social': return <SocialView block={block} theme={theme} ctx={ctx} />;
    case 'divider': return <DividerView block={block} theme={theme} />;
    case 'spacer': return <SpacerView block={block} theme={theme} />;
    case 'html': return <HtmlView block={block} theme={theme} />;
  }
}
