import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group !top-[env(safe-area-inset-top,0px)]"
      position="top-center"
      offset={12}
      duration={3000}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[hsl(var(--surface-elevated))] group-[.toaster]:text-foreground group-[.toaster]:border-border/40 group-[.toaster]:shadow-lg group-[.toaster]:shadow-black/30 group-[.toaster]:py-3 group-[.toaster]:px-4 group-[.toaster]:text-sm group-[.toaster]:rounded-2xl group-[.toaster]:border-l-2 group-[.toaster]:border-l-primary/60 group-[.toaster]:mx-4 group-[.toaster]:w-[calc(100%-32px)]",
          description: "group-[.toast]:text-muted-foreground group-[.toast]:text-xs",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:text-xs",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:text-xs",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
