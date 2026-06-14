"use client";

import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { CustomSidebarTrigger } from "@/components/custom-sidebar-trigger";
import { NavUser } from "@/components/nav-user";
import { LanguageSelector } from "@/components/LanguageSelector";

export function AppHeader() {
	return (
		<header
			className={cn(
				"mb-6 flex items-center justify-between gap-2 px-2"
			)}
		>
			<div className="flex items-center gap-3">
				<CustomSidebarTrigger />
				<Separator
					className="mr-2 h-4 data-[orientation=vertical]:self-center"
					orientation="vertical"
				/>
			</div>
			<div className="flex items-center gap-3">
				<LanguageSelector />
				<Separator
					className="h-4 data-[orientation=vertical]:self-center"
					orientation="vertical"
				/>
				<NavUser />
			</div>
		</header>
	);
}
