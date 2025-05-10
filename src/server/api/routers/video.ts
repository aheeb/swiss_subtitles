import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
// Remove Vercel AI SDK transcribe import
// import { experimental_transcribe as transcribe } from 'ai'; 
// Add official OpenAI client import and toFile helper
import OpenAI, { toFile } from 'openai';
// Remove @ai-sdk/openai import as we use the official client now
// import { createOpenAI } from '@ai-sdk/openai'; 
import { getOpenAIConfig } from '~/config/env';
import { TRPCError } from '@trpc/server';
import { Buffer } from 'buffer'; // Import Buffer for conversion
import { Readable } from 'stream'; // Import Readable for stream conversion

// Add imports for video export functionality
import tmp from 'tmp-promise';
import * as fs from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
// Remove direct import of ffmpeg-static
// import ffmpegPath from 'ffmpeg-static';
import { generateAss } from '~/utils/generateAss';
import path from 'path';

// Need to import child_process properly
import { execSync } from 'child_process';

// Create a helper function to get ffmpeg path at runtime
async function getFfmpegPath(): Promise<string> {
  try {
    // Try to dynamically import and handle different module formats
    const ffmpegStatic = await import('ffmpeg-static');
    const resolvedPath: unknown = typeof ffmpegStatic === 'string' 
      ? ffmpegStatic 
      : ffmpegStatic.default;
    
    if (typeof resolvedPath === 'string') {
      // Check if the path exists and is accessible
      try {
        await fs.access(resolvedPath);
        console.log(`[ffmpeg] Found binary at dynamic import path: ${resolvedPath}`);
        return resolvedPath;
      } catch (err) {
        console.warn(`[ffmpeg] Dynamic import path not accessible: ${resolvedPath}`);
        // Fall through to alternative methods
      }
    }

    // If we get here, try alternative methods
    // Method 1: Check if ffmpeg is in the PATH
    try {
      // Use the properly imported execSync
      const pathFromWhich: string = execSync('which ffmpeg', { encoding: 'utf8' }).toString().trim();
      console.log(`[ffmpeg] Found system binary at: ${pathFromWhich}`);
      return pathFromWhich;
    } catch (err) {
      console.warn('[ffmpeg] Could not find ffmpeg in PATH');
    }

    // Method 2: Try common locations on Mac/Linux
    const commonPaths = [
      '/usr/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/opt/homebrew/bin/ffmpeg'
    ];
    
    for (const commonPath of commonPaths) {
      try {
        await fs.access(commonPath);
        console.log(`[ffmpeg] Found binary at common path: ${commonPath}`);
        return commonPath;
      } catch {
        // Continue to next path
      }
    }
    
    // Method 3: Try to resolve node_modules path directly
    const moduleRootPath = path.resolve(process.cwd(), 'node_modules', '.pnpm', 'ffmpeg-static@5.2.0');
    
    // On macOS, the binary should be in specific locations based on OS
    let binaryPath: string | undefined;
    if (process.platform === 'darwin') {
      if (process.arch === 'arm64') {
        binaryPath = path.join(moduleRootPath, 'node_modules', 'ffmpeg-static', 'bin', 'darwin', 'arm64', 'ffmpeg');
      } else {
        binaryPath = path.join(moduleRootPath, 'node_modules', 'ffmpeg-static', 'bin', 'darwin', 'x64', 'ffmpeg');
      }
    } else if (process.platform === 'linux') {
      binaryPath = path.join(moduleRootPath, 'node_modules', 'ffmpeg-static', 'bin', 'linux', 'x64', 'ffmpeg');
    } else if (process.platform === 'win32') {
      binaryPath = path.join(moduleRootPath, 'node_modules', 'ffmpeg-static', 'bin', 'win32', 'x64', 'ffmpeg.exe');
    }
    
    if (binaryPath) {
      try {
        await fs.access(binaryPath);
        console.log(`[ffmpeg] Found binary at resolved path: ${binaryPath}`);
        return binaryPath;
      } catch (err) {
        console.warn(`[ffmpeg] Resolved path not accessible: ${binaryPath}`);
      }
    }
    
    // Method 4: Try direct node_modules path without pnpm
    try {
      const directPath = path.resolve(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
      await fs.access(directPath);
      console.log(`[ffmpeg] Found binary at direct node_modules path: ${directPath}`);
      return directPath;
    } catch (err) {
      console.warn('[ffmpeg] Direct node_modules path not accessible');
    }
    
    // Method 5: For Mac users, check if ffmpeg is installed via Homebrew
    if (process.platform === 'darwin') {
      try {
        const homebrewPath = execSync('brew --prefix ffmpeg', { encoding: 'utf8' }).toString().trim();
        if (homebrewPath) {
          const brewBinaryPath = path.join(homebrewPath, 'bin', 'ffmpeg');
          await fs.access(brewBinaryPath);
          console.log(`[ffmpeg] Found binary installed via Homebrew: ${brewBinaryPath}`);
          return brewBinaryPath;
        }
      } catch (err) {
        console.warn('[ffmpeg] Could not find ffmpeg installed via Homebrew');
      }
    }

    throw new Error('Could not resolve ffmpeg path through any method');
  } catch (error) {
    console.error('[ffmpeg] Error resolving path:', error);
    throw new Error(`Failed to resolve ffmpeg path: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Remove the FFmpeg-Binary registration from top-level code
// ffmpeg.setFfmpegPath(ffmpegPath!);

// Interface for the structure we want to return (start/end in seconds)
export interface TranscriptionSegment {
  text: string;
  start: number; // start time in seconds
  end: number;   // end time in seconds
}

// Define the expected structure for individual segments in OpenAI's verbose_json response
interface OpenAISegment {
  id: number;
  seek: number;
  start: number; // in seconds
  end: number;   // in seconds
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
}

// Define the expected structure for the overall OpenAI verbose_json response
interface OpenAIVerboseJSONResponse {
  text: string;
  segments: OpenAISegment[];
  language: string;
  duration: number;
}

// Remove interface related to Vercel SDK type inference
// interface VercelSdkSegmentFromLinter { ... }

// Helper function to convert Base64 string to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64); // Node.js v16+
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Removed the parseSrtToSegments function as it's no longer needed

// Add function to get video dimensions using ffprobe
function getVideoSize(filePath: string): Promise<{width: number; height: number}> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(new Error(`Failed to probe video: ${String(err)}`));
      
      // Find the video stream
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      
      if (!videoStream?.width || !videoStream?.height) {
        return reject(new Error('No valid video stream found'));
      }
      
      resolve({
        width: videoStream.width,
        height: videoStream.height
      });
    });
  });
}

export const videoRouter = createTRPCRouter({
  transcribe: publicProcedure
    .input(z.object({
      videoBuffer: z.string() // Expect Base64 string (WAV audio)
    }))
    .mutation(async ({ input }): Promise<TranscriptionSegment[]> => {
      try {
        // Set ffmpeg path at runtime for transcribe as well
        const ffmpegPath = await getFfmpegPath();
        console.log('[ffmpeg] using binary at', ffmpegPath);
        ffmpeg.setFfmpegPath(ffmpegPath);
        
        // 1. Decode Base64 to ArrayBuffer
        const wavAudioBuffer = base64ToArrayBuffer(input.videoBuffer);
        // Convert ArrayBuffer to Buffer
        const audioBuffer = Buffer.from(wavAudioBuffer);

        // Create a Readable stream from the Buffer
        const audioStream = new Readable();
        audioStream.push(audioBuffer);
        audioStream.push(null); // Signal end of stream

        // IMPORTANT: Provide a filename with the correct extension (.wav)
        // Convert the stream to an Uploadable file object
        const uploadableAudioFile = await toFile(audioStream, 'audio.wav');


        // 2. Initialize official OpenAI client
        const { apiKey } = getOpenAIConfig();
        // Instantiate the official client
        const openai = new OpenAI({ apiKey }); 

        console.log('openai', openai);

        // 3. Invoke Whisper transcription using the official client
        // Ensure the response is typed correctly
        const response = await openai.audio.transcriptions.create({
          model: 'whisper-1',
          file: uploadableAudioFile, // Pass the Uploadable file object
          response_format: 'verbose_json', // Request detailed response with segments
          timestamp_granularities: ['segment'], // Request segment timestamps
        }) as unknown as OpenAIVerboseJSONResponse; // Assert to our expected response type

        console.log('response', response);

        // 4. Validate response (expecting an object with a segments array)
        if (!response || typeof response !== 'object' || !Array.isArray(response.segments)) {
          console.error('Invalid transcript response type from OpenAI. Expected object with segments array, got:', typeof response, response);
          throw new Error('Invalid transcript response: Expected object with segments from OpenAI API.');
        }

        // 5. Map the returned segments (timestamps are already in seconds)
        const openAIsegments = response.segments;

        // The verbose_json response segments have start/end in seconds, matching our interface
        const segmentsInSeconds: TranscriptionSegment[] = openAIsegments.map((seg: OpenAISegment) => ({
          text: seg.text.trim(), // Trim potential whitespace
          start: seg.start,
          end: seg.end,
          // Other available fields in verbose_json segments: id, seek, tokens, temperature, avg_logprob, compression_ratio, no_speech_prob
        }));

        console.log('segmentsInSeconds', segmentsInSeconds);

        // Log if no segments were returned
        if (segmentsInSeconds.length === 0 && response.text) {
          console.log('Transcription returned 0 segments. Full text:', response.text);
        } else if (segmentsInSeconds.length === 0) {
             console.log('Transcription returned 0 segments and no text.');
        }
        
        // Remove the previous console.log for sdkSegments
        // console.log('sdkSegments', sdkSegments); 

        return segmentsInSeconds;
      } catch (error: unknown) {
        let message = 'Unknown error during transcription';
        
        // Check if it's an OpenAI API error
        if (error instanceof OpenAI.APIError) {
            message = `OpenAI API Error (${error.status}): ${error.message}`;
            console.error('OpenAI API Error:', error.status, error.message, error.code, error.type);
        } else if (error instanceof Error) {
          message = error.message;
          console.error('Transcription failed on server:', message, error.stack);
        } else {
          console.error('Transcription failed on server with unknown error type:', String(error));
          message = String(error);
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: message,
          cause: error,
        });
      }
    }),

  // Update the exportWithSubs mutation
  exportWithSubs: publicProcedure
    .input(z.object({
      videoB64: z.string(), // Base64 encoded video without data:URI prefix
      subs: z.array(z.object({
        id: z.string(),
        text: z.string(),
        start: z.number(),
        end: z.number()
      })),
      style: z.object({
        fontFamily: z.string(),
        fontSize: z.number(),
        textColor: z.string(),
        bgColor: z.string(),
        bgOpacity: z.number(),
        borderRadius: z.number(),
        position: z.enum(['bottom', 'top', 'middle', 'custom']),
        customX: z.number().optional(),
        customY: z.number().optional()
      })
    }))
    .mutation(async ({ input }) => {
      try {
        // Set ffmpeg path at runtime
        const ffmpegPath = await getFfmpegPath();
        console.log('[ffmpeg] using binary at', ffmpegPath);
        ffmpeg.setFfmpegPath(ffmpegPath);
        
        // Optional: ensure the binary is executable
        try {
          await fs.chmod(ffmpegPath, 0o755);
        } catch (err) {
          console.warn('Could not set ffmpeg binary as executable:', err);
          // Continue anyway, it might already be executable
        }

        // 1. Create temporary files
        const tmpIn = await tmp.file({ postfix: '.mp4' });
        const tmpAss = await tmp.file({ postfix: '.ass' });
        const tmpOut = await tmp.file({ postfix: '.mp4' });

        // 2. Write video and ASS subtitle files
        await fs.writeFile(tmpIn.path, Buffer.from(input.videoB64, 'base64'));
        
        // Get actual video dimensions
        const videoDimensions = await getVideoSize(tmpIn.path);
        console.log('[ffmpeg] Video dimensions:', videoDimensions);
        console.log('[ffmpeg] Input style for generateAss:', JSON.stringify(input.style, null, 2)); // Log input.style
        
        // Generate ASS subtitle file with correct dimensions
        const assContent = generateAss(
          input.subs, 
          input.style, 
          videoDimensions.width, 
          videoDimensions.height
        );
        console.log('[ffmpeg] Generated ASS content:\n', assContent); // Log generated assContent
        await fs.writeFile(tmpAss.path, assContent);

        // 3. Run FFmpeg to burn subtitles into video
        await new Promise<void>((resolve, reject) => {
          ffmpeg(tmpIn.path)
            .videoFilter(`subtitles=${tmpAss.path.replace(/:/g, '\\:')}`)
            .outputOptions(
              '-c:a', 'copy',          // Copy audio stream without re-encoding
              '-movflags', '+faststart' // Optimize for web streaming
            )
            .save(tmpOut.path)
            .on('end', () => resolve())
            .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)));
        });

        // 4. Read the result and return as base64
        const mp4Buffer = await fs.readFile(tmpOut.path);
        const base64Result = mp4Buffer.toString('base64');

        // 5. Clean up temporary files
        await tmpIn.cleanup();
        await tmpAss.cleanup();
        await tmpOut.cleanup();

        return base64Result;
      } catch (error: unknown) {
        // Error handling
        let message = 'Unknown error during video export';
        
        if (error instanceof Error) {
          message = error.message;
          console.error('Video export failed:', message, error.stack);
        } else {
          console.error('Video export failed with unknown error type:', String(error));
          message = String(error);
        }
        
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: message,
          cause: error,
        });
      }
    })
}); 