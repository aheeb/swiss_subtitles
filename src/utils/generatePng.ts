import { createCanvas } from 'canvas';
import fs from 'fs/promises';
import tmp from 'tmp-promise';
import type { SubtitleStyle } from '~/app/_components/VideoPlayerWithKonva';
import type { CanvasRenderingContext2D } from 'canvas';
import { Canvas, registerFont, loadImage } from 'canvas';
import path from 'path';
import * as fsStandard from 'fs'; 

export interface LayoutMetrics {
  lines: string[];
  lineMetrics: Array<{ width: number; height: number }>;
  textWidth: number;
  textHeight: number;
  boxWidth: number;
  boxHeight: number;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  paddingScaled: number;
  scaleFactor: number;
  radius: number;
}

const FONTS_DIR = path.resolve(process.cwd(), 'assets', 'fonts');

const FONT_MAP: Record<string, string> = {
  'Arial': 'arial.ttf',                 
  'Helvetica': 'helvetica.ttf',         
  'Georgia': 'georgia.ttf',            
  'Impact': 'impact.ttf',               
  'Comic Sans MS': 'comic.ttf',         
  'Courier New': 'cour.ttf',           
  'Tahoma': 'tahoma.ttf',             
  'Verdana': 'verdana.ttf',      
};

const registeredFonts = new Set<string>();

function loadAndRegisterFont(fontFamily: string): boolean {
  if (registeredFonts.has(fontFamily)) {
    console.log(`[Font Loading] Font "${fontFamily}" already registered.`);
    return true; // Already registered
  }

  const fileName = FONT_MAP[fontFamily];
  if (!fileName) {
    console.warn(`[Font Loading] No file mapping found for font family: "${fontFamily}". Available in FONT_MAP: ${Object.keys(FONT_MAP).join(', ')}`);
    return false;
  }

  const fontPath = path.join(FONTS_DIR, fileName);
  console.log(`[Font Loading] Attempting to load font "${fontFamily}" from path: ${fontPath}`);

  try {
    if (!fsStandard.existsSync(fontPath)) {
        console.error(`[Font Loading] FAILURE: Font file NOT FOUND at path: ${fontPath} for family "${fontFamily}".`);
        console.error(`[Font Loading] Please ensure the file "${fileName}" exists in the directory: ${FONTS_DIR}`);
        return false;
    }
    console.log(`[Font Loading] SUCCESS: Font file FOUND at path: ${fontPath}`);

    registerFont(fontPath, { family: fontFamily });
    console.log(`[Font Loading] Successfully registered font: "${fontFamily}" from ${fontPath}`);
    registeredFonts.add(fontFamily); // Mark as registered
    return true;
  } catch (error: unknown) { // Type the error
    console.error(`[Font Loading] Error registering font "${fontFamily}" from ${fontPath}:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

const DEFAULT_FONT_FAMILY = 'Arial';
loadAndRegisterFont(DEFAULT_FONT_FAMILY);

/**
 * Calculates layout metrics for a subtitle without rendering it
 */
export function calculateSubtitleLayoutMetrics(
  text: string,
  style: SubtitleStyle,
  videoWidth: number,
  videoHeight: number
): LayoutMetrics {
  // Increase padding for more visual appeal
  const padding = 24;
  // Compute scale based on preview height, then adjust down by factor to shrink PNG size
  const scaleFactor = (videoHeight / 500) / 1.5;
  const fontSize = Math.max(1, Math.round(style.fontSize * scaleFactor));
  
  // Create canvas context for text measurement
  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  // Set font for text measurement
  let fontFamilyToUse = style.fontFamily.split(',')[0]?.trim() ?? DEFAULT_FONT_FAMILY;
  fontFamilyToUse = fontFamilyToUse.replace(/^['"]|['"]$/g, '');
  console.log(`[Layout Metrics] Initial fontFamilyToUse from style: "${fontFamilyToUse}"`);

  if (!loadAndRegisterFont(fontFamilyToUse)) {
    console.warn(`[Layout Metrics] Falling back to default font "${DEFAULT_FONT_FAMILY}" for measurement as "${fontFamilyToUse}" could not be loaded.`);
    fontFamilyToUse = DEFAULT_FONT_FAMILY;
  }
  console.log(`[Layout Metrics] Final fontFamily for measurement: "${fontFamilyToUse}"`);

  ctx.font = `normal ${fontSize}px "${fontFamilyToUse}"`;
  console.log(`[Layout Metrics] ctx.font set to: "${ctx.font}"`);
  
  // Define consistent line height
  const lineHeight = fontSize * 1.5;
  
  // Maximum text width (80% of video width)
  const maxTextWidth = videoWidth * 0.8;

  // Split on manual breaks, then wrap text to fit within maxTextWidth
  const rawLines = text.split(/\\N|\\n|\n/);
  const lines: string[] = [];
  for (const rawLine of rawLines) {
    const words = rawLine.split(' ');
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = ctx.measureText(testLine).width;
      if (testWidth > maxTextWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  // Measure wrapped lines metrics
  const lineMetrics = lines.map(line => {
    const metrics = ctx.measureText(line);
    return {
      width: Math.min(metrics.width, maxTextWidth),
      height: lineHeight
    };
  });

  // Calculate total text size
  const textWidth = Math.max(...lineMetrics.map(m => m.width));
  const textHeight = lines.length * lineHeight;
  
  // Calculate box dimensions (with padding)
  const paddingScaled = padding * scaleFactor;
  const boxWidth = textWidth + paddingScaled * 2;
  const boxHeight = textHeight + paddingScaled * 2;
  
  // Calculate border radius
  const radius = style.borderRadius * scaleFactor;
  
  // Ensure dimensions are even for H.264 compatibility
  const finalBoxWidth = boxWidth % 2 === 0 ? boxWidth : boxWidth + 1;
  const finalBoxHeight = boxHeight % 2 === 0 ? boxHeight : boxHeight + 1;

  return {
    lines,
    lineMetrics,
    textWidth,
    textHeight,
    boxWidth: finalBoxWidth,
    boxHeight: finalBoxHeight,
    fontSize,
    fontFamily: fontFamilyToUse,
    lineHeight,
    paddingScaled,
    scaleFactor,
    radius
  };
}

/**
 * Renders a subtitle as PNG with the specified style
 */
export async function renderSubtitleToPng(
  subtitle: Subtitle,
  style: SubtitleStyle,
  videoWidth: number,
  videoHeight: number,
  options?: {
    overrideLayoutMetrics?: LayoutMetrics;
    fixedCanvasSize?: { width: number; height: number };
  }
): Promise<string> {
  // Calculate layout metrics or use provided ones
  const metrics = options?.overrideLayoutMetrics ?? 
                  calculateSubtitleLayoutMetrics(subtitle.text, style, videoWidth, videoHeight);
  
  // Create canvas with appropriate dimensions
  const canvasWidth = options?.fixedCanvasSize?.width ?? metrics.boxWidth;
  const canvasHeight = options?.fixedCanvasSize?.height ?? metrics.boxHeight;
  
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  // Draw background with rounded corners
  ctx.fillStyle = style.bgColor;
  ctx.globalAlpha = style.bgOpacity;
  
  // Draw rounded rectangle
  const radius = metrics.radius;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(canvasWidth - radius, 0);
  ctx.quadraticCurveTo(canvasWidth, 0, canvasWidth, radius);
  ctx.lineTo(canvasWidth, canvasHeight - radius);
  ctx.quadraticCurveTo(canvasWidth, canvasHeight, canvasWidth - radius, canvasHeight);
  ctx.lineTo(radius, canvasHeight);
  ctx.quadraticCurveTo(0, canvasHeight, 0, canvasHeight - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fill();
  
  // Reset alpha for text
  ctx.globalAlpha = 1;
  
  // Draw text
  ctx.fillStyle = style.textColor;
  ctx.textBaseline = 'top';
  // Set font for rendering
  ctx.font = `normal ${metrics.fontSize}px "${metrics.fontFamily}"`;
  console.log(`[Render PNG] ctx.font set to: "${ctx.font}" (using metrics.fontFamily: "${metrics.fontFamily}")`);
  ctx.textAlign = 'left';
  
  // Calculate horizontal centering if using fixed canvas size
  const textStartX = options?.fixedCanvasSize 
    ? (canvasWidth - metrics.textWidth) / 2 
    : metrics.paddingScaled;
  
  // Draw text centered in the canvas
  let y = metrics.paddingScaled;
  for (const line of metrics.lines) {
    const lineWidth = ctx.measureText(line).width;
    const x = options?.fixedCanvasSize 
      ? (canvasWidth - lineWidth) / 2 
      : textStartX;
    
    ctx.fillText(line, x, y);
    y += metrics.lineHeight;
  }
  
  // Create temporary file
  const tmpFile = await tmp.file({ postfix: '.png' });
  await fs.writeFile(tmpFile.path, canvas.toBuffer('image/png'));
  
  return tmpFile.path;
}

// --- START: Local Backend Type Definitions ---
// Define the expected structure for word timestamps
interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface Subtitle {
  id: string;
  text: string;
  start: number;
  end: number;
  words?: WordTimestamp[];
  speaker?: string;
}

/**
 * Splits a subtitle into word-by-word segments for animation
 */
export function splitSubtitleIntoWords(
  subtitle: Subtitle,
  effectType = 'cumulativePopOn'
): Array<Subtitle & { originalId: string }> {
  const wordTimestamps = subtitle.words;
  
  if (effectType === 'wordByWord' && wordTimestamps && wordTimestamps.length > 0) {
    return wordTimestamps.map((wordData: WordTimestamp, index: number) => {
      return {
        id: `${subtitle.id}-word-${index}`,
        originalId: subtitle.id,
        text: wordData.word,
        start: wordData.start,
        end: wordData.end,
        words: [wordData]
      };
    });
  }

  if (effectType === 'cumulativePopOn' && wordTimestamps && wordTimestamps.length > 0) {
    const cumulativeSubs: Array<Subtitle & { originalId: string }> = [];
    for (let i = 0; i < wordTimestamps.length; i++) {
      const currentWord = wordTimestamps[i]!;
      const nextWord = wordTimestamps[i + 1];
      
      const textToShow = wordTimestamps.slice(0, i + 1).map(w => w.word).join(' ');
      const startTime = currentWord.start;
      const endTime = nextWord ? nextWord.start : subtitle.end;
      const finalEndTime = Math.min(subtitle.end, Math.max(startTime + 0.001, endTime));

      if (finalEndTime > startTime) {
        cumulativeSubs.push({
          id: `${subtitle.id}-cumulative-${i}`,
          originalId: subtitle.id,
          text: textToShow,
          start: startTime,
          end: finalEndTime,
          words: wordTimestamps.slice(0, i + 1)
        });
      }
    }

    if (cumulativeSubs.length === 0) {
        cumulativeSubs.push({ ...subtitle, originalId: subtitle.id });
    }
    return cumulativeSubs;
  }

  const words = subtitle.text.trim().split(/\s+/);
  if (words.length === 0) {
      return [{ ...subtitle, originalId: subtitle.id }];
  }
  
  const totalDuration = subtitle.end - subtitle.start;
  const wordDuration = totalDuration > 0 ? totalDuration / words.length : 0;


  if (effectType === 'cumulativePopOn') {
    return words.map((_, index) => {
      const includedWords = words.slice(0, index + 1);
      return {
        id: `${subtitle.id}-word-${index}`,
        originalId: subtitle.id,
        text: includedWords.join(' '),
        start: subtitle.start + index * wordDuration,
        end: index === words.length - 1 ? subtitle.end : subtitle.start + (index + 1) * wordDuration,
      };
    });
  } else if (effectType === 'wordByWord') {
    return words.map((word, index) => {
      return {
        id: `${subtitle.id}-word-${index}`,
        originalId: subtitle.id,
        text: word,
        start: subtitle.start + index * wordDuration,
        end: subtitle.start + (index + 1) * wordDuration,
      };
    });
  }
  
  return [{
    ...subtitle,
    originalId: subtitle.id
  }];
}

/**
 * Builds a complex filter string for FFmpeg to overlay multiple PNGs
 */
export function buildOverlayFilterComplex(
  subtitles: Subtitle[],
  pngPaths: string[],
  style: SubtitleStyle,
  videoWidth: number,
  videoHeight: number
): string {
  if (subtitles.length !== pngPaths.length) {
    throw new Error('Number of subtitles and PNG paths must match');
  }

  const overlays: string[] = [];
  let prevTag = '0:v';
  
  subtitles.forEach((sub, index) => {
    const nextTag = `v${index + 1}`;
    
    let x: string;
    let y: string;
    
    if (style.position === 'custom' && typeof style.customX === 'number' && typeof style.customY === 'number') {
      const scaleFactor = videoHeight / 500;
      x = String(Math.round(style.customX * scaleFactor));
      y = String(Math.round(style.customY * scaleFactor));
    } else {
      x = '(main_w-overlay_w)/2';
      
      switch (style.position) {
        case 'top':
          y = '50';
          break;
        case 'middle':
          y = '(main_h-overlay_h)/2';
          break;
        case 'bottom':
        default:
          y = 'main_h-overlay_h-50';
          break;
      }
    }
    
    overlays.push(
      `[${prevTag}][${index + 1}:v]overlay=${x}:${y}:enable='between(t,${sub.start},${sub.end})'[${nextTag}]`
    );
    
    prevTag = nextTag;
  });
  
  return overlays.join(';');
} 