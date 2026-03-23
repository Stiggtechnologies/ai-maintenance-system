import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  sidebarExpanded: boolean;
  executiveMode: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleExecutiveMode: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarExpanded: true,
  executiveMode: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleExecutiveMode: () => set((state) => ({ executiveMode: !state.executiveMode })),
}));
