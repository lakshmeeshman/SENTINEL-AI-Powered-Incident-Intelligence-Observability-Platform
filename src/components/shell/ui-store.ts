"use client";

import { create } from "zustand";

interface UIState {
  palette: boolean;
  shortcuts: boolean;
  createIncident: boolean;
  mobileNav: boolean;
  onboarding: boolean;
  set: (patch: Partial<Omit<UIState, "set">>) => void;
}

export const useUI = create<UIState>((set) => ({
  palette: false,
  shortcuts: false,
  createIncident: false,
  mobileNav: false,
  onboarding: false,
  set: (patch) => set(patch),
}));
