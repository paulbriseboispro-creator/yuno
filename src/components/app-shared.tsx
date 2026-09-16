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
	FolderOpenIcon,
	LayersIcon,
	PackageIcon,
	GlobeIcon,
	RepeatIcon,
	TagIcon,
	ShieldAlertIcon,
	AlertTriangleIcon,
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
	/** Sous-entrée qui correspond à la vue par DÉFAUT du parent : elle s'allume
	 *  quand l'URL n'a pas encore d'onglet (`/owner/analytics` = Global). */
	isDefault?: boolean;
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
						{ title: t('owner.an.global'), path: "/owner/analytics?tab=global", icon: <GlobeIcon />, isDefault: true },
						{ title: t('owner.an.event'), path: "/owner/analytics?tab=event", icon: <CalendarIcon /> },
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
			// Les soirées et les trois piliers qui s'y vendent. Les sous-entrées
			// pointent sur les onglets de préparation (?tab=), pas sur des filtres.
			label: t('sidebar.group.events'),
			items: [
				{
					title: t('sidebar.evenings'),
					path: "/owner/events",
					icon: <CalendarIcon />,
					subItems: [
						{ title: t('owner.ev.tabEvents'), path: "/owner/events?tab=events", icon: <CalendarIcon />, isDefault: true },
						{ title: t('owner.ev.tabRecurring'), path: "/owner/events?tab=recurring", icon: <RepeatIcon /> },
						{ title: t('sidebar.collaborations'), path: "/owner/collaborations", icon: <HandshakeIcon /> },
						{ title: t('sidebar.scarcityFOMO'), path: "/owner/scarcity", icon: <SparklesIcon /> },
					],
				},
				{
					title: t('sidebar.ticketing'),
					path: "/owner/ticketing",
					icon: <TicketIcon />,
					subItems: [
						{ title: t('tickets.events'), path: "/owner/ticketing?tab=events", icon: <CalendarIcon />, isDefault: true },
						{ title: t('tickets.presets'), path: "/owner/ticketing?tab=presets", icon: <FolderOpenIcon /> },
						{ title: t('waitlist.title'), path: "/owner/waitlist", icon: <ListChecksIcon /> },
					],
				},
				{
					title: t('sidebar.guestList'),
					path: "/owner/guest-list",
					icon: <UsersIcon />,
					subItems: [
						{ title: t('guestList.tabs.events'), path: "/owner/guest-list?tab=events", icon: <CalendarIcon />, isDefault: true },
						{ title: t('guestList.tabs.templates'), path: "/owner/guest-list?tab=templates", icon: <FolderOpenIcon /> },
					],
				},
				{
					title: t('sidebar.vipTables'),
					path: "/owner/tables",
					icon: <Wine />,
					subItems: [
						{ title: t('tables.events'), path: "/owner/tables?tab=events", icon: <CalendarIcon />, isDefault: true },
						{ title: t('tables.zones'), path: "/owner/tables?tab=zones", icon: <LayersIcon /> },
						{ title: t('tables.packs'), path: "/owner/tables?tab=packs", icon: <PackageIcon /> },
						{ title: t('tables.presets'), path: "/owner/tables?tab=presets", icon: <FolderOpenIcon /> },
						{ title: t('sidebar.vipService'), path: "/owner/vip-service", icon: <CrownIcon /> },
					],
				},
				{
					// Le bar : la carte et ce qu'on vend en plus. Deux jobs jumeaux,
					// d'où un parent qui les nomme tous les deux.
					title: t('sidebar.bar'),
					path: "/owner/menu",
					icon: <Martini />,
					subItems: [
						{ title: t('sidebar.drinkMenu'), path: "/owner/menu", icon: <Martini /> },
						{ title: t('sidebar.upsells'), path: "/owner/upsell", icon: <GiftIcon /> },
						{ title: t('upsell.tabPromos'), path: "/owner/upsell?tab=promos", icon: <TagIcon /> },
					],
				},
				{
					title: t('sidebar.djs'),
					path: "/owner/djs",
					icon: <Music2Icon />,
					subItems: [
						{ title: t('owner.calendar'), path: "/owner/djs?tab=calendar", icon: <CalendarIcon />, isDefault: true },
						{ title: t('owner.djList'), path: "/owner/djs?tab=djs", icon: <Music2Icon /> },
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
						{ title: t('owner.drinks'), path: "/owner/orders?tab=drinks", icon: <Martini />, isDefault: true },
						{ title: t('sidebar.ticketing'), path: "/owner/orders?tab=tickets", icon: <TicketIcon /> },
						{ title: t('owner.gl.tab'), path: "/owner/orders?tab=guestlist", icon: <UsersIcon /> },
						{ title: t('owner.tablesVIP'), path: "/owner/orders?tab=vip", icon: <Wine /> },
						{ title: t('sidebar.refunds'), path: "/owner/refunds", icon: <RotateCcwIcon /> },
					],
				},
				{
					title: t('sidebar.invoicing'),
					path: "/owner/invoices",
					icon: <FileTextIcon />,
					subItems: [
						{ title: t('sidebar.invoices'), path: "/owner/invoices", icon: <FileTextIcon /> },
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
						{ title: t('customers.allClients'), path: "/owner/customers?tab=all", icon: <UsersIcon />, isDefault: true },
						{ title: t('customers.topClients'), path: "/owner/customers?tab=top", icon: <CrownIcon /> },
						{ title: t('minorClients.filter'), path: "/owner/customers?tab=minors", icon: <ShieldAlertIcon /> },
						{ title: t('customers.warnedClients'), path: "/owner/customers?tab=warned", icon: <AlertTriangleIcon /> },
						{ title: t('customers.originsTab'), path: "/owner/customers?tab=origins", icon: <GlobeIcon /> },
						{ title: t('sidebar.loyalty'), path: "/owner/loyalty", icon: <HeartIcon /> },
					],
				},
				{
					title: t('sidebar.emailMarketing'),
					path: "/owner/campaigns",
					icon: <MailIcon />,
					subItems: [
						{ title: t('sidebar.emailCampaigns'), path: "/owner/campaigns", icon: <MailIcon /> },
						{ title: t('sidebar.emailAutomations'), path: "/owner/campaigns/automations", icon: <ZapIcon /> },
						{ title: t('sidebar.contactBase'), path: "/owner/campaigns/contacts", icon: <UsersIcon /> },
					],
				},
				{
					title: t('sidebar.smsMarketing'),
					path: "/owner/sms-campaigns",
					icon: <MessageSquareIcon />,
					badge: SMS_MARKETING_LIVE ? undefined : t('smsc.soonBadge'),
					subItems: [
						{ title: t('sidebar.smsCampaigns'), path: "/owner/sms-campaigns", icon: <MessageSquareIcon /> },
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
					// Les quatre pages du programme promoteur n'étaient atteignables
					// que par des cartes au milieu de la page d'accueil du programme.
					title: t('sidebar.promoters'),
					path: "/owner/promoters",
					icon: <MegaphoneIcon />,
					subItems: [
						{ title: t('sidebar.promoterTemplates'), path: "/owner/promoters/templates", icon: <FileTextIcon /> },
						{ title: t('sidebar.promoterTeams'), path: "/owner/promoters/teams", icon: <UsersIcon /> },
						{ title: t('owner.announcements'), path: "/owner/promoters/announcements", icon: <MegaphoneIcon /> },
						{ title: t('sidebar.promoterFinance'), path: "/owner/promoters/finance", icon: <CoinsIcon /> },
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
						{ title: t('ownerteam.tabTeam'), path: "/owner/staff?tab=team", icon: <UserCheckIcon />, isDefault: true },
						{ title: t('ownerteam.tabBriefing'), path: "/owner/staff?tab=briefing", icon: <MegaphoneIcon /> },
						{ title: t('ownerteam.tabActivity'), path: "/owner/staff?tab=activity", icon: <ActivityIcon /> },
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
