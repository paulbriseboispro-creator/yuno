import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	useSidebar,
} from "@/components/ui/sidebar";
import type { SidebarNavGroup, SidebarNavItem } from "@/components/app-shared";
import { ChevronRightIcon } from "lucide-react";

/**
 * Est-ce que la route courante tombe DANS cette entrée ?
 *
 * Une entrée couvre sa page et tout ce qui vit dessous (`/owner/campaigns`
 * couvre `/owner/campaigns/new`), sauf si elle est marquée `exact` — le
 * dashboard organisateur vit à `/organizer-app`, qui préfixe toute l'app.
 *
 * Une entrée qui vise un onglet (`/owner/tables?tab=packs`) exige en plus que
 * l'URL porte ce `tab` : sans ça les quatre sous-entrées d'une même page
 * s'allumeraient toutes en même temps.
 */
function matchesPath(location: { pathname: string; search: string }, item: SidebarNavItem): boolean {
	if (!item.path) return false;
	const [itemPath, itemQuery] = item.path.split("?");
	const samePath =
		location.pathname === itemPath || (!item.exact && location.pathname.startsWith(`${itemPath}/`));
	if (!samePath) return false;
	if (!itemQuery) return true;
	const current = new URLSearchParams(location.search);
	return [...new URLSearchParams(itemQuery)].every(([k, v]) => current.get(k) === v);
}

function NavBadge({ label, inset }: { label: string; inset?: boolean }) {
	// `shrink-0` : sans lui le libellé pousse la pastille, qui se fait rogner en
	// « SO… » par la règle `truncate` du dernier span du bouton.
	return (
		<span
			className={`ml-auto shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-300 ${inset ? "mr-5" : ""}`}
		>
			{label}
		</span>
	);
}

/**
 * Une entrée de menu. Un parent qui porte des sous-entrées reste une VRAIE
 * destination (on clique le libellé, on y va) ; le chevron à droite ouvre et
 * ferme la liste. La section s'ouvre toute seule quand on entre dedans, et
 * reste comme l'utilisateur l'a laissée le reste du temps.
 */
function NavItemRow({ item }: { item: SidebarNavItem }) {
	const location = useLocation();
	const { isMobile, setOpen: setSidebarOpen, state } = useSidebar();
	const subItems = item.subItems ?? [];
	const onParentPage = matchesPath(location, item);
	// Sur `/owner/analytics` sans onglet, aucune sous-entrée ne matche alors qu'on
	// REGARDE bien « Global » : c'est elle qu'il faut allumer, pas le parent.
	const activeSub =
		subItems.find((sub) => matchesPath(location, sub)) ??
		(onParentPage ? subItems.find((sub) => sub.isDefault) : undefined);
	const inSection = !!activeSub || onParentPage;
	const [open, setOpen] = useState(inSection);

	useEffect(() => {
		if (inSection) setOpen(true);
	}, [inSection]);

	// Barre repliée en icônes : les sous-entrées sont masquées par le CSS, donc
	// cliquer une section la déplie en plus de naviguer — sinon ces pages
	// deviendraient injoignables tant que la barre reste en icônes.
	const revealWhenCollapsed = () => {
		if (state === "collapsed" && !isMobile) setSidebarOpen(true);
	};

	if (!subItems.length) {
		return (
			<SidebarMenuItem>
				<SidebarMenuButton asChild isActive={matchesPath(location, item)} tooltip={item.title}>
					<Link to={item.path ?? "#"}>
						{item.icon}
						<span className="truncate">{item.title}</span>
						{item.badge && <NavBadge label={item.badge} />}
					</Link>
				</SidebarMenuButton>
			</SidebarMenuItem>
		);
	}

	return (
		<Collapsible asChild className="group/collapsible" onOpenChange={setOpen} open={open}>
			<SidebarMenuItem>
				<SidebarMenuButton
					asChild
					isActive={!activeSub && onParentPage}
					tooltip={item.title}
				>
					<Link onClick={revealWhenCollapsed} to={item.path ?? "#"}>
						{item.icon}
						<span className="truncate">{item.title}</span>
						{item.badge && <NavBadge inset label={item.badge} />}
					</Link>
				</SidebarMenuButton>
				<CollapsibleTrigger asChild>
					<SidebarMenuAction className="data-[state=open]:rotate-90">
						<ChevronRightIcon />
					</SidebarMenuAction>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<SidebarMenuSub>
						{subItems.map((subItem) => (
							<SidebarMenuSubItem key={subItem.title}>
								<SidebarMenuSubButton asChild isActive={subItem === activeSub}>
									<Link to={subItem.path ?? "#"}>
										{subItem.icon}
										<span className="truncate">{subItem.title}</span>
										{subItem.badge && <NavBadge label={subItem.badge} />}
									</Link>
								</SidebarMenuSubButton>
							</SidebarMenuSubItem>
						))}
					</SidebarMenuSub>
				</CollapsibleContent>
			</SidebarMenuItem>
		</Collapsible>
	);
}

export function NavGroup({ label, items }: SidebarNavGroup) {
	return (
		<SidebarGroup>
			{label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
			<SidebarMenu>
				{items.map((item) => (
					<NavItemRow item={item} key={item.title} />
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
