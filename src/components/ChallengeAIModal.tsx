import { useState } from "react";
import { X, TriangleAlert as AlertTriangle, Send, Shield, Brain, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ChallengeAIModalProps {
  open: boolean;
  onClose: () => void;
  recommendation?: {
    title: string;
    confidence: number;
    asset: string;
    action: string;
  };
}

const challengeReasons = [
  { id: "disagree_action", label: "I disagree with the recommended action" },
  { id: "wrong_priority", label: "Priority / urgency is incorrect" },
  { id: "missing_context", label: "AI is missing important context" },
  { id: "incorrect_data", label: "Underlying data appears incorrect" },
  { id: "operational_constraint", label: "Operational constraint not considered" },
  { id: "other", label: "Other reason" },
];

export function ChallengeAIModal({ open, onClose, recommendation }: ChallengeAIModalProps) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!selectedReason) return;
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setSelectedReason(null);
      setNotes("");
      onClose();
    }, 2000);
  };

  const handleClose = () => {
    setSelectedReason(null);
    setNotes("");
    setSubmitted(false);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 top-[15%] mx-auto max-w-lg bg-[#0E1520] border border-white/[0.08] rounded-2xl z-50 overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {submitted ? (
              <div className="p-8 text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-teal-500/20 flex items-center justify-center">
                  <Shield className="w-6 h-6 text-teal-400" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Challenge Recorded</h3>
                <p className="text-sm text-slate-400">
                  Your override has been logged. The AI will incorporate this feedback into future recommendations.
                </p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-amber-500/10">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Challenge AI Recommendation</h3>
                      <p className="text-[11px] text-slate-500">Your override improves future model accuracy</p>
                    </div>
                  </div>
                  <button
                    onClick={handleClose}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Recommendation Context */}
                {recommendation && (
                  <div className="mx-6 mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <div className="text-xs text-slate-500 mb-1">Challenging recommendation:</div>
                    <div className="text-sm font-semibold text-slate-200">{recommendation.title}</div>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500">
                      <span>{recommendation.asset}</span>
                      <span className="text-slate-700">|</span>
                      <span className="font-mono text-teal-400">{recommendation.confidence}% conf</span>
                    </div>
                  </div>
                )}

                {/* Reason Selection */}
                <div className="px-6 py-4">
                  <div className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">Why are you challenging this?</div>
                  <div className="space-y-2">
                    {challengeReasons.map((reason) => (
                      <button
                        key={reason.id}
                        onClick={() => setSelectedReason(reason.id)}
                        className={`w-full text-left px-4 py-2.5 rounded-xl border transition-all text-sm ${
                          selectedReason === reason.id
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                            : "bg-white/[0.02] border-white/[0.06] text-slate-400 hover:bg-white/[0.04] hover:border-white/[0.1]"
                        }`}
                      >
                        {reason.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notes */}
                <div className="px-6 pb-4">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Provide additional context for the AI to learn from (optional)..."
                    className="w-full h-20 px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-teal-500/40 transition-colors"
                  />
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-white/[0.06] flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[10px] text-slate-600">
                    <Brain className="w-3 h-3" />
                    Feedback feeds into closed-loop learning
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleClose}
                      className="px-4 py-2 text-xs text-slate-400 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={!selectedReason}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                        selectedReason
                          ? "bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30"
                          : "bg-white/[0.04] border border-white/[0.06] text-slate-600 cursor-not-allowed"
                      }`}
                    >
                      <Send className="w-3 h-3" />
                      Submit Challenge
                    </button>
                  </div>
                </div>

                {/* Learning note */}
                <div className="mx-6 mb-4 p-3 rounded-xl bg-teal-500/5 border border-teal-500/10 flex items-start gap-2">
                  <Clock className="w-3.5 h-3.5 text-teal-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Challenges are reviewed within 4 hours. The AI model retrains weekly incorporating all human overrides.
                    Your expertise directly improves system accuracy.
                  </p>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
