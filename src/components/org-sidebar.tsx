"use client";

import { Link } from "react-router-dom";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NavGroup } from "@/components/nav-group";
import { SidebarIdentity } from "@/components/sidebar-identity";
import type { SidebarNavGroup, SidebarNavItem } from "@/components/app-shared";
import { useLanguage } from "@/contexts/LanguageContext";
import { translate } from '@/i18n/orgTranslate';
import { SMS_MARKETING_LIVE } from '@/lib/smsMarketing';
import { useMetaIntegrationLive } from '@/lib/metaIntegration';
import { useActingOrganizer, type OrgCapabilities } from '@/hooks/useActingOrganizer';
import {
	LayoutGridIcon,
	BarChart3Icon,
	CalendarIcon,
	TicketIcon,
	CrownIcon,
	ShoppingCartIcon,
	UsersIcon,
	ScanLineIcon,
	Music2Icon,
	WandIcon,
	MailIcon,
	ZapIcon,
	MessageSquareIcon,
	MegaphoneIcon,
	HandshakeIcon,
	ShieldIcon,
	UserCircleIcon,
	FileTextIcon,
	RotateCcwIcon,
	CalculatorIcon,
	SettingsIcon,
	CreditCardIcon,
	HomeIcon,
	UserIcon,
	HelpCircleIcon,
	SparklesIcon,
	PlugIcon,
	RocketIcon,
	LifeBuoyIcon,
	FolderOpenIcon,
	LayersIcon,
	GlobeIcon,
	RadioIcon,
	UserCheckIcon,
	CoinsIcon,
	RepeatIcon,
	ShieldAlertIcon,
	AlertTriangleIcon,
	ShirtIcon,
	Martini,
} from "lucide-react";
import { SidebarProThemeSwitch } from "@/components/ProThemeSwitch";

type TT = (fr: string, en: string, es?: string) => string;

// `metaLive` vient de useMetaIntegrationLive() : la pastille « Bientôt » suit ce
// que le compte voit vraiment (super admin, démo, bêta), pas la constante seule.
function buildOrgNavGroups(tt: TT, t: (key: string) => string, metaLive: boolean): SidebarNavGroup[] {
	return [
		{
			// Pilotage : où on regarde avant d'agir.
			label: tt("Aperçu", "Overview"),
			items: [
				{ title: tt("Dashboard", "Dashboard"), path: "/organizer-app", icon: <LayoutGridIcon />, exact: true },
				{
					title: tt("Analytique", "Analytics"),
					path: "/organizer-app/analytics",
					icon: <BarChart3Icon />,
					subItems: [
						{ title: t('owner.an.global'), path: "/organizer-app/analytics?tab=global", icon: <GlobeIcon />, isDefault: true },
						{ title: t('owner.an.event'), path: "/organizer-app/analytics?tab=event", icon: <CalendarIcon /> },
						{ title: t('owner.an.liveTab'), path: "/organizer-app/analytics?tab=live", icon: <RadioIcon /> },
						{ title: tt("Audience", "Audience"), path: "/organizer-app/audience", icon: <UsersIcon /> },
					],
				},
			],
		},
		{
			// Les soirées et les piliers qui s'y vendent. Les sous-entrées pointent
			// sur les onglets de préparation (?tab=), pas sur des filtres.
			label: tt("Soirées", "Events", "Noches"),
			items: [
				{
					title: tt("Événements", "Events"),
					path: "/organizer-app/events",
					icon: <CalendarIcon />,
					subItems: [
						{ title: t('owner.ev.tabEvents'), path: "/organizer-app/events?tab=events", icon: <CalendarIcon />, isDefault: true },
						{ title: t('owner.ev.tabRecurring'), path: "/organizer-app/events?tab=recurring", icon: <RepeatIcon /> },
						{ title: tt("Collaborations", "Collaborations"), path: "/organizer-app/collaborations", icon: <HandshakeIcon /> },
						{ title: tt("Rareté & FOMO", "Scarcity & FOMO"), path: "/organizer-app/scarcity", icon: <SparklesIcon /> },
					],
				},
				{
					title: tt("Billetterie", "Ticketing"),
					path: "/organizer-app/ticketing",
					icon: <TicketIcon />,
					subItems: [
						{ title: t('tickets.events'), path: "/organizer-app/ticketing?tab=events", icon: <CalendarIcon />, isDefault: true },
						{ title: t('tickets.presets'), path: "/organizer-app/ticketing?tab=presets", icon: <FolderOpenIcon /> },
					],
				},
				{
					title: tt("Guest List", "Guest List"),
					path: "/organizer-app/guest-list",
					icon: <UsersIcon />,
					subItems: [
						{ title: t('guestList.tabs.events'), path: "/organizer-app/guest-list?tab=events", icon: <CalendarIcon />, isDefault: true },
						{ title: t('guestList.tabs.templates'), path: "/organizer-app/guest-list?tab=templates", icon: <FolderOpenIcon /> },
					],
				},
				{
					title: tt("Tables VIP", "VIP Tables"),
					path: "/organizer-app/tables",
					icon: <CrownIcon />,
					subItems: [
						{ title: t('tables.events'), path: "/organizer-app/tables?tab=events", icon: <CalendarIcon />, isDefault: true },
						{ title: tt("Salles VIP", "VIP rooms", "Salas VIP"), path: "/organizer-app/tables?tab=rooms", icon: <LayersIcon /> },
						{ title: tt("Service VIP", "VIP Service"), path: "/organizer-app/vip-service", icon: <CrownIcon /> },
					],
				},
				{
					title: tt("Check-in", "Check-in"),
					path: "/organizer-app/checkin",
					icon: <ScanLineIcon />,
					subItems: [
						{ title: tt("Billets", "Tickets"), path: "/organizer-app/checkin?tab=tickets", icon: <TicketIcon />, isDefault: true },
						{ title: tt("Boissons", "Drinks"), path: "/organizer-app/checkin?tab=drinks", icon: <Martini /> },
						{ title: tt("Vestiaire", "Cloakroom"), path: "/organizer-app/checkin?tab=cloakroom", icon: <ShirtIcon /> },
					],
				},
				{
					title: tt("DJs", "DJs"),
					path: "/organizer-app/djs",
					icon: <Music2Icon />,
					subItems: [
						{ title: t('owner.calendar'), path: "/organizer-app/djs?tab=calendar", icon: <CalendarIcon />, isDefault: true },
						{ title: t('owner.djList'), path: "/organizer-app/djs?tab=djs", icon: <Music2Icon /> },
						{ title: tt("Booking DJ", "Booking DJ"), path: "/organizer-app/book-dj", icon: <WandIcon /> },
					],
				},
			],
		},
		{
			// L'argent qui rentre : ce qui a été vendu, puis ce qui en découle.
			label: tt("Ventes & finances", "Sales & finance", "Ventas y finanzas"),
			items: [
				{
					title: tt("Commandes", "Orders"),
					path: "/organizer-app/orders",
					icon: <ShoppingCartIcon />,
					subItems: [
						{ title: t('sidebar.tickets'), path: "/organizer-app/orders?tab=tickets", icon: <TicketIcon />, isDefault: true },
						{ title: t('owner.tablesVIP'), path: "/organizer-app/orders?tab=vip", icon: <CrownIcon /> },
						{ title: t('owner.gl.tab'), path: "/organizer-app/orders?tab=guestlist", icon: <UsersIcon /> },
						{ title: tt("Remboursements", "Refunds"), path: "/organizer-app/refunds", icon: <RotateCcwIcon /> },
					],
				},
				{
					title: tt("Facturation", "Invoicing", "Facturación"),
					path: "/organizer-app/invoices",
					icon: <FileTextIcon />,
					subItems: [
						{ title: tt("Factures", "Invoices"), path: "/organizer-app/invoices", icon: <FileTextIcon /> },
						{ title: tt("Compta", "Accounting"), path: "/organizer-app/accounting", icon: <CalculatorIcon /> },
					],
				},
				{ title: tt("Paiements", "Payments"), path: "/organizer-app/payments", icon: <CreditCardIcon /> },
			],
		},
		{
			// Les gens, puis chaque canal pour leur parler.
			label: tt("Marketing & CRM", "Marketing & CRM"),
			items: [
				{
					title: tt("Clients", "Customers"),
					path: "/organizer-app/customers",
					icon: <UsersIcon />,
					subItems: [
						{ title: t('sidebar.customersAll'), path: "/organizer-app/customers?tab=all", icon: <UsersIcon />, isDefault: true },
						{ title: t('sidebar.customersTop'), path: "/organizer-app/customers?tab=top", icon: <CrownIcon /> },
						{ title: t('minorClients.filter'), path: "/organizer-app/customers?tab=minors", icon: <ShieldAlertIcon /> },
						{ title: t('sidebar.customersWarned'), path: "/organizer-app/customers?tab=warned", icon: <AlertTriangleIcon /> },
						{ title: t('customers.originsTab'), path: "/organizer-app/customers?tab=origins", icon: <GlobeIcon /> },
					],
				},
				{
					title: t('sidebar.emailMarketing'),
					path: "/organizer-app/campaigns",
					icon: <MailIcon />,
					subItems: [
						{ title: t('sidebar.emailCampaigns'), path: "/organizer-app/campaigns", icon: <MailIcon /> },
						{ title: t('sidebar.emailAutomations'), path: "/organizer-app/campaigns/automations", icon: <ZapIcon /> },
						{ title: t('sidebar.contactBase'), path: "/organizer-app/campaigns/contacts", icon: <UsersIcon /> },
					],
				},
				{ title: t('sidebar.smsMarketing'), path: "/organizer-app/sms", icon: <MessageSquareIcon />, badge: SMS_MARKETING_LIVE ? undefined : tt("Bientôt", "Soon") },
				{ title: t('sidebar.ads'), path: "/organizer-app/ads", icon: <RocketIcon />, badge: metaLive ? undefined : t('integ.buildingBadge') },
				{
					// Les quatre pages du programme promoteur n'étaient atteignables
					// que par des cartes au milieu de la page d'accueil du programme.
					title: tt("Promoteurs", "Promoters"),
					path: "/organizer-app/promoters",
					icon: <MegaphoneIcon />,
					subItems: [
						{ title: t('sidebar.promoterTemplates'), path: "/organizer-app/promoters/templates", icon: <FileTextIcon /> },
						{ title: t('sidebar.promoterTeams'), path: "/organizer-app/promoters/teams", icon: <UsersIcon /> },
						{ title: t('owner.announcements'), path: "/organizer-app/promoters/announcements", icon: <MegaphoneIcon /> },
						{ title: t('sidebar.promoterFinance'), path: "/organizer-app/promoters/finance", icon: <CoinsIcon /> },
						{ title: tt("Agences", "Agencies"), path: "/organizer-app/agencies", icon: <HandshakeIcon /> },
					],
				},
			],
		},
		{
			label: tt("Réglages", "Settings"),
			items: [
				{ title: tt("Mon organisation", "My organization"), path: "/organizer-app/organization", icon: <SettingsIcon /> },
				{
					title: tt("Équipe", "Team"),
					path: "/organizer-app/team",
					icon: <ShieldIcon />,
					subItems: [
						{ title: tt("Équipe", "Team"), path: "/organizer-app/team?tab=team", icon: <ShieldIcon />, isDefault: true },
						{ title: tt("Staff", "Staff"), path: "/organizer-app/team?tab=staff", icon: <UserCheckIcon /> },
					],
				},
				{ title: tt("Profil public", "Public profile"), path: "/organizer-app/profile", icon: <UserCircleIcon /> },
				{ title: t('sidebar.integrations'), path: "/organizer-app/integrations", icon: <PlugIcon />, badge: metaLive ? undefined : t('integ.buildingBadge') },
				{ title: tt("Assistance Yuno", "Yuno support", "Asistencia Yuno"), path: "/organizer-app/support-access", icon: <LifeBuoyIcon /> },
			],
		},
	];
}

/**
 * La barre d'un membre d'équipe ne montre que ce que son rôle peut vraiment
 * faire. Une entrée qu'il n'a pas le droit d'ouvrir n'est pas une entrée grisée
 * : c'est une promesse qui finit sur un refus serveur ou un écran vide. Un
 * scanner ne voit donc que le Check-in, un éditeur les soirées et leurs
 * piliers, un admin tout sauf l'identité de l'organisation (profil public,
 * réglages, équipe, paiements — ils n'appartiennent qu'au fondateur).
 *
 * La clé est le CHEMIN, pas le libellé : un groupe entièrement filtré
 * disparaît, il ne reste jamais un titre de section sans rien dessous.
 */
const PATH_CAPABILITY: { prefix: string; needs: keyof OrgCapabilities }[] = [
	{ prefix: "/organizer-app/analytics", needs: "viewInsights" },
	{ prefix: "/organizer-app/audience", needs: "viewInsights" },
	{ prefix: "/organizer-app/customers", needs: "viewInsights" },
	{ prefix: "/organizer-app/orders", needs: "viewFinance" },
	{ prefix: "/organizer-app/refunds", needs: "refund" },
	{ prefix: "/organizer-app/invoices", needs: "viewFinance" },
	{ prefix: "/organizer-app/accounting", needs: "viewFinance" },
	{ prefix: "/organizer-app/payments", needs: "manageOrganization" },
	{ prefix: "/organizer-app/campaigns", needs: "marketing" },
	{ prefix: "/organizer-app/sms", needs: "marketing" },
	{ prefix: "/organizer-app/ads", needs: "marketing" },
	{ prefix: "/organizer-app/promoters", needs: "marketing" },
	{ prefix: "/organizer-app/agencies", needs: "marketing" },
	{ prefix: "/organizer-app/organization", needs: "manageOrganization" },
	{ prefix: "/organizer-app/profile", needs: "manageOrganization" },
	{ prefix: "/organizer-app/integrations", needs: "manageOrganization" },
	{ prefix: "/organizer-app/support-access", needs: "manageOrganization" },
	// La page Équipe & Staff s'ouvre à un admin d'équipe, mais l'onglet
	// « Équipe » lui-même reste au fondateur : `org_members` n'accepte
	// d'écriture que de l'organisateur, un admin n'y peut rien. C'est le
	// chemin le plus SPÉCIFIQUE qui décide, donc cette ligne prime.
	{ prefix: "/organizer-app/team?tab=team", needs: "manageOrganization" },
	{ prefix: "/organizer-app/team", needs: "manageStaff" },
	{ prefix: "/organizer-app/events", needs: "editEvents" },
	{ prefix: "/organizer-app/collaborations", needs: "editEvents" },
	{ prefix: "/organizer-app/scarcity", needs: "editEvents" },
	{ prefix: "/organizer-app/ticketing", needs: "editEvents" },
	{ prefix: "/organizer-app/guest-list", needs: "editEvents" },
	{ prefix: "/organizer-app/tables", needs: "editEvents" },
	{ prefix: "/organizer-app/vip-service", needs: "editEvents" },
	{ prefix: "/organizer-app/djs", needs: "editEvents" },
	{ prefix: "/organizer-app/book-dj", needs: "editEvents" },
	{ prefix: "/organizer-app/checkin", needs: "scanDoor" },
];

function pathAllowed(path: string | undefined, can: OrgCapabilities): boolean {
	if (!path) return true;
	// Le chemin le plus SPÉCIFIQUE décide : /organizer-app/campaigns/contacts
	// tombe dans « campaigns », pas dans la racine de l'app.
	const rule = PATH_CAPABILITY
		.filter((r) => path === r.prefix || path.startsWith(r.prefix + "/") || path.startsWith(r.prefix + "?"))
		.sort((a, b) => b.prefix.length - a.prefix.length)[0];
	return rule ? can[rule.needs] : true;
}

function filterNavGroups(groups: SidebarNavGroup[], can: OrgCapabilities): SidebarNavGroup[] {
	return groups
		.map((group) => ({
			...group,
			items: group.items
				.filter((item) => pathAllowed(item.path, can))
				.map((item) => ({
					...item,
					subItems: item.subItems?.filter((sub) => pathAllowed(sub.path, can)),
				}))
				// Une entrée dont TOUTES les sous-entrées sont tombées reste
				// légitime (sa page existe) ; une entrée sans page ne l'est pas.
				.filter((item) => !!item.path),
		}))
		.filter((group) => group.items.length > 0);
}

function buildOrgFooterNavLinks(tt: TT): SidebarNavItem[] {
	return [
		{ title: tt("Aide & support", "Help & support"), path: "/organizer-app/help", icon: <HelpCircleIcon /> },
		{ title: tt("Retour au site", "Back to site"), path: "/", icon: <HomeIcon /> },
		{ title: tt("Mon profil", "My profile"), path: "/profile", icon: <UserIcon /> },
	];
}

export function OrgAppSidebar() {
	const { language, t } = useLanguage();
	const tt: TT = (fr, en, es) => translate(language, fr, en, es);
	const metaLive = useMetaIntegrationLive();
	const { can, organizationName, organizationLogoUrl } = useActingOrganizer();
	const navGroups = filterNavGroups(buildOrgNavGroups(tt, t, metaLive), can);
	const footerNavLinks = buildOrgFooterNavLinks(tt);

	return (
		<Sidebar collapsible="icon" variant="floating">
			<SidebarIdentity
				to="/organizer-app"
				name={organizationName}
				logoUrl={organizationLogoUrl}
				subtitle={t('sidebar.space.organizer')}
			/>
			<SidebarContent>
				{navGroups.map((group, index) => (
					<NavGroup key={`org-sidebar-group-${index}`} {...group} />
				))}
			</SidebarContent>
			<SidebarFooter>
				<SidebarProThemeSwitch />
				<SidebarMenu>
					{footerNavLinks.map((item) => (
						<SidebarMenuItem key={item.title}>
							<SidebarMenuButton asChild className="text-muted-foreground" size="sm">
								<Link to={item.path ?? "#"}>
									{item.icon}
									<span>{item.title}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}
