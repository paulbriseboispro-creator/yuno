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
export { Field, Switch, SwitchRow, Checkbox, Segmented, NumberInput, Select, FilterSelect, Fold } from './Form';
export { KeyValue, Timeline, type KeyValueItem, type TimelineItem } from './Details';
export { useAdminT, fill } from './i18n';
export { useAdminPortal } from './portal';
export { useAdminFilters, type AdminFilters } from '../context/useAdminFilters';
export { ADMIN_PERIODS, periodRange, relativeDelta, type AdminPeriod, type PeriodRange } from '../context/period';
// v3 : dessins sur mesure, héros, bandes de stats, mises en page de traitement.
export { HoverSync, useHoverIndex, useWidth, niceTicks, tintOf, intensity } from './viz/core';
export { HeroChart, type HeroPoint } from './viz/HeroChart';
export { HoverTip, type TipRow } from './viz/Tip';
export { Hero, Block } from './viz/Hero';
export { Spark, StatStrip, SmallMultiples, cellTint, type Stat, type Multiple } from './viz/Multiples';
export {
  StackedShare, Waterfall, RankBars, BulletBar, UptimeBars, FunnelSteps, CohortGrid, CalendarHeat,
  type Part, type Step, type Rank, type Uptime, type FunnelStepV2,
} from './viz/Shapes';
export { SplitView, DrillDrawer } from './viz/Split';
