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

export const videoRouter = createTRPCRouter({
  transcribe: publicProcedure
    .input(z.object({
      videoBuffer: z.string() // Expect Base64 string (WAV audio)
    }))
    .mutation(async ({ input }): Promise<TranscriptionSegment[]> => {
      try {
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
    })
}); 