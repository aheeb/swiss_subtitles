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

export interface SubtitleWord {
  word: string;
  start: number;
  end: number;
}

const MAX_HISTORY_LENGTH = 50; // Limit stack size

// Define the state structure for the store
interface SubtitleState {
  subtitles: Subtitle[];
  undoStack: Subtitle[][];
  redoStack: Subtitle[][];

  // Actions
  addSubtitle: (subtitle: Subtitle) => void;
  addSubtitles: (newSubtitles: Subtitle[]) => void;
  updateSubtitle: (id: string, subtitleChanges: Partial<Omit<Subtitle, 'id'>>) => void;
  deleteSubtitle: (id: string) => void;
  clearSubtitles: () => void;

  // History actions
  undo: () => void;
  redo: () => void;

  // Internal helper for managing undo history
  _addUndoState: (prevState: Subtitle[]) => void;
  _canUndo: () => boolean;
  _canRedo: () => boolean;
}

// Helper to create a snapshot of subtitles (shallow copy of each subtitle object)
const snapshot = (subs: Subtitle[]): Subtitle[] => subs.map(sub => ({ ...sub, words: sub.words ? sub.words.map(w => ({...w})) : undefined }));

// Create the Zustand store
export const useSubtitleStore = create<SubtitleState>((set, get) => ({
  // Initial mock data - adjust start/end times based on your test video
  subtitles: [],
  undoStack: [],
  redoStack: [],

  _addUndoState: (prevStateSnapshot) => {
    set((state) => {
      const newUndoStack = [prevStateSnapshot, ...state.undoStack].slice(0, MAX_HISTORY_LENGTH);
      return { undoStack: newUndoStack, redoStack: [] }; // Clear redo stack on new action
    });
  },

  _canUndo: () => get().undoStack.length > 0,
  _canRedo: () => get().redoStack.length > 0,

  // Function to add a new subtitle
  addSubtitle: (subtitle) => {
    const prevState = get().subtitles;
    get()._addUndoState(snapshot(prevState));
    set((state) => ({ subtitles: [...state.subtitles, subtitle] }));
  },

  // Function to add multiple subtitles at once
  addSubtitles: (newSubtitles) => {
    const prevState = get().subtitles;
    if (newSubtitles.length === 0) return; // No change, no undo state
    get()._addUndoState(snapshot(prevState));
    set((state) => ({
      subtitles: [...state.subtitles, ...newSubtitles].sort((a, b) => a.start - b.start) // Keep sorted
    }));
  },

  // Function to update an existing subtitle
  updateSubtitle: (id, subtitleChanges) => {
    const prevState = get().subtitles;
    let subtitleUpdated = false;
    const nextSubtitles = prevState.map((sub) => {
      if (sub.id === id) {
        // Check if there's an actual change to avoid unnecessary undo states
        const changed = Object.keys(subtitleChanges).some(key => 
            sub[key as keyof Subtitle] !== subtitleChanges[key as keyof Partial<Omit<Subtitle, 'id'>>]
        );
        if (changed) {
            subtitleUpdated = true;
            return { ...sub, ...subtitleChanges };
        }
      }
      return sub;
    });

    if (subtitleUpdated) {
      get()._addUndoState(snapshot(prevState));
      set({ subtitles: nextSubtitles.sort((a, b) => a.start - b.start) }); // Keep sorted
    }
  },

  // Function to remove a subtitle
  deleteSubtitle: (id) => {
    const prevState = get().subtitles;
    const nextSubtitles = prevState.filter((sub) => sub.id !== id);

    if (nextSubtitles.length !== prevState.length) { // Check if a subtitle was actually deleted
      get()._addUndoState(snapshot(prevState));
      set({ subtitles: nextSubtitles }); // Already sorted as it's a filter
    }
  },
  
  // Function to clear all subtitles
  clearSubtitles: () => {
    const prevState = get().subtitles;
    if (prevState.length > 0) {
      get()._addUndoState(snapshot(prevState));
      set({ subtitles: [], undoStack: get().undoStack, redoStack: get().redoStack }); // Preserve history stacks on clear if needed, or adjust logic
    } else {
      set({ subtitles: [] }); // No change, no undo state needed
    }
  },

  undo: () => {
    const { undoStack, subtitles: presentState } = get();
    if (get()._canUndo()) {
      const [previousState, ...newUndoStack] = undoStack;
      set({
        subtitles: previousState, // Revert to previous state (already a snapshot)
        undoStack: newUndoStack,
        redoStack: [snapshot(presentState), ...get().redoStack].slice(0, MAX_HISTORY_LENGTH),
      });
    }
  },

  redo: () => {
    const { redoStack, subtitles: presentState } = get();
    if (get()._canRedo()) {
      const [nextState, ...newRedoStack] = redoStack;
      set({
        subtitles: nextState, // Revert to next state (already a snapshot)
        undoStack: [snapshot(presentState), ...get().undoStack].slice(0, MAX_HISTORY_LENGTH),
        redoStack: newRedoStack,
      });
    }
  },
})); 