import { api } from '~/trpc/react';
import type { Subtitle } from '~/store/subtitleStore';
import type { SubtitleStyle } from '~/app/_components/VideoPlayerWithKonva';

/**
 * Converts a File object to a Base64 string
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Strip the "data:video/mp4;base64," prefix from the result
      const base64 = (reader.result as string).split(',')[1]!;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Creates a download for a Blob with the specified name
 */
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  
  // Clean up by revoking the object URL
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Hook for exporting video with subtitles
 */
export const useExport = () => {
  const exportMutation = api.video.exportWithSubs.useMutation();
  
  const runExport = async (
    file: File,
    subs: Subtitle[],
    style: SubtitleStyle
  ) => {
    try {
      // 1. Convert video file to Base64
      const videoB64 = await fileToBase64(file);
      
      // 2. Start server-side rendering process
      const resultB64 = await exportMutation.mutateAsync({
        videoB64,
        subs,
        style
      });
      
      // 3. Convert Base64 result back to Blob and download
      const binaryString = atob(resultB64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const blob = new Blob([bytes], { type: 'video/mp4' });
      downloadBlob(blob, 'subtitled-video.mp4');
      
      return true;
    } catch (error) {
      console.error('Error during video export:', error);
      throw error;
    }
  };
  
  return {
    runExport,
    status: exportMutation.status,
    isLoading: exportMutation.isPending,
    error: exportMutation.error
  };
}; 