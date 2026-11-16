/**
 * Kit de l'admin. Les pages importent d'ici, jamais de src/components/admin/ui
 * (l'ancien kit, gardé pour les écrans pas encore réécrits).
 */
export { Page, Section, Card, Grid } from './Page';
export { PeriodPicker } from './PeriodPicker';
export { Kpi, KpiRow, Sparkline, DeltaBadge } from './Kpi';
export { DataTable, type ColumnDef, type DataTableProps } from './DataTable';
export { Chart, type ChartProps, type ChartSeries, type ChartUnit } from './Chart';
export { Funnel, type FunnelStep } from './Funnel';
export { Badge, Status } from './Badge';
export { toneColor, type Tone } from './tone';
export { Tabs, type TabItem } from './Tabs';
export { useTab } from './useTab';
export { Dialog, ReasonDialog, Drawer, MIN_REASON_LENGTH } from './Overlay';
export { EmptyState, ErrorState } from './EmptyState';
export { KeyValue, Timeline, type KeyValueItem, type TimelineItem } from './Details';
export { useAdminT, fill } from './i18n';
export { useAdminPortal } from './portal';
export { useAdminFilters, type AdminFilters } from '../context/useAdminFilters';
export { ADMIN_PERIODS, periodRange, relativeDelta, type AdminPeriod, type PeriodRange } from '../context/period';
