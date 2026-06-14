import { useRef, useState, useEffect, useCallback } from 'react';
import { BlockToolbar } from './BlockToolbar';

interface InlineTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  showToolbar?: boolean;
  showVariables?: boolean;
  isSelected?: boolean;
  className?: string;
  style?: React.CSSProperties;
  multiline?: boolean;
}

export function InlineTextEditor({
  value,
  onChange,
  placeholder = 'Click to edit...',
  showToolbar = true,
  showVariables = true,
  isSelected = false,
  className = '',
  style = {},
  multiline = false,
}: InlineTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Sync value to contentEditable
  useEffect(() => {
    if (editorRef.current && !isFocused) {
      editorRef.current.innerText = value || '';
    }
  }, [value, isFocused]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    if (editorRef.current) {
      const newValue = editorRef.current.innerText;
      if (newValue !== value) {
        onChange(newValue);
      }
    }
  }, [onChange, value]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!multiline && e.key === 'Enter') {
      e.preventDefault();
      editorRef.current?.blur();
    }
  }, [multiline]);

  const insertVariable = useCallback((variable: string) => {
    if (editorRef.current) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(variable));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        editorRef.current.innerText += variable;
      }
      onChange(editorRef.current.innerText);
    }
  }, [onChange]);

  const applyFormatting = useCallback((tag: 'b' | 'i' | 'u') => {
    document.execCommand(tag === 'b' ? 'bold' : tag === 'i' ? 'italic' : 'underline', false);
  }, []);

  return (
    <div className="relative">
      {showToolbar && isSelected && isFocused && (
        <BlockToolbar
          onBold={() => applyFormatting('b')}
          onItalic={() => applyFormatting('i')}
          onUnderline={() => applyFormatting('u')}
          onInsertVariable={showVariables ? insertVariable : undefined}
          showVariables={showVariables}
        />
      )}
      <div
        ref={editorRef}
        contentEditable={isSelected}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={`outline-none transition-all ${
          isSelected ? 'cursor-text' : 'cursor-pointer'
        } ${!value && !isFocused ? 'text-muted-foreground' : ''} ${className}`}
        style={style}
        suppressContentEditableWarning
        data-placeholder={placeholder}
      />
      {!value && !isFocused && (
        <span 
          className="absolute inset-0 pointer-events-none opacity-50"
          style={style}
        >
          {placeholder}
        </span>
      )}
    </div>
  );
}
