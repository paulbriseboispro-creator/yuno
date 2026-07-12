import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/* Sonner aligné sur le même langage que ui/toast.tsx : pill sombre compact
   flouté, ancré sous la safe-area (jamais dans l'heure), non bloquant. */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group !top-[calc(env(safe-area-inset-top,0px)+10px)]"
      position="top-center"
      offset={12}
      duration={2800}
      gap={8}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[#161619]/95 group-[.toaster]:backdrop-blur-xl group-[.toaster]:text-white group-[.toaster]:border-white/10 group-[.toaster]:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.85)] group-[.toaster]:py-3 group-[.toaster]:px-4 group-[.toaster]:text-[13px] group-[.toaster]:font-medium group-[.toaster]:rounded-2xl group-[.toaster]:mx-4 group-[.toaster]:w-[calc(100%-32px)]",
          title: "group-[.toast]:text-[13px] group-[.toast]:font-semibold group-[.toast]:leading-tight",
          description: "group-[.toast]:text-white/60 group-[.toast]:text-xs group-[.toast]:leading-snug",
          actionButton:
            "group-[.toast]:bg-[#E8192C] group-[.toast]:text-white group-[.toast]:text-xs group-[.toast]:rounded-full",
          cancelButton:
            "group-[.toast]:bg-white/[0.08] group-[.toast]:text-white/70 group-[.toast]:text-xs group-[.toast]:rounded-full",
          error: "group-[.toaster]:!border-[#E8192C]/45 group-[.toaster]:!bg-[#1C0C0F]/95",
          success: "group-[.toaster]:!border-emerald-400/30",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
