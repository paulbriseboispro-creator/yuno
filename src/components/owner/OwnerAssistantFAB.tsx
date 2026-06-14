import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { OwnerAssistantSheet } from './OwnerAssistantSheet';

export function OwnerAssistantFAB() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => setOpen(true)}
            className="fixed z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
            style={{
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)',
              right: '1.5rem',
              boxShadow: '0 4px 20px hsl(var(--primary) / 0.4), 0 0 40px hsl(var(--primary) / 0.15)',
            }}
          >
            <Sparkles className="h-6 w-6" />
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-background animate-pulse" />
          </motion.button>
        )}
      </AnimatePresence>

      <OwnerAssistantSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
