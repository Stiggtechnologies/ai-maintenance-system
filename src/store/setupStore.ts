import { create } from "zustand";

export interface SetupState {
  industry: string | null;
  useCase: string | null;
  templateSlug: string | null;
  templateName: string | null;
  completed: boolean;

  setIndustry: (industry: string) => void;
  setUseCase: (useCase: string) => void;
  setTemplate: (slug: string, name: string) => void;
  markCompleted: () => void;
  reset: () => void;
}

export const useSetupStore = create<SetupState>((set) => ({
  industry: null,
  useCase: null,
  templateSlug: null,
  templateName: null,
  completed: false,

  setIndustry: (industry) => set({ industry }),
  setUseCase: (useCase) => set({ useCase }),
  setTemplate: (slug, name) => set({ templateSlug: slug, templateName: name }),
  markCompleted: () => set({ completed: true }),
  reset: () =>
    set({
      industry: null,
      useCase: null,
      templateSlug: null,
      templateName: null,
      completed: false,
    }),
}));

export const INDUSTRY_TEMPLATE_MAP: Record<string, string[]> = {
  "oil-sands": ["oil-sands"],
  mining: ["mining"],
  "oil-gas": ["oil-sands", "process-industrial"],
  power: ["process-industrial"],
  utilities: ["infrastructure"],
  manufacturing: ["manufacturing"],
  pharma: ["process-industrial"],
  aviation: ["heavy-industrial"],
  marine: ["heavy-industrial"],
  "data-centers": ["infrastructure"],
  military: ["heavy-industrial"],
  aerospace: ["heavy-industrial"],
};
