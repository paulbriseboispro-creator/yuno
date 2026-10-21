import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { recoverFromStaleBuild404 } from "@/lib/swRecovery";

const NotFound = () => {
  const location = useLocation();
  const { t } = useLanguage();
  // Un ancien build servi par le service worker ne connaît pas les routes
  // récentes : on vérifie avant de dire « introuvable » (swRecovery).
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    recoverFromStaleBuild404().then((reloading) => {
      if (!alive || reloading) return;
      setChecking(false);
      console.error("404 Error: User attempted to access non-existent route:", location.pathname);
    });
    return () => { alive = false; };
  }, [location.pathname]);

  if (checking) return <div className="min-h-screen bg-background" />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">{t('common.pageNotFound')}</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          {t('common.returnHome')}
        </a>
      </div>
    </div>
  );
};

export default NotFound;
