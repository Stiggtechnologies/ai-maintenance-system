import { motion } from "framer-motion";
import { BrandWordmark } from "./BrandWordmark";

export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-industrial-black flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center"
      >
        <div className="mb-6 flex justify-center">
          <BrandWordmark />
        </div>
        <p className="text-industrial-muted text-sm">Loading…</p>
      </motion.div>
    </div>
  );
}
