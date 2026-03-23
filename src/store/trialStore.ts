import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface TrialStore {
  sessionsRemaining: number;
  sessionCount: number;
  decrementSession: (amount?: number) => void;
  resetTrial: () => void;
}

export const useTrialStore = create<TrialStore>()(
  persist(
    (set) => ({
      sessionsRemaining: 10,
      sessionCount: 0,
      decrementSession: (amount = 1) =>
        set((state) => ({
          sessionsRemaining: Math.max(0, state.sessionsRemaining - amount),
          sessionCount: state.sessionCount + amount,
        })),
      resetTrial: () => set({ sessionsRemaining: 10, sessionCount: 0 }),
    }),
    {
      name: 'syncai-trial-storage',
    }
  )
);
