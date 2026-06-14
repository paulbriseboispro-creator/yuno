import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { legalContent, type LegalSection } from '@/data/legalContent';

export default function LegalPage() {
  const { section } = useParams<{ section: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();

  const validSections: LegalSection[] = ['mentions-legales', 'cgu', 'cgv-utilisateurs', 'cgv-clubs', 'privacy', 'cookies'];
  const sectionKey = section as LegalSection;

  if (!validSections.includes(sectionKey)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Page not found</p>
      </div>
    );
  }

  const doc = legalContent[sectionKey][language];

  // Render markdown-like content: **bold** and line breaks
  const renderContent = (text: string) => {
    return text.split('\n\n').map((block, i) => {
      // Check if it's a heading (starts with **)
      const parts = block.split(/\*\*(.*?)\*\*/g);
      return (
        <p key={i} className="mb-4 text-sm leading-relaxed text-foreground/80">
          {parts.map((part, j) =>
            j % 2 === 1 ? (
              <strong key={j} className="text-foreground font-semibold">{part}</strong>
            ) : (
              <span key={j}>{part.split('\n').map((line, k, arr) => (
                <span key={k}>
                  {line}
                  {k < arr.length - 1 && <br />}
                </span>
              ))}</span>
            )
          )}
        </p>
      );
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className="h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold flex-1 truncate">{doc.title}</h1>
        </div>
      </header>

      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        {renderContent(doc.content)}
      </div>
    </div>
  );
}
