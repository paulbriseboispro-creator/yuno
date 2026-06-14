import { ArrowUp, ArrowDown, Trash2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmailBlockOverlayProps {
  isSelected: boolean;
  isHovered: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

export function EmailBlockOverlay({
  isSelected,
  isHovered,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDelete,
}: EmailBlockOverlayProps) {
  if (!isHovered && !isSelected) return null;

  return (
    <>
      {/* Top action bar */}
      <div className="absolute -top-1 left-0 right-0 flex items-center justify-between px-2 transform -translate-y-full opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <div className="flex items-center gap-0.5 bg-card border border-border rounded-md shadow-lg p-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            disabled={!canMoveUp}
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            disabled={!canMoveDown}
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
          <div className="w-px h-4 bg-border mx-0.5" />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
        
        <div className="flex items-center bg-card border border-border rounded-md shadow-lg p-1 cursor-grab">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Selection/hover border */}
      <div 
        className={`absolute inset-0 pointer-events-none rounded-lg transition-all ${
          isSelected 
            ? 'ring-2 ring-primary shadow-lg shadow-primary/20' 
            : 'ring-1 ring-primary/30'
        }`}
      />
    </>
  );
}
