"use client";

import { Separator } from "@/components/ui/separator";
import { CustomSidebarTrigger } from "@/components/custom-sidebar-trigger";
import { OrgNavUser } from "@/components/org-nav-user";
import { LanguageSelector } from "@/components/LanguageSelector";

export function OrgAppHeader() {
	return (
		<header className="sticky top-0 z-40 mb-4 flex items-center justify-between gap-2 border-b border-white/[0.06] bg-background/70 px-4 py-2.5 backdrop-blur-xl">
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
				<OrgNavUser />
			</div>
		</header>
	);
}
