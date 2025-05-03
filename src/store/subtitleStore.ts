import { create } from 'zustand';

// Define the structure of a subtitle item
export interface SubtitleItem {
  id: string;
  text: string;
  start: number; // Time in seconds
  end: number;   // Time in seconds
  // Add other properties like style, position later if needed
}

// Define the state structure for the store
interface SubtitleState {
  subtitles: SubtitleItem[];
  addSubtitle: (subtitle: SubtitleItem) => void;
  updateSubtitle: (id: string, updates: Partial<SubtitleItem>) => void;
  removeSubtitle: (id: string) => void;
  setSubtitles: (subtitles: SubtitleItem[]) => void; // For loading data later
}

// Create the Zustand store
export const useSubtitleStore = create<SubtitleState>((set) => ({
  // Initial mock data - adjust start/end times based on your test video
  subtitles: [
    { id: 'sub1', text: 'Hallo Welt!', start: 1.5, end: 4.0 },
    { id: 'sub2', text: 'Dies ist ein Test.', start: 5.2, end: 8.8 },
    { id: 'sub3', text: 'Schweizerdeutsch Untertitel Editor', start: 10.0, end: 15.5 },
  ],

  // Function to add a new subtitle
  addSubtitle: (subtitle) =>
    set((state) => ({ subtitles: [...state.subtitles, subtitle] })),

  // Function to update an existing subtitle
  updateSubtitle: (id, updates) =>
    set((state) => ({
      subtitles: state.subtitles.map((sub) =>
        sub.id === id ? { ...sub, ...updates } : sub
      ),
    })),

  // Function to remove a subtitle
  removeSubtitle: (id) =>
    set((state) => ({
      subtitles: state.subtitles.filter((sub) => sub.id !== id),
    })),
  
  // Function to replace all subtitles (e.g., when loading from API)
  setSubtitles: (subtitles) => set({ subtitles }),
})); 