import type { ReactNode } from "react";
import {
	LayoutGridIcon,
	BarChart3Icon,
	CalendarIcon,
	TicketIcon,
	UsersIcon,
	ShoppingCartIcon,
	FileTextIcon,
	RotateCcwIcon,
	UserCheckIcon,
	MegaphoneIcon,
	HeartIcon,
	MailIcon,
	MessageSquareIcon,
	TrendingUpIcon,
	RadioIcon,
	SparklesIcon,
	Music2Icon,
	HandshakeIcon,
	Wine,
	Martini,
	StoreIcon,
	CreditCardIcon,
	CrownIcon,
	GiftIcon,
	WandIcon,
	HelpCircleIcon,
	ActivityIcon,
	CalculatorIcon,
} from "lucide-react";

export type SidebarNavItem = {
	title: string;
	path?: string;
	icon?: ReactNode;
	isActive?: boolean;
	subItems?: SidebarNavItem[];
};

export type SidebarNavGroup = {
	label: string;
	items: SidebarNavItem[];
};

export function buildNavGroups(t: (key: string) => string): SidebarNavGroup[] {
	return [
		{
			label: t('sidebar.group.overview'),
			items: [
				{
					title: t('sidebar.dashboard'),
					path: "/owner/dashboard",
					icon: <LayoutGridIcon />,
				},
				{
					title: t('sidebar.analytics'),
					path: "/owner/analytics",
					icon: <BarChart3Icon />,
				},
				{
					title: t('sidebar.liveNight'),
					path: "/owner/live",
					icon: <RadioIcon />,
				},
				{
					title: t('sidebar.hypeScore'),
					path: "/owner/hype",
					icon: <TrendingUpIcon />,
				},
			],
		},
		{
			label: t('sidebar.group.events'),
			items: [
				{
					title: t('sidebar.evenings'),
					path: "/owner/events",
					icon: <CalendarIcon />,
				},
				{
					title: t('sidebar.ticketing'),
					path: "/owner/ticketing",
					icon: <TicketIcon />,
				},
				{
					title: t('sidebar.guestList'),
					path: "/owner/guest-list",
					icon: <UsersIcon />,
				},
				{
					title: t('sidebar.vipTables'),
					path: "/owner/tables",
					icon: <Wine />,
				},
				{
					title: t('sidebar.djs'),
					path: "/owner/djs",
					icon: <Music2Icon />,
				},
				{
					title: t('sidebar.bookDJ'),
					path: "/owner/book-dj",
					icon: <WandIcon />,
				},
				{
					title: t('sidebar.collaborations'),
					path: "/owner/collaborations",
					icon: <HandshakeIcon />,
				},
				{
					title: t('sidebar.scarcityFOMO'),
					path: "/owner/scarcity",
					icon: <SparklesIcon />,
				},
			],
		},
		{
			label: t('sidebar.group.marketingCRM'),
			items: [
				{
					title: t('sidebar.customers'),
					path: "/owner/customers",
					icon: <UsersIcon />,
				},
				{
					title: t('sidebar.loyalty'),
					path: "/owner/loyalty",
					icon: <HeartIcon />,
				},
				{
					title: t('sidebar.emailCampaigns'),
					path: "/owner/campaigns",
					icon: <MailIcon />,
				},
				{
					title: t('sidebar.sms'),
					path: "/owner/sms",
					icon: <MessageSquareIcon />,
				},
				{
					title: t('sidebar.promoters'),
					path: "/owner/promoters",
					icon: <MegaphoneIcon />,
				},
				{
					title: t('sidebar.agencies'),
					path: "/owner/agencies",
					icon: <HandshakeIcon />,
				},
			],
		},
		{
			label: t('sidebar.group.operations'),
			items: [
				{
					title: t('sidebar.orders'),
					path: "/owner/orders",
					icon: <ShoppingCartIcon />,
				},
				{
					title: t('sidebar.invoices'),
					path: "/owner/invoices",
					icon: <FileTextIcon />,
				},
				{
					title: t('sidebar.accounting'),
					path: "/owner/accounting",
					icon: <CalculatorIcon />,
				},
				{
					title: t('sidebar.refunds'),
					path: "/owner/refunds",
					icon: <RotateCcwIcon />,
				},
				{
					title: t('sidebar.staff'),
					path: "/owner/staff",
					icon: <UserCheckIcon />,
				},
				{
					title: t('sidebar.drinkMenu'),
					path: "/owner/menu",
					icon: <Martini />,
				},
				{
					title: t('sidebar.vipService'),
					path: "/owner/vip-service",
					icon: <CrownIcon />,
				},
				{
					title: t('sidebar.upsells'),
					path: "/owner/upsell",
					icon: <GiftIcon />,
				},
				{
					title: t('sidebar.storyBuilder'),
					path: "/owner/story-builder",
					icon: <WandIcon />,
				},
			],
		},
		{
			label: t('sidebar.group.settings'),
			items: [
				{
					title: t('sidebar.myVenue'),
					path: "/owner/venue",
					icon: <StoreIcon />,
				},
				{
					title: t('sidebar.subscription'),
					path: "/owner/billing",
					icon: <CreditCardIcon />,
				},
			],
		},
	];
}

export function buildFooterNavLinks(t: (key: string) => string): SidebarNavItem[] {
	return [
		{
			title: t('sidebar.helpSupport'),
			path: "/owner/help",
			icon: <HelpCircleIcon />,
		},
		{
			title: t('sidebar.backToProfile'),
			path: "/profile",
			icon: <ActivityIcon />,
		},
	];
}
