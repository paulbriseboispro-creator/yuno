import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useNavigate } from 'react-router-dom';

export function CartButton() {
  const cart = useStore((state) => state.cart);
  const navigate = useNavigate();

  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);

  return (
    <AnimatePresence>
      {totalItems > 0 && (
        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          onClick={() => navigate('/cart')}
          className="fixed bottom-24 right-4 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-primary shadow-soft transition-all"
          style={{ WebkitTransform: 'translate3d(0,0,0)', bottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="relative">
            {/* Shopping Bag Icon */}
            <ShoppingBag 
              className="h-7 w-7 text-primary-foreground" 
              strokeWidth={2}
            />
            
            {/* Badge with item count */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              key={totalItems}
              className="absolute -right-2 -top-3 flex h-5 w-5 items-center justify-center rounded-full bg-white"
            >
              <motion.span
                initial={{ scale: 1.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-[10px] font-bold text-background"
              >
                {totalItems}
              </motion.span>
            </motion.div>
          </div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
