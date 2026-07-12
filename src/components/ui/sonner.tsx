import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/* Sonner aligné sur ui/toast.tsx : pill sombre compact flouté, ancré sous la
   safe-area (jamais dans l'heure), non bloquant.

   ⚠️ CENTRAGE — le CSS mobile de Sonner (@media max-width:600px) pose
   `left: <offset>; right: <offset>; width: 100%` sur le conteneur : il démarre
   donc à 16px ET fait 100vw de large → il déborde de 16px à droite et le toast
   paraît collé au bord droit. On neutralise ça par le `style` inline, que Sonner
   étale EN DERNIER sur le conteneur : un style inline bat une règle de media
   query sans avoir à batailler avec des !important Tailwind.
   Le toast lui-même prend 100% du conteneur (pas de marge/largeur calculée). */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      duration={2800}
      gap={8}
      style={{
        left: "50%",
        right: "auto",
        transform: "translateX(-50%)",
        width: "min(420px, calc(100vw - 24px))",
        top: "calc(env(safe-area-inset-top, 0px) + 10px)",
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:w-full group-[.toaster]:bg-[#161619]/95 group-[.toaster]:backdrop-blur-xl group-[.toaster]:text-white group-[.toaster]:border-white/10 group-[.toaster]:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.85)] group-[.toaster]:py-3 group-[.toaster]:px-4 group-[.toaster]:text-[13px] group-[.toaster]:font-medium group-[.toaster]:rounded-2xl",
          title: "group-[.toast]:text-[13px] group-[.toast]:font-semibold group-[.toast]:leading-tight",
          description: "group-[.toast]:text-white/60 group-[.toast]:text-xs group-[.toast]:leading-snug",
          actionButton:
            "group-[.toast]:bg-[#E8192C] group-[.toast]:text-white group-[.toast]:text-xs group-[.toast]:rounded-full",
          cancelButton:
            "group-[.toast]:bg-white/[0.08] group-[.toast]:text-white/70 group-[.toast]:text-xs group-[.toast]:rounded-full",
          // Rouge #E8192C = unique accent de la marque. Aucun vert/emeraude ici :
          // l'icône et le liseré d'un succès restent dans la palette Yuno.
          icon: "group-[.toast]:text-[#E8192C]",
          success: "group-[.toaster]:!border-[#E8192C]/30",
          error: "group-[.toaster]:!border-[#E8192C]/45 group-[.toaster]:!bg-[#1C0C0F]/95",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
