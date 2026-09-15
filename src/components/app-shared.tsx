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
	ZapIcon,
	MessageSquareIcon,
	BellIcon,
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
	LifeBuoyIcon,
	PlugIcon,
	RocketIcon,
	ListChecksIcon,
	CoinsIcon,
	ShieldIcon,
} from "lucide-react";
import { SUBSCRIPTIONS_ENABLED } from "@/lib/planFeatures";
import { SMS_MARKETING_LIVE } from "@/lib/smsMarketing";
import { META_INTEGRATION_LIVE } from "@/lib/metaIntegration";

export type SidebarNavItem = {
	title: string;
	path?: string;
	icon?: ReactNode;
	/** Pastille courte à droite du libellé (« Bientôt », « Beta »…). */
	badge?: string;
	isActive?: boolean;
	/** N'est active que sur sa route exacte (une racine qui préfixe toute l'app). */
	exact?: boolean;
	subItems?: SidebarNavItem[];
};

export type SidebarNavGroup = {
	label: string;
	items: SidebarNavItem[];
};

export function buildNavGroups(t: (key: string) => string): SidebarNavGroup[] {
	return [
		{
			// Pilotage : où on regarde avant d'agir.
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
					subItems: [
						{ title: t('sidebar.audience'), path: "/owner/audience", icon: <UsersIcon /> },
						{ title: t('sidebar.hypeScore'), path: "/owner/hype", icon: <TrendingUpIcon /> },
					],
				},
				{
					title: t('sidebar.liveNight'),
					path: "/owner/live",
					icon: <RadioIcon />,
				},
			],
		},
		{
			// Les soirées et les trois piliers qui s'y vendent.
			label: t('sidebar.group.events'),
			items: [
				{
					title: t('sidebar.evenings'),
					path: "/owner/events",
					icon: <CalendarIcon />,
					subItems: [
						{ title: t('sidebar.collaborations'), path: "/owner/collaborations", icon: <HandshakeIcon /> },
						{ title: t('sidebar.scarcityFOMO'), path: "/owner/scarcity", icon: <SparklesIcon /> },
					],
				},
				{
					title: t('sidebar.ticketing'),
					path: "/owner/ticketing",
					icon: <TicketIcon />,
					subItems: [
						{ title: t('waitlist.title'), path: "/owner/waitlist", icon: <ListChecksIcon /> },
					],
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
					subItems: [
						{ title: t('sidebar.vipService'), path: "/owner/vip-service", icon: <CrownIcon /> },
					],
				},
				{
					title: t('sidebar.drinkMenu'),
					path: "/owner/menu",
					icon: <Martini />,
					subItems: [
						{ title: t('sidebar.upsells'), path: "/owner/upsell", icon: <GiftIcon /> },
					],
				},
				{
					title: t('sidebar.djs'),
					path: "/owner/djs",
					icon: <Music2Icon />,
					subItems: [
						{ title: t('sidebar.bookDJ'), path: "/owner/book-dj", icon: <WandIcon /> },
					],
				},
			],
		},
		{
			// L'argent qui rentre : ce qui a été vendu, puis ce qui en découle.
			label: t('sidebar.group.sales'),
			items: [
				{
					title: t('sidebar.orders'),
					path: "/owner/orders",
					icon: <ShoppingCartIcon />,
					subItems: [
						{ title: t('sidebar.refunds'), path: "/owner/refunds", icon: <RotateCcwIcon /> },
					],
				},
				{
					title: t('sidebar.invoices'),
					path: "/owner/invoices",
					icon: <FileTextIcon />,
					subItems: [
						{ title: t('sidebar.accounting'), path: "/owner/accounting", icon: <CalculatorIcon /> },
					],
				},
				{
					// Abonnement coupé (lancement) : la page /owner/billing ne montre
					// que Stripe Connect → l'entrée s'appelle « Paiements ».
					title: t(SUBSCRIPTIONS_ENABLED ? 'sidebar.subscription' : 'plan.payments'),
					path: "/owner/billing",
					icon: <CreditCardIcon />,
				},
			],
		},
		{
			// Les gens, puis chaque canal pour leur parler.
			label: t('sidebar.group.marketingCRM'),
			items: [
				{
					title: t('sidebar.customers'),
					path: "/owner/customers",
					icon: <UsersIcon />,
					subItems: [
						{ title: t('sidebar.loyalty'), path: "/owner/loyalty", icon: <HeartIcon /> },
					],
				},
				{
					title: t('sidebar.emailCampaigns'),
					path: "/owner/campaigns",
					icon: <MailIcon />,
					subItems: [
						{ title: t('sidebar.emailAutomations'), path: "/owner/campaigns/automations", icon: <ZapIcon /> },
					],
				},
				{
					title: t('sidebar.sms'),
					path: "/owner/sms-campaigns",
					icon: <MessageSquareIcon />,
					badge: SMS_MARKETING_LIVE ? undefined : t('smsc.soonBadge'),
					subItems: [
						{ title: t('sms.title'), path: "/owner/sms", icon: <CoinsIcon /> },
					],
				},
				{
					title: t('sidebar.push'),
					path: "/owner/push",
					icon: <BellIcon />,
				},
				{
					title: t('sidebar.ads'),
					path: "/owner/ads",
					icon: <RocketIcon />,
					badge: META_INTEGRATION_LIVE ? undefined : t('integ.buildingBadge'),
				},
				{
					title: t('sidebar.promoters'),
					path: "/owner/promoters",
					icon: <MegaphoneIcon />,
					subItems: [
						{ title: t('sidebar.agencies'), path: "/owner/agencies", icon: <HandshakeIcon /> },
					],
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
					title: t('sidebar.staff'),
					path: "/owner/staff",
					icon: <UserCheckIcon />,
					subItems: [
						{ title: t('managers.title'), path: "/owner/managers", icon: <ShieldIcon /> },
					],
				},
				{
					// Connexions externes (Meta Pixel + Conversions API…).
					title: t('sidebar.integrations'),
					path: "/owner/integrations",
					icon: <PlugIcon />,
					badge: META_INTEGRATION_LIVE ? undefined : t('integ.buildingBadge'),
				},
				{
					// Accès assisté Yuno : consentement, journal, révocation.
					title: t('sidebar.supportAccess'),
					path: "/owner/support-access",
					icon: <LifeBuoyIcon />,
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
