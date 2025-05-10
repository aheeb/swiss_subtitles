import type { Subtitle } from '~/store/subtitleStore';
import type { SubtitleStyle } from '~/app/_components/VideoPlayerWithKonva';

/**
 * Generates an Advanced SubStation Alpha (ASS) subtitle file content
 * based on provided subtitles and style.
 */
export function generateAss(
  subs: Subtitle[],
  style: SubtitleStyle,
  width = 1080,
  height = 1920
): string {
  // Debug logs
  console.log('style', style);
  console.log('width', width);
  console.log('height', height);
  console.log('subs', subs);

  const PREVIEW_HEIGHT = 500;
  const scaleFactor = height / PREVIEW_HEIGHT;
  const exportFontSize = Math.max(1, Math.round(style.fontSize * scaleFactor));

  // Convert hex (#RRGGBB) to BGR (BBGGRR)
  const hexToBgr = (hex: string) => {
    if (hex === 'transparent') return 'FFFFFF';
    const r = hex.slice(1, 3);
    const g = hex.slice(3, 5);
    const b = hex.slice(5, 7);
    return `${b}${g}${r}`;
  };

  /**
   * Creates an ASS color in &H AABBGGRR format
   * OutlineColour (field 6) uses this when BorderStyle=3 for the box fill
   */
  const makeColour = (hex: string, opacity = 1) => {
    if (hex === 'transparent') return '&H00FFFFFF';
    const alpha = Math.round((1 - opacity) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
    return `&H${alpha}${hexToBgr(hex)}`;
  };

  // Alignment mapping: bottom=2, middle=5, top=8, custom=7 (top-left anchor)
  const alignmentMap: Record<SubtitleStyle['position'], number> = {
    bottom: 2,
    middle: 5,
    top: 8,
    custom: 7,
  };
  const align = alignmentMap[style.position];

  // Use zero margins for custom positioning
  const margin = style.position === 'custom' ? 0 : 30;

  // Build the ASS Style line
  const styleLine = [
    'Default',
    (style.fontFamily.split(',')[0] ?? 'Arial').replace(/['"]/g, ''), // Fontname
    exportFontSize,                          // Fontsize
    makeColour(style.textColor, 1),          // PrimaryColour (text)
    makeColour(style.textColor, 1),          // SecondaryColour
    makeColour(style.bgColor, style.bgOpacity), // OutlineColour = box fill
    '&H00000000',                            // BackColour (shadow, unused with BS=3)
    0, 0, 0, 0,                             // Bold, Italic, Underline, StrikeOut
    100, 100,                               // ScaleX, ScaleY
    0, 0,                                   // Spacing, Angle
    3,                                      // BorderStyle = opaque box
    2,                                      // Outline (px) as padding
    0,                                      // Shadow
    align,                                  // Alignment
    margin, margin, margin,                 // MarginL, MarginR, MarginV
    1                                       // Encoding
  ].join(',');

  // Script Info section
  const scriptInfo = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

`;

  // Styles section
  const stylesSection = `[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ${styleLine}

`;

  // Events header
  let eventsSection = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Time formatter seconds -> H:MM:SS.CS
  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds % 1) * 100);
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
  };

  // Add each subtitle as Dialogue
  for (const sub of subs) {
    const safeText = sub.text
      .replace(/\\/g, '\\\\')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\r?\n/g, '\\N');

    // Custom positioning with scaling
    let positionTag = '';
    if (
      style.position === 'custom' &&
      typeof style.customX === 'number' &&
      typeof style.customY === 'number'
    ) {
      const x = Math.round(style.customX * scaleFactor);
      const y = Math.round(style.customY * scaleFactor);
      positionTag = `{\\pos(${x},${y})}`;
    }

    eventsSection += `Dialogue: 0,${formatTime(sub.start)},${formatTime(sub.end)},Default,,0,0,0,,${positionTag}${safeText}\n`;
  }

  return scriptInfo + stylesSection + eventsSection;
}
