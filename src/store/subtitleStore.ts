import { create } from 'zustand';

// --- START: Define WordTimestamp structure ---
interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}
// --- END: Define WordTimestamp structure ---

// Define the structure of a subtitle item
export interface Subtitle {
  id: string;
  text: string;
  start: number; // Time in seconds
  end: number;   // Time in seconds
  words?: WordTimestamp[]; // Optional array of word timestamps
  // Add other properties like style, position later if needed
}

// Define the state structure for the store
interface SubtitleState {
  subtitles: Subtitle[];
  addSubtitle: (subtitle: Subtitle) => void;
  addSubtitles: (subtitles: Subtitle[]) => void;
  updateSubtitle: (id: string, subtitle: Partial<Subtitle>) => void;
  deleteSubtitle: (id: string) => void;
  clearSubtitles: () => void;
}

// Create the Zustand store
export const useSubtitleStore = create<SubtitleState>((set) => ({
  // Initial mock data - adjust start/end times based on your test video
  subtitles: [],

  // Function to add a new subtitle
  addSubtitle: (subtitle) =>
    set((state) => ({ subtitles: [...state.subtitles, subtitle] })),

  // Function to add multiple subtitles at once
  addSubtitles: (newSubtitles) =>
    set((state) => ({
      subtitles: [...state.subtitles, ...newSubtitles]
    })),

  // Function to update an existing subtitle
  updateSubtitle: (id, subtitle) =>
    set((state) => ({
      subtitles: state.subtitles.map((sub) =>
        sub.id === id ? { ...sub, ...subtitle } : sub
      )
    })),

  // Function to remove a subtitle
  deleteSubtitle: (id) =>
    set((state) => ({
      subtitles: state.subtitles.filter((sub) => sub.id !== id)
    })),
  
  // Function to clear all subtitles
  clearSubtitles: () => set({ subtitles: [] }),
})); 