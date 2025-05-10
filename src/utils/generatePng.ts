import { createCanvas } from 'canvas';
import fs from 'fs/promises';
import tmp from 'tmp-promise';
import type { Subtitle } from '~/store/subtitleStore';
import type { SubtitleStyle } from '~/app/_components/VideoPlayerWithKonva';
import type { CanvasRenderingContext2D } from 'canvas';

/**
 * Renders a subtitle as PNG with the specified style
 */
export async function renderSubtitleToPng(
  subtitle: Subtitle,
  style: SubtitleStyle,
  videoWidth: number,
  videoHeight: number
): Promise<string> {
  // Increase padding for more visual appeal
  const padding = 24;
  // Compute scale based on preview height, then adjust down by factor to shrink PNG size
  const scaleFactor = (videoHeight / 500) / 1.5;
  const fontSize = Math.max(1, Math.round(style.fontSize * scaleFactor));
  
  // Create canvas context
  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  // Set font for text measurement
  const fontFamily = style.fontFamily.split(',')[0] ?? 'Arial';
  // Set font weight to normal to prevent distortion
  ctx.font = `normal ${fontSize}px "${fontFamily}"`;
  
  // Define consistent line height
  const lineHeight = fontSize * 1.5;
  
  // Maximum text width (80% of video width)
  const maxTextWidth = videoWidth * 0.8;

  // Split on manual breaks, then wrap text to fit within maxTextWidth
  const rawLines = subtitle.text.split(/\\N|\\n|\n/);
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
  const boxWidth = textWidth + padding * 2 * scaleFactor;
  const boxHeight = textHeight + padding * 2 * scaleFactor;
  
  // Resize canvas to final dimensions
  canvas.width = boxWidth;
  canvas.height = boxHeight;
  
  // Draw background with rounded corners
  ctx.fillStyle = style.bgColor;
  ctx.globalAlpha = style.bgOpacity;
  
  // Draw rounded rectangle
  const radius = style.borderRadius * scaleFactor;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(boxWidth - radius, 0);
  ctx.quadraticCurveTo(boxWidth, 0, boxWidth, radius);
  ctx.lineTo(boxWidth, boxHeight - radius);
  ctx.quadraticCurveTo(boxWidth, boxHeight, boxWidth - radius, boxHeight);
  ctx.lineTo(radius, boxHeight);
  ctx.quadraticCurveTo(0, boxHeight, 0, boxHeight - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fill();
  
  // Reset alpha for text
  ctx.globalAlpha = 1;
  
  // Draw text
  ctx.fillStyle = style.textColor;
  ctx.textBaseline = 'top';
  // Add font weight and ensure consistent text rendering
  ctx.font = `normal ${fontSize}px "${fontFamily}"`;
  ctx.textAlign = 'left';
  // Remove the invalid methods
  
  // Add more spacing for better readability
  let y = padding * scaleFactor;
  for (const line of lines) {
    // Draw without maxWidth to prevent automatic horizontal scaling
    ctx.fillText(line, padding * scaleFactor, y);
    y += lineHeight; // More spacing between lines
  }
  
  // Create temporary file
  const tmpFile = await tmp.file({ postfix: '.png' });
  await fs.writeFile(tmpFile.path, canvas.toBuffer('image/png'));
  
  return tmpFile.path;
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
  let prevTag = '0:v'; // Start with the video input
  
  subtitles.forEach((sub, index) => {
    const nextTag = `v${index + 1}`;
    
    // Calculate position
    let x: string;
    let y: string;
    
    if (style.position === 'custom' && typeof style.customX === 'number' && typeof style.customY === 'number') {
      const scaleFactor = videoHeight / 500;
      x = String(Math.round(style.customX * scaleFactor));
      y = String(Math.round(style.customY * scaleFactor));
    } else {
      // Center horizontally
      x = '(main_w-overlay_w)/2';
      
      // Position vertically based on style.position
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
    
    // Add overlay with time enable filter
    overlays.push(
      `[${prevTag}][${index + 1}:v]overlay=${x}:${y}:enable='between(t,${sub.start},${sub.end})'[${nextTag}]`
    );
    
    prevTag = nextTag;
  });
  
  return overlays.join(';');
} 