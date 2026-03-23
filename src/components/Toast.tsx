import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle } from 'lucide-react';

interface ToastProps {
  message: string;
  show: boolean;
  onClose: () => void;
}

export function Toast({ message, show }: ToastProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed top-6 left-1/2 -translate-x-1/2 z-50"
        >
          <div className="bg-[#161C24] border border-[#3A8DFF] rounded-lg px-6 py-3 shadow-premium flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-[#3A8DFF]" />
            <span className="text-sm text-[#E6EDF3]">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
