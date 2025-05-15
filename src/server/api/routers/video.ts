import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import OpenAI, { toFile } from 'openai';
import { getOpenAIConfig } from '~/config/env';
import { TRPCError } from '@trpc/server';
import { Buffer } from 'buffer';
import { Readable } from 'stream';



import type { Subtitle } from '~/store/subtitleStore';
import type { SubtitleStyle } from "~/app/_components/VideoPlayerWithKonva";

// Import the queue
import { videoExportQueue } from '~/server/lib/queue';

interface WordTimestamp {
  word: string;
  start: number;
  end: number;
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

// Define the job data interface
interface VideoExportJobData {
  videoB64: string;
  subs: Subtitle[]; // Make sure Subtitle type matches Zod schema
  style: SubtitleStyle; // Make sure SubtitleStyle matches Zod schema
  // videoFileName: string; // Optional: if you want to pass the original filename
}

export const videoRouter = createTRPCRouter({
  transcribe: publicProcedure
    .input(z.object({
      videoBuffer: z.string() // Expect Base64 string (WAV audio)
    }))
    .mutation(async ({ input }): Promise<TranscriptionSegment[]> => {
      try {
        // Set ffmpeg path at runtime for transcribe as well
        // const ffmpegPath = await getFfmpegPath(); // This call needs to be re-evaluated
        // console.log('[ffmpeg] using binary at', ffmpegPath);
        // ffmpeg.setFfmpegPath(ffmpegPath); // And this one too.
        // For now, let's assume transcribe might need its own ffmpeg path logic or we address it later.
        // For this refactor, we focus on exportWithSubs. If transcribe breaks, it's a separate issue.

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
        })).optional(),
        // speaker: z.string().optional(), // Removed speaker as it's not in Subtitle type from store
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
      }),
      // videoFileName: z.string().optional(), // Optional: if you want to pass the original filename
    }))
    .mutation(async ({ input }) => {
      try {
        console.log('[exportWithSubs] Received export request.');
        console.log(`[exportWithSubs] Received style.fontFamily: "${input.style.fontFamily}"`);
        console.log(`[exportWithSubs] Effect type: "${input.style.effectType}"`);

        // Prepare the job data from the input
        // Ensure that the structure of input.subs and input.style
        // is compatible with the VideoExportJobData interface.
        // Zod validation already ensures the basic structure.
        const jobData: VideoExportJobData = {
          videoB64: input.videoB64,
          subs: input.subs,
          style: input.style,
          // videoFileName: input.videoFileName, // If you add videoFileName to input
        };

        // Add the job to the queue
        const job = await videoExportQueue.add('video-export-job', jobData);

        console.log(`[exportWithSubs] Job with ID ${job.id} added to the queue.`);

        return {
          success: true,
          jobId: job.id,
          message: 'Video export process has been started.',
        };

      } catch (error: unknown) {
        let message = 'Unknown error during exportWithSubs job submission';
        if (error instanceof Error) {
          message = error.message;
          console.error('[exportWithSubs] Error submitting job to queue:', message, error.stack);
        } else {
          console.error('[exportWithSubs] Error submitting job to queue with unknown error type:', String(error));
          message = String(error);
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to start video export: ${message}`,
          cause: error,
        });
      }
    }),

  getJobStatus: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const job = await videoExportQueue.getJob(input.jobId);

      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Job with ID ${input.jobId} not found.`,
        });
      }

      const state = await job.getState();
      const progress = job.progress;
      const returnValue = job.returnvalue;
      const failedReason = job.failedReason;

      // Determine if the job is actively being processed or waiting
      const isActive = state === 'active';
      const isWaiting = state === 'waiting' || state === 'delayed';
      const isCompleted = state === 'completed';
      const isFailed = state === 'failed';

      // Return a structured response
      return {
        jobId: job.id,
        status: state,
        isActive,
        isWaiting,
        isCompleted,
        isFailed,
        progress: progress, // Could be a number (0-100) or an object
        returnValue: returnValue, // This will contain the Base64 string on success
        failedReason: failedReason, // Error message on failure
        timestamp: job.timestamp, // When the job was created
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      };
    }),
}); 