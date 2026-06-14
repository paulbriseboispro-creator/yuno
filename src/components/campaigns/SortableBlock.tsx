import { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Copy, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Props {
  id: string;
  type: string;
  isFirst: boolean;
  isLast: boolean;
  onDuplicate: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  children: ReactNode;
}

export default function SortableBlock({ id, type, isFirst, isLast, onDuplicate, onRemove, onMoveUp, onMoveDown, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border rounded-lg p-3 space-y-2 bg-muted/20 ${isDragging ? 'shadow-lg ring-2 ring-primary/50' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 -ml-1"
            {...attributes}
            {...listeners}
            aria-label="Réorganiser"
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <Badge variant="outline" className="capitalize text-xs">{type}</Badge>
        </div>
        <div className="flex gap-0.5">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={isFirst} onClick={onMoveUp} title="Monter">
            <ChevronUp className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={isLast} onClick={onMoveDown} title="Descendre">
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onDuplicate} title="Dupliquer">
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={onRemove} title="Supprimer">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}
