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
import { buildFooterNavLinks, buildNavGroups } from "@/components/app-shared";
import { useLanguage } from "@/contexts/LanguageContext";

export function AppSidebar() {
	const { t } = useLanguage();
	const navGroups = buildNavGroups(t);
	const footerNavLinks = buildFooterNavLinks(t);

	return (
		<Sidebar collapsible="icon" variant="floating">
			<SidebarHeader className="h-14 justify-center">
				<SidebarMenuButton asChild>
					<Link to="/owner/dashboard">
						<img src="/yuno-icon-192.png" alt="Yuno" className="size-8 rounded-lg shrink-0" />
					</Link>
				</SidebarMenuButton>
			</SidebarHeader>
			<SidebarContent>
				{navGroups.map((group, index) => (
					<NavGroup key={`sidebar-group-${index}`} {...group} />
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
