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
  UserCircleIcon,
  SettingsIcon,
  LogOutIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProfileType } from "@/hooks/useProfileType";
import { useLanguage } from "@/contexts/LanguageContext";
import { translate } from '@/i18n/orgTranslate';
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

const ITEM_CLS =
  "px-3 py-2.5 rounded-xl gap-3 cursor-pointer [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

export function OrgNavUser() {
  const { user } = useAuth();
  const { profile } = useProfileType();
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const fullName: string =
    profile?.organizationName ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Yuno";

  const email = user?.email || "";

  const avatarUrl: string | undefined =
    profile?.organizationLogoUrl ||
    profile?.avatarUrl ||
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    undefined;

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
          aria-label={tt("Menu profil", "Profile menu")}
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

        <DropdownMenuGroup>
          <DropdownMenuItem asChild className={ITEM_CLS}>
            <Link to="/profile">
              <UserIcon />
              {tt("Mon profil", "My profile")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={ITEM_CLS}>
            <Link to="/organizer-app/profile">
              <UserCircleIcon />
              {tt("Profil public orga", "Public org profile")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={ITEM_CLS}>
            <Link to="/organizer-app/organization">
              <SettingsIcon />
              {tt("Mon organisation", "My organization")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="mx-1 my-1" />

        <DropdownMenuItem
          className={`${ITEM_CLS} text-primary [&_svg]:text-primary focus:bg-primary/10 focus:text-primary`}
          onClick={handleSignOut}
        >
          <LogOutIcon />
          {tt("Se déconnecter", "Sign out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
