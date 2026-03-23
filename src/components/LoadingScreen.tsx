import { motion } from 'framer-motion';

export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#0B0F14] flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center"
      >
        <div className="inline-flex items-center justify-center w-16 h-16 bg-[#3A8DFF]/10 rounded-2xl mb-6">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-8 h-8 border-2 border-[#3A8DFF] border-t-transparent rounded-full"
          />
        </div>
        <p className="text-[#9BA7B4] text-sm">Loading SyncAI...</p>
      </motion.div>
    </div>
  );
}
