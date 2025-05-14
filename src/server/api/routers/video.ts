import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import OpenAI, { toFile } from 'openai';
import { getOpenAIConfig } from '~/config/env';
import { TRPCError } from '@trpc/server';
import { Buffer } from 'buffer';
import { Readable } from 'stream';

import { file as tmpFile } from 'tmp-promise';
import type { FileResult } from 'tmp-promise';
import * as fs from 'fs/promises';
import ffmpeg, { FfmpegCommand } from 'fluent-ffmpeg';
import { renderSubtitleToPng, buildOverlayFilterComplex, splitSubtitleIntoWords, calculateSubtitleLayoutMetrics } from '~/utils/generatePng';
import path from 'path';
import { execSync } from 'child_process';

import type { Subtitle } from '~/store/subtitleStore';
import type { SubtitleStyle } from "~/app/_components/VideoPlayerWithKonva";

interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

async function getFfmpegPath(): Promise<string> {
  try {
    const ffmpegStatic = await import('ffmpeg-static');
    const resolvedPath: unknown = typeof ffmpegStatic === 'string' 
      ? ffmpegStatic 
      : ffmpegStatic.default;
    
    if (typeof resolvedPath === 'string') {
      try {
        await fs.access(resolvedPath);
        console.log(`[ffmpeg] Found binary at dynamic import path: ${resolvedPath}`);
        return resolvedPath;
      } catch (err) {
        console.warn(`[ffmpeg] Dynamic import path not accessible: ${resolvedPath}`);
      }
    }

    try {
      const pathFromWhich: string = execSync('which ffmpeg', { encoding: 'utf8' }).toString().trim();
      console.log(`[ffmpeg] Found system binary at: ${pathFromWhich}`);
      return pathFromWhich;
    } catch (err) {
      console.warn('[ffmpeg] Could not find ffmpeg in PATH');
    }

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
      }
    }

    const moduleRootPath = path.resolve(process.cwd(), 'node_modules', '.pnpm', 'ffmpeg-static@5.2.0');
    
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
    
    try {
      const directPath = path.resolve(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
      await fs.access(directPath);
      console.log(`[ffmpeg] Found binary at direct node_modules path: ${directPath}`);
      return directPath;
    } catch (err) {
      console.warn('[ffmpeg] Direct node_modules path not accessible');
    }
    
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

export interface TranscriptionSegment {
  text: string;
  start: number; // start time in seconds
  end: number;   // end time in seconds
  words?: WordTimestamp[]; // Add optional word timestamps array
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
  words?: WordTimestamp[]; // Add optional words array to the response type
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

// Helper function to run a single FFmpeg batch
async function runFfmpegBatch(
  inputVideoPath: string,
  pngPaths: string[],
  subtitles: Subtitle[],
  outputVideoPath: string,
  style: SubtitleStyle, // Added style parameter
  videoDimensions: { width: number; height: number } // Added videoDimensions
): Promise<void> {
  const filterComplex = buildOverlayFilterComplex(
    subtitles,
    pngPaths,
    style, // Pass style
    videoDimensions.width, // Pass video width
    videoDimensions.height // Pass video height
  );

  return new Promise<void>((resolve, reject) => {
    const command: FfmpegCommand = ffmpeg(inputVideoPath);
    pngPaths.forEach(pngPath => command.input(pngPath));

    // Corrected video mapping logic as per user feedback
    const lastPngIndexInBatch = pngPaths.length - 1;
    const mapVideoStreamName =
    pngPaths.length > 0
      ? `[v${pngPaths.length}]`  // <─ für N Overlays ist das letzte Label vN
      : '0:v';
    command
      .complexFilter(filterComplex)
      .outputOptions(
        '-map', mapVideoStreamName, // Corrected mapping based on user guidance
        '-map', '0:a?',
        '-c:a', 'copy',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-movflags', '+faststart'
      )
      .on('start', (cmd: string) => console.log(`[ffmpeg batch] Spawned with command: ${cmd}`))
      .on('stderr', (line: string) => console.log(`[ffmpeg batch] stderr: ${line}`))
      .save(outputVideoPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err));
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
          timestamp_granularities: ['word', 'segment'],
        }) as unknown as OpenAIVerboseJSONResponse; // Assert to our expected response type

        console.log('response', response);

        // 4. Validate response (expecting an object with a segments array)
        if (!response || typeof response !== 'object' || !Array.isArray(response.segments)) {
          console.error('Invalid transcript response type from OpenAI. Expected object with segments array, got:', typeof response, response);
          throw new Error('Invalid transcript response: Expected object with segments from OpenAI API.');
        }
        
        // Also log if words are missing, as they are crucial now
        if (!Array.isArray(response.words)) {
          console.warn('OpenAI response missing "words" array. Word-level timing will not be available.');
        }

        // 5. Map the returned segments and associate words
        const openAIsegments = response.segments;
        const allWords = response.words ?? []; // Use empty array if words are missing

        // The verbose_json response segments have start/end in seconds, matching our interface
        const segmentsWithWords: TranscriptionSegment[] = openAIsegments.map((seg: OpenAISegment) => {
          // Find words that fall within this segment's time range
          const segmentWords = allWords.filter(word => 
             word.start >= seg.start && word.end <= seg.end
          );

          return {
            text: seg.text.trim(), // Trim potential whitespace
            start: seg.start,
            end: seg.end,
            words: segmentWords.length > 0 ? segmentWords : undefined // Add words if found
            // Other available fields in verbose_json segments can be added if needed
          };
        });

        console.log('segmentsWithWords', segmentsWithWords);

        // Log if no segments were returned
        if (segmentsWithWords.length === 0 && response.text) {
          console.log('Transcription returned 0 segments. Full text:', response.text);
        } else if (segmentsWithWords.length === 0) {
             console.log('Transcription returned 0 segments and no text.');
        }
        
        // Remove the previous console.log for sdkSegments
        // console.log('sdkSegments', sdkSegments); 

        return segmentsWithWords; // Return the segments with associated words
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
        end: z.number(),
        words: z.array(z.object({
          word: z.string(),
          start: z.number(),
          end: z.number()
        })).optional()
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
        customY: z.number().optional(),
        effectType: z.enum(['none', 'cumulativePopOn', 'wordByWord']).optional().default('none')
      })
    }))
    .mutation(async ({ input }) => {
      try {
        console.log('[exportWithSubs] Received export request.'); // Log start
        // Log the received font family
        console.log(`[exportWithSubs] Received style.fontFamily: "${input.style.fontFamily}"`);

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

        // 1. Create temporary input and output files
        const tmpIn = await tmpFile({ postfix: '.mp4' });
        const tmpOut = await tmpFile({ postfix: '.mp4' });

        // 2. Write video file
        await fs.writeFile(tmpIn.path, Buffer.from(input.videoB64, 'base64'));
        
        // Get actual video dimensions
        const videoDimensions = await getVideoSize(tmpIn.path);
        console.log('[ffmpeg] Video dimensions:', videoDimensions);
        console.log('[ffmpeg] Input style:', JSON.stringify(input.style, null, 2)); 
        
        // 3. Check if word-by-word effect is enabled
        const effectType = input.style.effectType ?? 'none';
        
        console.log(`[ffmpeg] Using subtitle effect: ${effectType}`);
        
        // 4. Process subtitles based on effect type
        const processedSubs: Subtitle[] = [];
        const pngPaths: string[] = [];
        
        if (effectType === 'none') {
          // Standard rendering - one PNG per subtitle
          for (const sub of input.subs) {
            const pngPath = await renderSubtitleToPng(
              sub,
              input.style,
              videoDimensions.width,
              videoDimensions.height
            );
            pngPaths.push(pngPath);
            processedSubs.push(sub);
          }
        } else {
          // Word-by-word effects
          for (const sub of input.subs) {
            if (effectType === 'cumulativePopOn') {
              // Cumulative effect: words appear one by one and stay
              const wordSubtitles = splitSubtitleIntoWords(sub, effectType);
              
              // For each word segment, create a PNG that's sized for the full subtitle
              // but only contains text up to the current word
              const fullLayoutMetrics = calculateSubtitleLayoutMetrics(
                sub.text,
                input.style,
                videoDimensions.width,
                videoDimensions.height
              );
              
              for (const wordSub of wordSubtitles) {
                // Calculate layout for this partial text (for proper word wrapping)
                const partialLayoutMetrics = calculateSubtitleLayoutMetrics(
                  wordSub.text,
                  input.style,
                  videoDimensions.width,
                  videoDimensions.height
                );
                
                // Render PNG with fixed canvas size from the full subtitle
                const pngPath = await renderSubtitleToPng(
                  wordSub,
                  input.style,
                  videoDimensions.width,
                  videoDimensions.height,
                  {
                    overrideLayoutMetrics: partialLayoutMetrics,
                    fixedCanvasSize: {
                      width: fullLayoutMetrics.boxWidth,
                      height: fullLayoutMetrics.boxHeight
                    }
                  }
                );
                
                pngPaths.push(pngPath);
                processedSubs.push(wordSub);
              }
            } else if (effectType === 'wordByWord') {
              // Individual word effect: each word appears and disappears
              const wordSubtitles = splitSubtitleIntoWords(sub, effectType);
              
              for (const wordSub of wordSubtitles) {
                // Render each word as its own PNG
                const pngPath = await renderSubtitleToPng(
                  wordSub,
                  input.style,
                  videoDimensions.width,
                  videoDimensions.height
                );
                
                pngPaths.push(pngPath);
                processedSubs.push(wordSub);
              }
            }
          }
        }
        
        console.log(`[ffmpeg] Generated ${pngPaths.length} PNG subtitle files`);
        
        // --- BATCH PROCESSING LOGIC ---
        const BATCH_SIZE = 200; // As suggested
        let currentVideoPath = tmpIn.path;
        let previousBatchTmpFile: FileResult | null = null; // To manage cleanup of intermediate tmpFile objects

        if (processedSubs.length > 0) {
          for (let i = 0; i < processedSubs.length; i += BATCH_SIZE) {
            const batchSubs = processedSubs.slice(i, i + BATCH_SIZE);
            const batchPngs = pngPaths.slice(i, i + BATCH_SIZE);

            if (batchSubs.length === 0) { // Should not happen if processedSubs.length > 0 initially
              continue;
            }

            const currentBatchOutputTmpFile = await tmpFile({ postfix: '.mp4' });

            console.log(`[ffmpeg] Processing batch: ${i / BATCH_SIZE + 1}, subtitles: ${batchSubs.length}`);
            await runFfmpegBatch(
              currentVideoPath,
              batchPngs,
              batchSubs,
              currentBatchOutputTmpFile.path,
              input.style,
              videoDimensions,
            );

            if (previousBatchTmpFile) {
              await previousBatchTmpFile.cleanup(); // Clean up the intermediate file from the PREVIOUS batch
            } else if (currentVideoPath !== tmpIn.path && i > 0) {
              // Fallback: if currentVideoPath was an intermediate but not tracked by previousBatchTmpFile (should not happen with correct logic)
              // This case is more to handle the user's direct suggestion: if (i > 0) await fs.unlink(currentVid);
              // However, tmp-promise files are best cleaned with .cleanup()
              // For simplicity and to align with tmp-promise, previousBatchTmpFile handles it.
            }
            
            currentVideoPath = currentBatchOutputTmpFile.path;
            previousBatchTmpFile = currentBatchOutputTmpFile; // This file will be cleaned up in the next iteration or after the loop
          }
        }
        
        // After the loop, currentVideoPath is the path to the final processed video
        // and previousBatchTmpFile is its FileResult object (if any batches ran)

        // 8. Read the result and return as base64
        // The final video is at currentVideoPath
        const mp4Buffer = await fs.readFile(currentVideoPath);
        const base64Result = mp4Buffer.toString('base64');

        // 9. Clean up temporary files
        await tmpIn.cleanup(); // Original input video temp file
        // tmpOut is not used if batching occurs and produces intermediate files.
        // The final video (currentVideoPath) is managed by previousBatchTmpFile if batches ran.
        if (previousBatchTmpFile) {
          await previousBatchTmpFile.cleanup(); // Clean up the final video output file if it was created by a batch
        } else if (currentVideoPath !== tmpIn.path) {
          // This case should ideally not be hit if previousBatchTmpFile is managed correctly.
          // It means currentVideoPath is an intermediate file not from tmpIn and not tracked by previousBatchTmpFile.
          // For safety, try to unlink if it's a path we generated but didn't cleanup.
          // However, relying on previousBatchTmpFile.cleanup() is safer for tmp-promise files.
          // If no batches ran, currentVideoPath is tmpIn.path, which is already cleaned by tmpIn.cleanup().
        }
        
        // Also clean up PNG files
        await Promise.all(pngPaths.map(async (pngPath) => {
          try {
            await fs.unlink(pngPath);
          } catch (err) {
            console.warn(`Could not delete temporary PNG file ${pngPath}:`, err);
          }
        }));

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