import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
	return (
		<SidebarProvider>
			<AppSidebar />
			<SidebarInset className="overflow-y-auto">
				<div className="p-4 md:p-6 min-h-full">
					<AppHeader />
					{children}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
