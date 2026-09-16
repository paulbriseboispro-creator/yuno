"use client";

import { Link } from "react-router-dom";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NavGroup } from "@/components/nav-group";
import type { SidebarNavGroup, SidebarNavItem } from "@/components/app-shared";
import { useLanguage } from "@/contexts/LanguageContext";
import { translate } from '@/i18n/orgTranslate';
import { SMS_MARKETING_LIVE } from '@/lib/smsMarketing';
import { META_INTEGRATION_LIVE } from '@/lib/metaIntegration';
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
	UserCheckIcon,
	CoinsIcon,
} from "lucide-react";

type TT = (fr: string, en: string, es?: string) => string;

function buildOrgNavGroups(tt: TT, t: (key: string) => string): SidebarNavGroup[] {
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
						{ title: tt("Collaborations", "Collaborations"), path: "/organizer-app/collaborations", icon: <HandshakeIcon /> },
						{ title: tt("Rareté & FOMO", "Scarcity & FOMO"), path: "/organizer-app/scarcity", icon: <SparklesIcon /> },
					],
				},
				{
					title: tt("Billetterie", "Ticketing"),
					path: "/organizer-app/ticketing",
					icon: <TicketIcon />,
					subItems: [
						{ title: t('tickets.presets'), path: "/organizer-app/ticketing?tab=presets", icon: <FolderOpenIcon /> },
					],
				},
				{
					title: tt("Guest List", "Guest List"),
					path: "/organizer-app/guest-list",
					icon: <UsersIcon />,
					subItems: [
						{ title: t('guestList.tabs.templates'), path: "/organizer-app/guest-list?tab=templates", icon: <FolderOpenIcon /> },
					],
				},
				{
					title: tt("Tables VIP", "VIP Tables"),
					path: "/organizer-app/tables",
					icon: <CrownIcon />,
					subItems: [
						{ title: tt("Salles VIP", "VIP rooms", "Salas VIP"), path: "/organizer-app/tables?tab=rooms", icon: <LayersIcon /> },
						{ title: tt("Service VIP", "VIP Service"), path: "/organizer-app/vip-service", icon: <CrownIcon /> },
					],
				},
				{ title: tt("Check-in", "Check-in"), path: "/organizer-app/checkin", icon: <ScanLineIcon /> },
				{
					title: tt("DJs", "DJs"),
					path: "/organizer-app/djs",
					icon: <Music2Icon />,
					subItems: [
						{ title: t('owner.calendar'), path: "/organizer-app/djs?tab=calendar", icon: <CalendarIcon /> },
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
						{ title: t('customers.originsTab'), path: "/organizer-app/customers?tab=origins", icon: <GlobeIcon /> },
					],
				},
				{
					title: t('sidebar.emailMarketing'),
					path: "/organizer-app/campaigns",
					icon: <MailIcon />,
					subItems: [
						{ title: tt("Campagnes Email", "Email Campaigns"), path: "/organizer-app/campaigns", icon: <MailIcon /> },
						{ title: tt("Automatisations email", "Email automations"), path: "/organizer-app/campaigns/automations", icon: <ZapIcon /> },
						{ title: tt("Ma base de contacts", "My contacts"), path: "/organizer-app/campaigns/contacts", icon: <UsersIcon /> },
					],
				},
				{ title: tt("Campagnes SMS", "SMS Campaigns"), path: "/organizer-app/sms", icon: <MessageSquareIcon />, badge: SMS_MARKETING_LIVE ? undefined : tt("Bientôt", "Soon") },
				{ title: tt("Publicité", "Ads"), path: "/organizer-app/ads", icon: <RocketIcon />, badge: META_INTEGRATION_LIVE ? undefined : tt("Bientôt", "Soon") },
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
						{ title: tt("Staff Opérationnel", "Operational Staff"), path: "/organizer-app/team?tab=staff", icon: <UserCheckIcon /> },
					],
				},
				{ title: tt("Profil public", "Public profile"), path: "/organizer-app/profile", icon: <UserCircleIcon /> },
				{ title: tt("Intégrations", "Integrations"), path: "/organizer-app/integrations", icon: <PlugIcon />, badge: META_INTEGRATION_LIVE ? undefined : tt("Bientôt", "Soon") },
				{ title: tt("Assistance Yuno", "Yuno support", "Asistencia Yuno"), path: "/organizer-app/support-access", icon: <LifeBuoyIcon /> },
			],
		},
	];
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
	const navGroups = buildOrgNavGroups(tt, t);
	const footerNavLinks = buildOrgFooterNavLinks(tt);

	return (
		<Sidebar collapsible="icon" variant="floating">
			<SidebarHeader className="h-14 justify-center">
				<SidebarMenuButton asChild>
					<Link to="/organizer-app">
						<img src="/yuno-icon-192.png" alt="Yuno" className="size-8 rounded-lg shrink-0" />
					</Link>
				</SidebarMenuButton>
			</SidebarHeader>
			<SidebarContent>
				{navGroups.map((group, index) => (
					<NavGroup key={`org-sidebar-group-${index}`} {...group} />
				))}
			</SidebarContent>
			<SidebarFooter>
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
