import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import type { Subtitle } from '~/store/subtitleStore';
import type { SubtitleStyle } from '~/app/_components/VideoPlayerWithKonva';

// Imports needed for video processing logic
import { file as tmpFile, type FileResult } from 'tmp-promise';
import * as fs from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg'; // Import default
import type { FfmpegCommand } from 'fluent-ffmpeg'; // Attempt to import type separately
import {
  renderSubtitleToPng,
  buildOverlayFilterComplex,
  splitSubtitleIntoWords,
  calculateSubtitleLayoutMetrics
} from '~/utils/generatePng'; // Assuming these are correctly exported from generatePng
import path from 'path';
import { execSync } from 'child_process';
import { Buffer } from 'buffer';

console.log('[Worker] Starting video export worker process...');

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null, 
});

connection.on('connect', () => {
  console.log('[Worker] Successfully connected to Redis.');
});

connection.on('error', (err) => {
  console.error('[Worker] Redis connection error:', err);
});

const VIDEO_EXPORT_QUEUE_NAME = 'video-export';

interface VideoExportJobData {
  videoB64: string;
  subs: Subtitle[];
  style: SubtitleStyle;
}

// --- Helper functions (copied from old videoRouter.ts) --- 
async function getFfmpegPath(): Promise<string> {
  // ... (Implementation of getFfmpegPath as provided by user) ...
  // For brevity, assuming the full implementation is copied here.
  // Make sure all internal 'console.log' use a [Worker] prefix for clarity.
  try {
    const ffmpegStatic = await import('ffmpeg-static');
    const resolvedPath: unknown = typeof ffmpegStatic === 'string' 
      ? ffmpegStatic 
      : ffmpegStatic.default;
    
    if (typeof resolvedPath === 'string') {
      try {
        await fs.access(resolvedPath);
        console.log(`[Worker][ffmpeg] Found binary at dynamic import path: ${resolvedPath}`);
        return resolvedPath;
      } catch (err) {
        console.warn(`[Worker][ffmpeg] Dynamic import path not accessible: ${resolvedPath}`);
      }
    }
    try {
      const pathFromWhich: string = execSync('which ffmpeg', { encoding: 'utf8' }).toString().trim();
      console.log(`[Worker][ffmpeg] Found system binary at: ${pathFromWhich}`);
      return pathFromWhich;
    } catch (err) {
      console.warn('[Worker][ffmpeg] Could not find ffmpeg in PATH');
    }
    const commonPaths = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
    for (const commonPath of commonPaths) {
      try {
        await fs.access(commonPath);
        console.log(`[Worker][ffmpeg] Found binary at common path: ${commonPath}`);
        return commonPath;
      } catch {}
    }
    const moduleRootPath = path.resolve(process.cwd(), 'node_modules', '.pnpm', 'ffmpeg-static@5.2.0');
    let binaryPath: string | undefined;
    if (process.platform === 'darwin') {
      binaryPath = path.join(moduleRootPath, 'node_modules', 'ffmpeg-static', 'bin', 'darwin', process.arch === 'arm64' ? 'arm64' : 'x64', 'ffmpeg');
    } else if (process.platform === 'linux') {
      binaryPath = path.join(moduleRootPath, 'node_modules', 'ffmpeg-static', 'bin', 'linux', 'x64', 'ffmpeg');
    } else if (process.platform === 'win32') {
      binaryPath = path.join(moduleRootPath, 'node_modules', 'ffmpeg-static', 'bin', 'win32', 'x64', 'ffmpeg.exe');
    }
    if (binaryPath) {
      try {
        await fs.access(binaryPath);
        console.log(`[Worker][ffmpeg] Found binary at resolved path: ${binaryPath}`);
        return binaryPath;
      } catch (err) {
        console.warn(`[Worker][ffmpeg] Resolved path not accessible: ${binaryPath}`);
      }
    }
    try {
      const directPath = path.resolve(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
      await fs.access(directPath);
      console.log(`[Worker][ffmpeg] Found binary at direct node_modules path: ${directPath}`);
      return directPath;
    } catch (err) {
      console.warn('[Worker][ffmpeg] Direct node_modules path not accessible');
    }
    if (process.platform === 'darwin') {
      try {
        const homebrewPath = execSync('brew --prefix ffmpeg', { encoding: 'utf8' }).toString().trim();
        if (homebrewPath) {
          const brewBinaryPath = path.join(homebrewPath, 'bin', 'ffmpeg');
          await fs.access(brewBinaryPath);
          console.log(`[Worker][ffmpeg] Found binary installed via Homebrew: ${brewBinaryPath}`);
          return brewBinaryPath;
        }
      } catch (err) {
        console.warn('[Worker][ffmpeg] Could not find ffmpeg installed via Homebrew');
      }
    }
    throw new Error('Could not resolve ffmpeg path through any method');
  } catch (error) {
    console.error('[Worker][ffmpeg] Error resolving path:', error);
    throw new Error(`Failed to resolve ffmpeg path: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function getVideoSize(filePath: string): Promise<{width: number; height: number}> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(new Error(`[Worker] Failed to probe video: ${String(err)}`));
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      if (!videoStream?.width || !videoStream?.height) {
        return reject(new Error('[Worker] No valid video stream found'));
      }
      resolve({ width: videoStream.width, height: videoStream.height });
    });
  });
}

async function runFfmpegBatch(
  inputVideoPath: string,
  pngPaths: string[],
  subtitles: Subtitle[],
  outputVideoPath: string,
  style: SubtitleStyle,
  videoDimensions: { width: number; height: number },
  job: Job<VideoExportJobData, string, string>,
  progressOffset: number,
  batchWeight: number
): Promise<void> {
  const filterComplex = buildOverlayFilterComplex(
    subtitles, pngPaths, style, videoDimensions.width, videoDimensions.height
  );
  return new Promise<void>((resolve, reject) => {
    const command: FfmpegCommand = ffmpeg(inputVideoPath);
    pngPaths.forEach(pngPath => command.input(pngPath));
    const mapVideoStreamName = pngPaths.length > 0 ? `[v${pngPaths.length}]` : '0:v';
    command
      .complexFilter(filterComplex)
      .outputOptions(
        '-map', mapVideoStreamName,
        '-map', '0:a?',
        '-c:a', 'copy',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-movflags', '+faststart',
        '-threads', '0',
        '-filter_complex_threads', '0'
      )
      .on('start', (cmd: string) => console.log(`[Worker][ffmpeg batch] Spawned with command: ${cmd}`))
      .on('stderr', (line: string) => console.log(`[Worker][ffmpeg batch] stderr: ${line}`))
      .on('progress', (progress) => {
        void (async () => {
          if (progress.percent && progress.percent >= 0) {
            const currentBatchProgress = progress.percent;
            const overallProgress = Math.min(100, progressOffset + (currentBatchProgress * (batchWeight / 100)));
            console.log(`[Worker] Job ${job.id} batch progress: ${currentBatchProgress.toFixed(2)}%, overall: ${overallProgress.toFixed(2)}%`);
            try {
              await job.updateProgress(overallProgress);
            } catch (err) {
              console.warn(`[Worker] Job ${job.id} failed to update progress:`, err);
            }
          }
        })();
      })
      .save(outputVideoPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err));
  });
}
// --- End of Helper functions ---

async function processVideoExport(job: Job<VideoExportJobData, string, string>): Promise<string> {
  console.log(`[Worker] Received job ${job.id}. Processing...`);
  await job.updateProgress(0);
  const { videoB64, subs, style } = job.data;

  const ffmpegPath = await getFfmpegPath();
  console.log('[Worker][ffmpeg] Using binary at', ffmpegPath);
  ffmpeg.setFfmpegPath(ffmpegPath);
  try {
    await fs.chmod(ffmpegPath, 0o755);
  } catch (err) {
    console.warn('[Worker] Could not set ffmpeg binary as executable:', err);
  }

  const tmpIn = await tmpFile({ postfix: '.mp4' });
  let previousBatchTmpFile: FileResult | null = null;
  const allPngPaths: string[] = []; // To collect all PNG paths for final cleanup

  try {
    await fs.writeFile(tmpIn.path, Buffer.from(videoB64, 'base64'));
    const videoDimensions = await getVideoSize(tmpIn.path);
    console.log('[Worker][ffmpeg] Video dimensions:', videoDimensions);
    console.log('[Worker][ffmpeg] Input style:', JSON.stringify(style, null, 2));

    const effectType = style.effectType ?? 'none';
    console.log(`[Worker][ffmpeg] Using subtitle effect: ${effectType}`);

    const processedSubsForFfmpeg: Subtitle[] = [];
    // currentPngBatchPaths and allPngPaths will be populated after Promise.all resolves
    const pngGenerationPromises: Promise<string>[] = [];

    if (effectType === 'none') {
      for (const sub of subs) {
        processedSubsForFfmpeg.push(sub); // Keep track of the subtitle for ffmpeg
        pngGenerationPromises.push(
          renderSubtitleToPng(sub, style, videoDimensions.width, videoDimensions.height)
        );
      }
    } else {
      for (const sub of subs) {
        const wordSubtitles = splitSubtitleIntoWords(sub, effectType);
        const fullLayoutMetrics = calculateSubtitleLayoutMetrics(sub.text, style, videoDimensions.width, videoDimensions.height);
        for (const wordSub of wordSubtitles) {
          processedSubsForFfmpeg.push(wordSub); // Keep track of the word-subtitle for ffmpeg
          const partialLayoutMetrics = calculateSubtitleLayoutMetrics(wordSub.text, style, videoDimensions.width, videoDimensions.height);
          pngGenerationPromises.push(
            renderSubtitleToPng(wordSub, style, videoDimensions.width, videoDimensions.height, {
              overrideLayoutMetrics: partialLayoutMetrics,
              fixedCanvasSize: { width: fullLayoutMetrics.boxWidth, height: fullLayoutMetrics.boxHeight }
            })
          );
        }
      }
    }
    
    console.log(`[Worker][ffmpeg] Starting concurrent generation of ${pngGenerationPromises.length} PNG subtitle files...`);
    const generatedPngPaths = await Promise.all(pngGenerationPromises);
    
    // Populate currentPngBatchPaths and allPngPaths with the results
    // The order is preserved by Promise.all, aligning with processedSubsForFfmpeg
    const currentPngBatchPaths = [...generatedPngPaths];
    allPngPaths.push(...generatedPngPaths); // Add to allPngPaths for cleanup

    console.log(`[Worker][ffmpeg] Generated ${currentPngBatchPaths.length} PNG subtitle files`);

    const BATCH_SIZE = 200;
    let currentVideoPath = tmpIn.path;
    let accumulatedProgress = 0;

    if (processedSubsForFfmpeg.length > 0) {
      const totalBatches = Math.ceil(processedSubsForFfmpeg.length / BATCH_SIZE);
      const weightPerBatch = 100 / totalBatches;

      for (let i = 0; i < processedSubsForFfmpeg.length; i += BATCH_SIZE) {
        const batchSubs = processedSubsForFfmpeg.slice(i, i + BATCH_SIZE);
        const batchPngs = currentPngBatchPaths.slice(i, i + BATCH_SIZE);
        if (batchSubs.length === 0) continue;

        const currentBatchOutputTmpFile = await tmpFile({ postfix: '.mp4' });
        const batchNumber = i / BATCH_SIZE + 1;
        console.log(`[Worker][ffmpeg] Processing batch: ${batchNumber}/${totalBatches}, subtitles: ${batchSubs.length}`);
        
        const progressOffset = accumulatedProgress;

        await runFfmpegBatch(
          currentVideoPath, 
          batchPngs, 
          batchSubs, 
          currentBatchOutputTmpFile.path, 
          style, 
          videoDimensions,
          job,
          progressOffset,
          weightPerBatch
        );
        
        accumulatedProgress += weightPerBatch;

        if (previousBatchTmpFile) {
          await previousBatchTmpFile.cleanup();
        } else if (currentVideoPath !== tmpIn.path && i > 0) {
           // This case should ideally not be hit with tmpFile management
        }
        currentVideoPath = currentBatchOutputTmpFile.path;
        previousBatchTmpFile = currentBatchOutputTmpFile;
      }
    }

    const mp4Buffer = await fs.readFile(currentVideoPath);
    const resultBase64 = mp4Buffer.toString('base64');
    console.log(`[Worker] Successfully processed job ${job.id}. Output size: ${resultBase64.length}`);
    await job.updateProgress(100);
    return resultBase64;

  } finally {
    console.log(`[Worker] Cleaning up temporary files for job ${job.id}`);
    await tmpIn.cleanup();
    if (previousBatchTmpFile) {
      await previousBatchTmpFile.cleanup();
    }
    await Promise.all(allPngPaths.map(async (pngPath) => {
      try {
        await fs.unlink(pngPath);
      } catch (err) {
        console.warn(`[Worker] Could not delete temporary PNG file ${pngPath}:`, err);
      }
    }));
    console.log(`[Worker] Finished cleanup for job ${job.id}`);
  }
}

const videoExportWorker = new Worker<VideoExportJobData, string, string>(
  VIDEO_EXPORT_QUEUE_NAME,
  processVideoExport,
  {
    connection,
    concurrency: parseInt(process.env.VIDEO_WORKER_CONCURRENCY ?? '1', 10),
    limiter: {
      max: parseInt(process.env.VIDEO_WORKER_LIMITER_MAX ?? '10', 10),
      duration: parseInt(process.env.VIDEO_WORKER_LIMITER_DURATION ?? '1000', 10),
    },
  }
);

console.log(`[Worker] Video export worker listening to queue: '${VIDEO_EXPORT_QUEUE_NAME}'`);

videoExportWorker.on('completed', (job: Job<VideoExportJobData, string, string>, result: string) => {
  console.log(`[Worker] Job ${job.id} completed successfully. Result length: ${result.length}`);
});

videoExportWorker.on('failed', (job: Job<VideoExportJobData, string, string> | undefined, err: Error) => {
  if (job) {
    console.error(`[Worker] Job ${job.id} failed with error: ${err.message}`, err.stack);
  } else {
    console.error(`[Worker] A job failed with error (job data unavailable): ${err.message}`, err.stack);
  }
});

videoExportWorker.on('error', err => {
  console.error('[Worker] Worker encountered an error:', err);
});

async function gracefulShutdown(signal: string) {
  console.log(`[Worker] Received ${signal}. Closing worker...`);
  await videoExportWorker.close();
  await connection.quit();
  console.log('[Worker] Worker closed. Exiting.');
  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM')); 
process.on('SIGINT', () => void gracefulShutdown('SIGINT')); 