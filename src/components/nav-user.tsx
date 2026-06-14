"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UserIcon,
  CreditCardIcon,
  LogOutIcon,
  StoreIcon,
  BellIcon,
  LifeBuoyIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

const ITEM_CLS =
  "px-3 py-2.5 rounded-xl gap-3 cursor-pointer [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

export function NavUser() {
  const { user } = useAuth();

  const fullName: string =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Owner";

  const email = user?.email || "";

  const avatarUrl: string | undefined =
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    undefined;

  // First + last initial (or single if one word)
  const initials = fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex cursor-pointer items-center rounded-full ring-2 ring-transparent transition-all hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label="Menu profil"
        >
          <Avatar className="size-8">
            <AvatarImage src={avatarUrl} alt={fullName} />
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-64 rounded-2xl p-2 shadow-2xl border border-border/60"
      >
        {/* ── User header ── */}
        <DropdownMenuLabel className="flex items-center gap-3 px-3 py-3 rounded-xl">
          <Avatar className="size-12 shrink-0">
            <AvatarImage src={avatarUrl} alt={fullName} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight text-foreground">
              {fullName}
            </p>
            <p className="truncate text-xs leading-relaxed text-muted-foreground">
              {email}
            </p>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="mx-1 my-1" />

        {/* ── Personal ── */}
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className={ITEM_CLS}>
            <Link to="/profile">
              <UserIcon />
              Profil
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={ITEM_CLS}>
            <Link to="/owner/notifications">
              <BellIcon />
              Notifications
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={ITEM_CLS}>
            <Link to="/owner/venue">
              <StoreIcon />
              Mon établissement
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="mx-1 my-1" />

        {/* ── Support ── */}
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className={ITEM_CLS}>
            <Link to="/owner/help">
              <LifeBuoyIcon />
              Centre d&apos;aide
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="mx-1 my-1" />

        {/* ── Billing ── */}
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className={ITEM_CLS}>
            <Link to="/owner/billing">
              <CreditCardIcon />
              Abonnement
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="mx-1 my-1" />

        {/* ── Sign out ── */}
        <DropdownMenuItem
          className={`${ITEM_CLS} text-primary [&_svg]:text-primary focus:bg-primary/10 focus:text-primary`}
          onClick={handleSignOut}
        >
          <LogOutIcon />
          Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
