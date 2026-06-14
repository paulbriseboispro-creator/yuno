import { Bold, Italic, Underline, Link, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/contexts/LanguageContext';

interface BlockToolbarProps {
  onBold?: () => void;
  onItalic?: () => void;
  onUnderline?: () => void;
  onLink?: () => void;
  onInsertVariable?: (variable: string) => void;
  showVariables?: boolean;
}

const VARIABLES = [
  { key: '{{first_name}}', label: 'First Name' },
  { key: '{{venue_name}}', label: 'Club Name' },
  { key: '{{total_points}}', label: 'Points' },
  { key: '{{tier}}', label: 'Tier' },
];

export function BlockToolbar({
  onBold,
  onItalic,
  onUnderline,
  onLink,
  onInsertVariable,
  showVariables = true,
}: BlockToolbarProps) {
  const { t } = useLanguage();

  return (
    <div className="absolute -top-10 left-0 right-0 flex items-center justify-center z-20">
      <div className="flex items-center gap-0.5 bg-popover border border-border rounded-lg shadow-lg p-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onBold}
          title={t('owner.crm.bold')}
        >
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onItalic}
          title={t('owner.crm.italic')}
        >
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onUnderline}
          title={t('owner.crm.underline')}
        >
          <Underline className="h-3.5 w-3.5" />
        </Button>
        
        <div className="w-px h-5 bg-border mx-1" />
        
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onLink}
          title={t('owner.crm.insertLink')}
        >
          <Link className="h-3.5 w-3.5" />
        </Button>
        
        {showVariables && onInsertVariable && (
          <>
            <div className="w-px h-5 bg-border mx-1" />
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                  {`{{...}}`}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="bg-popover">
                {VARIABLES.map(({ key, label }) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => onInsertVariable(key)}
                    className="text-xs"
                  >
                    <code className="mr-2 text-primary">{key}</code>
                    <span className="text-muted-foreground">{label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </div>
  );
}
