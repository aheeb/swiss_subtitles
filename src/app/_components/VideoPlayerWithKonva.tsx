"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Stage, Layer, Rect, Text, Group } from 'react-konva'; // Import Konva components
import Konva from 'konva'; // Import the Konva namespace for direct constructor use
import { Play, Pause, Settings, Type, PaintBucket, Layout, Download } from 'lucide-react'; // Added Download icon
import { SubtitleTimeline } from './SubtitleTimeline'; // Import the timeline component
import { useSubtitleStore } from '~/store/subtitleStore'; // Import the subtitle store
import { useExport } from '~/utils/useExport'; // Import the export hook

// Define subtitle style options
export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  textColor: string;
  bgColor: string;
  bgOpacity: number;
  borderRadius: number;
  position: 'bottom' | 'top' | 'middle' | 'custom';
  customX?: number; // Optional custom X position
  customY?: number; // Optional custom Y position
}

// Define font options
const FONT_OPTIONS = [
  { id: 'arial', name: 'Arial', value: 'Arial, sans-serif' },
  { id: 'helvetica', name: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { id: 'georgia', name: 'Georgia', value: 'Georgia, serif' },
  { id: 'impact', name: 'Impact', value: 'Impact, Charcoal, sans-serif' },
  { id: 'comic', name: 'Comic Sans', value: 'Comic Sans MS, cursive' },
  { id: 'courier', name: 'Courier New', value: 'Courier New, monospace' },
  { id: 'tahoma', name: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { id: 'verdana', name: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
];

// Define font size range
const FONT_SIZE_RANGE = {
  min: 12,
  max: 36,
  step: 1
};

// Define text color options
const TEXT_COLOR_OPTIONS = [
  { id: 'white', name: 'White', value: '#FFFFFF' },
  { id: 'yellow', name: 'Yellow', value: '#FFFF00' },
  { id: 'cyan', name: 'Cyan', value: '#00FFFF' },
  { id: 'lime', name: 'Lime', value: '#CCFF00' },
  { id: 'pink', name: 'Pink', value: '#FF66CC' },
  { id: 'orange', name: 'Orange', value: '#FF9900' },
  { id: 'red', name: 'Red', value: '#FF0000' },
  { id: 'black', name: 'Black', value: '#000000' },
];

// Define background color options
const BG_COLOR_OPTIONS = [
  { id: 'black', name: 'Black', value: '#000000' },
  { id: 'darkgray', name: 'Dark Gray', value: '#333333' },
  { id: 'blue', name: 'Blue', value: '#0000CC' },
  { id: 'purple', name: 'Purple', value: '#6600CC' },
  { id: 'red', name: 'Red', value: '#CC0000' },
  { id: 'green', name: 'Green', value: '#006600' },
  { id: 'teal', name: 'Teal', value: '#008888' },
  { id: 'none', name: 'None', value: 'transparent' },
];

// Define opacity range
const OPACITY_RANGE = {
  min: 0,
  max: 1,
  step: 0.05
};

// Define border radius range
const BORDER_RADIUS_RANGE = {
  min: 0,
  max: 30,
  step: 1
};

// Define position options
const POSITION_OPTIONS = [
  { id: 'bottom', name: 'Bottom', value: 'bottom' },
  { id: 'middle', name: 'Middle', value: 'middle' },
  { id: 'top', name: 'Top', value: 'top' },
  { id: 'custom', name: 'Custom (Drag)', value: 'custom' },
];

// Default style
const DEFAULT_STYLE: SubtitleStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 20,
  textColor: '#FFFFFF',
  bgColor: '#000000',
  bgOpacity: 1,    // Use fully opaque background by default
  borderRadius: 8,
  position: 'bottom',
};

// Helper function to format time
const formatTime = (timeInSeconds: number): string => {
  const minutes = Math.floor(timeInSeconds / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Renamed the component
export function VideoPlayerWithKonva() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false); // To prevent timeupdate flicker during seek
  
  // Subtitle style state
  const [currentStyle, setCurrentStyle] = useState<SubtitleStyle>(DEFAULT_STYLE);
  const [showStyleSettings, setShowStyleSettings] = useState<boolean>(false);
  const [activeStyleTab, setActiveStyleTab] = useState<'font' | 'color' | 'position'>('font');

  // Video file reference for export
  const [videoFile, setVideoFile] = useState<File | null>(null);

  const subtitles = useSubtitleStore((state) => state.subtitles);
  const updateSubtitleText = useSubtitleStore((state) => state.updateSubtitle); // Get update function

  // Export functionality
  const { runExport, isLoading: isExporting } = useExport();

  // State for inline editing of subtitles on the video
  const [editingSubtitle, setEditingSubtitle] = useState<{
    id: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null); // Ref for the container
  const progressRef = useRef<HTMLInputElement>(null); // Ref for progress bar

  // Load saved style preference
  useEffect(() => {
    try {
      const savedStyle = localStorage.getItem('subtitleStyle');
      if (savedStyle) {
        const parsedStyle = JSON.parse(savedStyle) as SubtitleStyle;
        
        // Validate required fields
        if (
          parsedStyle && 
          typeof parsedStyle.fontFamily === 'string' &&
          typeof parsedStyle.fontSize === 'number' &&
          typeof parsedStyle.textColor === 'string' &&
          typeof parsedStyle.bgColor === 'string' &&
          typeof parsedStyle.bgOpacity === 'number' &&
          typeof parsedStyle.borderRadius === 'number' &&
          ['bottom', 'middle', 'top'].includes(parsedStyle.position)
        ) {
          setCurrentStyle(parsedStyle);
        }
      }
    } catch (error) {
      console.error('Error loading saved subtitle style:', error);
      // Fallback to default
      setCurrentStyle(DEFAULT_STYLE);
    }
  }, []);

  // Save style to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('subtitleStyle', JSON.stringify(currentStyle));
  }, [currentStyle]);

  // Update a single style property
  const updateStyleProperty = <K extends keyof SubtitleStyle>(
    property: K,
    value: SubtitleStyle[K]
  ) => {
    setCurrentStyle(prev => ({
      ...prev,
      [property]: value
    }));
  };

  // Log active subtitle for debugging Konva interaction
  const activeSubtitleForKonva = subtitles.find(
    (sub) => currentTime >= sub.start && currentTime < sub.end
  );
  useEffect(() => {
    console.log('[VideoPlayerWithKonva] Current activeSubtitle for Konva area:', activeSubtitleForKonva);
  }, [activeSubtitleForKonva, currentTime]);

  const handleEditSave = () => {
    if (editingSubtitle) {
      updateSubtitleText(editingSubtitle.id, { text: editingSubtitle.text });
      setEditingSubtitle(null);
    }
  };

  const handleEditKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleEditSave();
    } else if (event.key === 'Escape') {
      setEditingSubtitle(null);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
      }
      // Store the file object for export
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
    }
  };

  // --- Play/Pause Toggle --- 
  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused || video.ended) {
      video.play().catch(err => console.error("Error playing video:", err));
    } else {
      video.pause();
    }
  }, []);

  // --- Seeking Logic --- 
  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    const newTime = parseFloat(event.target.value);
    if (video && isFinite(newTime)) {
      video.currentTime = newTime;
      setCurrentTime(newTime); // Update state immediately for responsiveness
    }
  };

  // New function to handle seeking from timeline clicks
  const handleTimelineSeek = useCallback((time: number) => {
    const video = videoRef.current;
     if (video && isFinite(time)) {
      video.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const handleSeekingStart = () => {
    setIsSeeking(true);
  };

  const handleSeekingEnd = () => {
    setIsSeeking(false);
  };

  // --- Effect for Video Event Listeners --- 
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => {
        if (!isSeeking) { // Only update if not currently dragging the slider
             setCurrentTime(video.currentTime);
        }
    };
    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      setCurrentTime(video.currentTime);
       // If autoplay was intended but blocked (e.g., unmute needed)
       // This ensures the state reflects reality
      setIsPlaying(!video.paused);
    };
    const handleDurationChange = () => setDuration(video.duration);

    // Add listeners
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('durationchange', handleDurationChange);
    // Auto-play handling (since controls removed)
    // Try to play when metadata loads, respecting mute state
    video.play().catch(err => {
        console.log("Autoplay possibly prevented:", err);
        // Ensure state reflects paused if autoplay fails
        setIsPlaying(false);
    });


    // Cleanup
    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('durationchange', handleDurationChange);
    };
  }, [videoUrl, isSeeking]); // Re-run if video changes or seeking state changes

  // Update canvas size when video metadata is loaded or container resizes
  useEffect(() => {
    const FIXED_HEIGHT = 500; // Fixed height for the video player

    const video = videoRef.current;
    const container = containerRef.current;
    // If no video URL, reset dimensions and exit
    if (!videoUrl) {
        setVideoDimensions({ width: 0, height: 0 });
        return;
    }
    if (!video || !container) return;

    const updateDimensions = () => {
      if (video.videoWidth && video.videoHeight) {
        const ratio = video.videoWidth / video.videoHeight;

        // Height is fixed, width scales with the ratio
        const height = FIXED_HEIGHT;
        const width = height * ratio;

        setVideoDimensions({ width: Math.round(width), height });

        // Set the container dimensions
        container.style.height = `${height}px`;
        container.style.width = `${width}px`;
        container.style.maxWidth = '100%';     // Never overflow parent
        container.style.overflowX = 'auto';    // Allow scroll if too wide
        container.style.aspectRatio = 'auto';  // Override previous setting
      }
    };

    // Initial dimensions on metadata load
    video.addEventListener('loadedmetadata', updateDimensions);
    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(container);

    // Initial call
    updateDimensions();

    // Cleanup function
    return () => {
      resizeObserver.disconnect();
      video.removeEventListener('loadedmetadata', updateDimensions);

      // Revoke the object URL when the component unmounts
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  // Helper function to convert hex color to rgba for the background
  const hexToRgba = (hex: string, opacity: number) => {
    if (hex === 'transparent') return 'transparent';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  // UI helper for style options
  const renderColorBox = (color: string) => {
    return (
      <div 
        className="w-full h-full" 
        style={{ 
          backgroundColor: color === 'transparent' ? 'transparent' : color,
          border: color === 'transparent' ? '1px dashed white' : 'none',
        }}
      />
    );
  };

  // Add handleExport function
  const handleExport = async () => {
    if (!videoFile || !subtitles.length) return;
    
    try {
      await runExport(videoFile, subtitles, currentStyle);
    } catch (error) {
      console.error('Export failed:', error);
      // Here you could add toast notifications or other UI feedback
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-4xl mx-auto">
      {!videoUrl ? (
        <div className="w-full">
          <label
            htmlFor="video-upload"
            className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer bg-white/5 border-white/10 hover:bg-white/10"
          >
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <svg className="w-8 h-8 mb-4 text-white/70" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
                <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"/>
              </svg>
              <p className="mb-2 text-sm text-white/70">
                <span className="font-semibold">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-white/70">MP4, WebM, or Ogg</p>
            </div>
            <input
              id="video-upload"
              type="file"
              className="hidden"
              accept="video/*"
              onChange={handleFileChange}
            />
          </label>
        </div>
      ) : (
         // Container for video and canvas overlay
        <div className="w-full flex flex-col gap-0">
          <div className="flex justify-center items-center w-full">
            <div
                ref={containerRef}
                className="relative bg-black rounded-lg overflow-hidden flex justify-center items-center"
            >
              <video
                ref={videoRef}
                src={videoUrl}
                style={{ 
                  width: `${videoDimensions.width}px`, 
                  height: `${videoDimensions.height}px`,
                  objectFit: 'contain'
                }}
                className="block"
                muted
                loop
              />
              {videoDimensions.width > 0 && videoDimensions.height > 0 && (
                <div 
                  className="absolute top-0 left-0 flex justify-center items-center"
                  style={{ 
                    width: `${videoDimensions.width}px`, 
                    height: `${videoDimensions.height}px` 
                  }}
                >
                  <Stage width={videoDimensions.width} height={videoDimensions.height}>
                    <Layer>
                      {(() => {
                        // Use the memoized/state-tracked activeSubtitleForKonva here
                        const activeSubtitle = activeSubtitleForKonva;

                        // If we are editing this subtitle, don't render the Konva version
                        if (editingSubtitle?.id === activeSubtitle?.id) {
                          return null;
                        }

                        if (!activeSubtitle?.text?.trim()) {
                          return null; // Don't render anything if no active subtitle or text is empty
                        }

                        const konvaTextPadding = 10; // Renamed for clarity within Konva scope
                        
                        const tempTextNode = new Konva.Text({
                            text: activeSubtitle.text,
                            fontSize: currentStyle.fontSize,
                            fontFamily: currentStyle.fontFamily,
                            width: videoDimensions.width - (konvaTextPadding * 4),
                            padding: konvaTextPadding,
                            align: 'center',
                        });
                        const textHeight = tempTextNode.height();
                        const textWidth = tempTextNode.width(); 
                        
                        const rectHeight = textHeight;
                        const rectWidth = Math.max(textWidth, videoDimensions.width * 0.4);
                        
                        // Position based on style
                        let rectY;
                        let rectX = (videoDimensions.width - rectWidth) / 2;
                        
                        if (currentStyle.position === 'custom' && 
                            typeof currentStyle.customX === 'number' && 
                            typeof currentStyle.customY === 'number') {
                          // Use custom position if available
                          rectX = currentStyle.customX;
                          rectY = currentStyle.customY;
                        } else {
                          // Otherwise use predefined positions
                          switch (currentStyle.position) {
                            case 'top':
                              rectY = konvaTextPadding * 2;
                              break;
                            case 'middle':
                              rectY = (videoDimensions.height - rectHeight) / 2;
                              break;
                            case 'bottom':
                            default:
                              rectY = videoDimensions.height - rectHeight - (konvaTextPadding * 2);
                              break;
                          }
                        }

                        const handleDoubleClick = () => {
                            console.log('[VideoPlayerWithKonva] handleDoubleClick triggered');
                            console.log('[VideoPlayerWithKonva] activeSubtitle on double-click:', activeSubtitle);
                            if (!activeSubtitle) return;

                            const editPayload = {
                                id: activeSubtitle.id,
                                text: activeSubtitle.text,
                                x: rectX,
                                y: rectY,
                                width: rectWidth,
                                height: rectHeight,
                            };
                            console.log('[VideoPlayerWithKonva] Setting editingSubtitle with:', editPayload);
                            setEditingSubtitle(editPayload);
                        };

                        // Handle drag end to update subtitle position
                        const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
                          const group = e.target;
                          
                          // Save the new positions to state
                          setCurrentStyle(prev => ({
                            ...prev,
                            position: 'custom',
                            customX: group.x(),
                            customY: group.y()
                          }));
                          
                          console.log('[VideoPlayerWithKonva] Subtitle dragged to:', { x: group.x(), y: group.y() });
                        };

                        const bgColor = currentStyle.bgColor === 'transparent' 
                          ? 'transparent' 
                          : hexToRgba(currentStyle.bgColor, currentStyle.bgOpacity);

                        return (
                          <Group
                            x={rectX}
                            y={rectY}
                            draggable={true}
                            onDragEnd={handleDragEnd}
                            listening={true}
                            onDblClick={handleDoubleClick}
                            onDragStart={() => console.log('[VideoPlayerWithKonva] Starting to drag subtitle')}
                          >
                            {currentStyle.bgColor !== 'transparent' && (
                              <Rect
                                x={0}
                                y={0}
                                width={rectWidth}
                                height={rectHeight}
                                fill={bgColor}
                                cornerRadius={currentStyle.borderRadius}
                                shadowColor="black"
                                shadowBlur={5}
                                shadowOpacity={0.5}
                                listening={true}
                              />
                            )}
                            <Text
                              text={activeSubtitle.text}
                              x={0}
                              y={0}
                              fontSize={currentStyle.fontSize}
                              fontFamily={currentStyle.fontFamily}
                              fill={currentStyle.textColor}
                              width={rectWidth}
                              height={rectHeight}
                              padding={konvaTextPadding} 
                              align="center"
                              verticalAlign="middle"
                              listening={true} 
                            />
                          </Group>
                        );
                      })()}
                    </Layer>
                  </Stage>
                </div>
              )}
              {editingSubtitle && (
                <textarea
                  value={editingSubtitle.text}
                  onChange={(e) => setEditingSubtitle(prev => prev ? { ...prev, text: e.target.value } : null)}
                  onKeyDown={handleEditKeyDown}
                  onBlur={handleEditSave}
                  style={{
                    position: 'absolute',
                    left: `${editingSubtitle.x}px`,
                    top: `${editingSubtitle.y}px`,
                    width: `${editingSubtitle.width}px`,
                    height: `${editingSubtitle.height}px`,
                    backgroundColor: currentStyle.bgColor === 'transparent' 
                      ? 'transparent'
                      : hexToRgba(currentStyle.bgColor, currentStyle.bgOpacity),
                    color: currentStyle.textColor,
                    border: '2px solid #60a5fa',
                    borderRadius: `${currentStyle.borderRadius}px`,
                    fontSize: `${currentStyle.fontSize}px`,
                    fontFamily: currentStyle.fontFamily,
                    textAlign: 'center',
                    padding: `10px`,
                    boxSizing: 'border-box',
                    zIndex: 100, 
                    resize: 'none',
                    overflow: 'hidden', 
                  }}
                  autoFocus
                  onFocus={(e) => e.target.select()} 
                />
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 px-2 py-1 bg-[#252526]">
            <button
              onClick={togglePlayPause}
              className="text-white p-1.5 hover:bg-white/20 rounded-full transition-colors duration-150"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>

            <span className="text-xs text-white/80 font-mono w-10 text-center">
                {formatTime(currentTime)}
            </span>

            <input
              ref={progressRef}
              type="range"
              min="0"
              max={duration || 0}
              value={currentTime || 0}
              onMouseDown={handleSeekingStart}
              onMouseUp={handleSeekingEnd}
              onInput={handleSeek}
              className="flex-1 h-1.5 bg-white/30 rounded-full appearance-none cursor-pointer accent-indigo-400"
              disabled={!duration}
            />

            <span className="text-xs text-white/80 font-mono w-10 text-center">
                {formatTime(duration)}
            </span>
            
            {/* Subtitle style settings button */}
            <button
              onClick={() => setShowStyleSettings(!showStyleSettings)}
              className={`text-white p-1.5 hover:bg-white/20 rounded-full transition-colors duration-150 ${showStyleSettings ? 'bg-white/20' : ''}`}
              aria-label="Subtitle Settings"
              title="Subtitle Settings"
            >
              <Settings size={20} />
            </button>

            {/* Export button */}
            <button
              onClick={handleExport}
              disabled={isExporting || !videoFile || !subtitles.length}
              className={`text-white p-1.5 hover:bg-white/20 rounded-full transition-colors duration-150 ${
                isExporting ? 'bg-indigo-500/50 animate-pulse' : ''
              } ${!videoFile || !subtitles.length ? 'opacity-50 cursor-not-allowed' : ''}`}
              aria-label="Export video with subtitles"
              title="Export video with subtitles"
            >
              <Download size={20} />
            </button>
          </div>

          {/* Export Progress Overlay */}
          {isExporting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-50">
              <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
              <p className="text-white font-medium">Rendering video with subtitles...</p>
              <p className="text-white/70 text-sm mt-2">This may take a few moments</p>
            </div>
          )}

          {/* Subtitle Style Settings Panel - New Component-based Approach */}
          {showStyleSettings && (
            <div className="bg-[#252526] mt-1 p-3 rounded-md shadow-lg border border-white/10">
              {/* Tab Navigation */}
              <div className="flex border-b border-white/10 mb-3">
                <button
                  onClick={() => setActiveStyleTab('font')}
                  className={`flex items-center gap-1 px-4 py-2 ${activeStyleTab === 'font' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-white/70 hover:text-white'}`}
                >
                  <Type size={16} />
                  <span>Font</span>
                </button>
                <button
                  onClick={() => setActiveStyleTab('color')}
                  className={`flex items-center gap-1 px-4 py-2 ${activeStyleTab === 'color' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-white/70 hover:text-white'}`}
                >
                  <PaintBucket size={16} />
                  <span>Colors</span>
                </button>
                <button
                  onClick={() => setActiveStyleTab('position')}
                  className={`flex items-center gap-1 px-4 py-2 ${activeStyleTab === 'position' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-white/70 hover:text-white'}`}
                >
                  <Layout size={16} />
                  <span>Layout</span>
                </button>
              </div>

              {/* Font Tab Content */}
              {activeStyleTab === 'font' && (
                <div className="grid gap-4">
                  {/* Font Family Selection */}
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-1">Font Family</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {FONT_OPTIONS.map(font => (
                        <button
                          key={font.id}
                          onClick={() => updateStyleProperty('fontFamily', font.value)}
                          className={`p-2 rounded border text-sm ${
                            currentStyle.fontFamily === font.value
                              ? 'border-blue-500 bg-blue-500/20 text-white'
                              : 'border-white/10 hover:bg-white/5 text-white/80'
                          }`}
                          style={{ fontFamily: font.value }}
                        >
                          {font.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font Size Selection - Replace buttons with slider */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm font-medium text-white/80">Font Size</label>
                      <span className="text-sm text-white/80 font-mono">{currentStyle.fontSize}px</span>
                    </div>
                    <input
                      type="range"
                      min={FONT_SIZE_RANGE.min}
                      max={FONT_SIZE_RANGE.max}
                      step={FONT_SIZE_RANGE.step}
                      value={currentStyle.fontSize}
                      onChange={(e) => updateStyleProperty('fontSize', parseInt(e.target.value))}
                      className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <div className="flex justify-between mt-1 text-xs text-white/50">
                      <span>{FONT_SIZE_RANGE.min}px</span>
                      <span>{FONT_SIZE_RANGE.max}px</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Colors Tab Content */}
              {activeStyleTab === 'color' && (
                <div className="grid gap-4">
                  {/* Text Color Selection */}
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-1">Text Color</label>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                      {TEXT_COLOR_OPTIONS.map(color => (
                        <button
                          key={color.id}
                          onClick={() => updateStyleProperty('textColor', color.value)}
                          className={`flex items-center justify-center p-1 h-8 rounded border ${
                            currentStyle.textColor === color.value
                              ? 'border-blue-500'
                              : 'border-white/10'
                          }`}
                          title={color.name}
                        >
                          {renderColorBox(color.value)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Background Color Selection */}
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-1">Background</label>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                      {BG_COLOR_OPTIONS.map(color => (
                        <button
                          key={color.id}
                          onClick={() => updateStyleProperty('bgColor', color.value)}
                          className={`flex items-center justify-center p-1 h-8 rounded border ${
                            currentStyle.bgColor === color.value
                              ? 'border-blue-500'
                              : 'border-white/10'
                          }`}
                          title={color.name}
                        >
                          {renderColorBox(color.value)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Opacity Selection - Only show if bgColor is not transparent - Replace with slider */}
                  {currentStyle.bgColor !== 'transparent' && (
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-sm font-medium text-white/80">Background Opacity</label>
                        <span className="text-sm text-white/80 font-mono">{Math.round(currentStyle.bgOpacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={OPACITY_RANGE.min}
                        max={OPACITY_RANGE.max}
                        step={OPACITY_RANGE.step}
                        value={currentStyle.bgOpacity}
                        onChange={(e) => updateStyleProperty('bgOpacity', parseFloat(e.target.value))}
                        className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                      <div className="flex justify-between mt-1 text-xs text-white/50">
                        <span>Transparent</span>
                        <span>Solid</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Position Tab Content */}
              {activeStyleTab === 'position' && (
                <div className="grid gap-4">
                  {/* Position Selection */}
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-1">Position</label>
                    <div className="grid grid-cols-4 gap-2">
                      {POSITION_OPTIONS.map(position => (
                        <button
                          key={position.id}
                          onClick={() => updateStyleProperty('position', position.value as 'bottom' | 'top' | 'middle' | 'custom')}
                          className={`p-2 rounded border text-sm ${
                            currentStyle.position === position.value
                              ? 'border-blue-500 bg-blue-500/20 text-white'
                              : 'border-white/10 hover:bg-white/5 text-white/80'
                          }`}
                        >
                          {position.name}
                        </button>
                      ))}
                    </div>
                    {currentStyle.position === 'custom' && (
                      <p className="mt-2 text-xs text-blue-400 italic">
                        Tip: Click and drag the subtitle on the video to position it exactly where you want.
                      </p>
                    )}
                  </div>

                  {/* Border Radius Selection - Replace with slider */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm font-medium text-white/80">Border Radius</label>
                      <span className="text-sm text-white/80 font-mono">{currentStyle.borderRadius}px</span>
                    </div>
                    <input
                      type="range"
                      min={BORDER_RADIUS_RANGE.min}
                      max={BORDER_RADIUS_RANGE.max}
                      step={BORDER_RADIUS_RANGE.step}
                      value={currentStyle.borderRadius}
                      onChange={(e) => updateStyleProperty('borderRadius', parseInt(e.target.value))}
                      className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <div className="flex justify-between mt-1 text-xs text-white/50">
                      <span>Square</span>
                      <span>Round</span>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="mt-2 p-3 rounded bg-black/50 border border-white/10">
                    <p className="text-xs text-white/70 mb-2">Preview:</p>
                    <div 
                      className="w-full rounded flex items-center justify-center p-2" 
                      style={{
                        backgroundColor: currentStyle.bgColor === 'transparent' 
                          ? 'transparent' 
                          : hexToRgba(currentStyle.bgColor, currentStyle.bgOpacity),
                        borderRadius: `${currentStyle.borderRadius}px`,
                      }}
                    >
                      <span
                        style={{
                          color: currentStyle.textColor,
                          fontFamily: currentStyle.fontFamily,
                          fontSize: `${currentStyle.fontSize}px`,
                        }}
                      >
                        Sample Text
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Subtitle Timeline */} 
          <SubtitleTimeline 
            currentTime={currentTime} 
            duration={duration} 
            onSeek={handleTimelineSeek}
            videoUrl={videoUrl}
          />
        </div>
      )}
    </div>
  );
}