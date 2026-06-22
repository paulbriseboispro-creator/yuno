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
import {
	LayoutGridIcon,
	BarChart3Icon,
	CalendarIcon,
	TicketIcon,
	UsersIcon,
	ScanLineIcon,
	Music2Icon,
	WandIcon,
	MailIcon,
	MegaphoneIcon,
	Building2Icon,
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
} from "lucide-react";

type TT = (fr: string, en: string) => string;

function buildOrgNavGroups(tt: TT): SidebarNavGroup[] {
	return [
		{
			label: tt("Aperçu", "Overview"),
			items: [
				{ title: tt("Dashboard", "Dashboard"), path: "/organizer-app", icon: <LayoutGridIcon /> },
				{ title: tt("Analytique", "Analytics"), path: "/organizer-app/analytics", icon: <BarChart3Icon /> },
			],
		},
		{
			label: tt("Événements", "Events"),
			items: [
				{ title: tt("Événements", "Events"), path: "/organizer-app/events", icon: <CalendarIcon /> },
				{ title: tt("Billetterie", "Ticketing"), path: "/organizer-app/ticketing", icon: <TicketIcon /> },
				{ title: tt("Guest List", "Guest List"), path: "/organizer-app/guest-list", icon: <UsersIcon /> },
				{ title: tt("Check-in", "Check-in"), path: "/organizer-app/checkin", icon: <ScanLineIcon /> },
				{ title: tt("DJs", "DJs"), path: "/organizer-app/djs", icon: <Music2Icon /> },
				{ title: tt("Réserver un DJ", "Book a DJ"), path: "/organizer-app/book-dj", icon: <WandIcon /> },
			],
		},
		{
			label: tt("Marketing & CRM", "Marketing & CRM"),
			items: [
				{ title: tt("Clients", "Customers"), path: "/organizer-app/customers", icon: <UsersIcon /> },
				{ title: tt("Campagnes Email", "Email Campaigns"), path: "/organizer-app/campaigns", icon: <MailIcon /> },
				{ title: tt("Promoteurs", "Promoters"), path: "/organizer-app/promoters", icon: <MegaphoneIcon /> },
			],
		},
		{
			label: tt("Écosystème", "Ecosystem"),
			items: [
				{ title: tt("Clubs partenaires", "Partner clubs"), path: "/organizer-app/partners", icon: <Building2Icon /> },
				{ title: tt("Équipe", "Team"), path: "/organizer-app/team", icon: <ShieldIcon /> },
				{ title: tt("Profil public", "Public profile"), path: "/organizer-app/profile", icon: <UserCircleIcon /> },
			],
		},
		{
			label: tt("Finances", "Finance"),
			items: [
				{ title: tt("Paiements", "Payments"), path: "/organizer-app/payments", icon: <CreditCardIcon /> },
				{ title: tt("Factures", "Invoices"), path: "/organizer-app/invoices", icon: <FileTextIcon /> },
				{ title: tt("Compta", "Accounting"), path: "/organizer-app/accounting", icon: <CalculatorIcon /> },
				{ title: tt("Remboursements", "Refunds"), path: "/organizer-app/refunds", icon: <RotateCcwIcon /> },
			],
		},
		{
			label: tt("Réglages", "Settings"),
			items: [
				{ title: tt("Mon organisation", "My organization"), path: "/organizer-app/organization", icon: <SettingsIcon /> },
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
	const { language } = useLanguage();
	const tt: TT = (fr, en) => translate(language, fr, en);
	const navGroups = buildOrgNavGroups(tt);
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
