"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Stage, Layer, Rect, Text, Group } from 'react-konva'; // Import Konva components
import Konva from 'konva'; // Import the Konva namespace for direct constructor use
import { Play, Pause } from 'lucide-react'; // Using lucide-react for icons
import { SubtitleTimeline } from './SubtitleTimeline'; // Import the timeline component
import { useSubtitleStore } from '~/store/subtitleStore'; // Import the subtitle store

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

  const subtitles = useSubtitleStore((state) => state.subtitles);
  const updateSubtitleText = useSubtitleStore((state) => state.updateSubtitle); // Get update function

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

  // Log active subtitle for debugging Konva interaction
  // This needs to be at the top level of the component
  const activeSubtitleForKonva = subtitles.find(
    (sub) => currentTime >= sub.start && currentTime < sub.end
  );
  useEffect(() => {
    console.log('[VideoPlayerWithKonva] Current activeSubtitle for Konva area:', activeSubtitleForKonva);
  }, [activeSubtitleForKonva, currentTime]); // Log when it changes or currentTime changes

  const handleEditSave = () => {
    if (editingSubtitle) {
      updateSubtitleText(editingSubtitle.id, { text: editingSubtitle.text });
      setEditingSubtitle(null);
    }
  };

  const handleEditKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); // Prevent newline in textarea
      handleEditSave();
    } else if (event.key === 'Escape') {
      setEditingSubtitle(null); // Discard changes
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
                            fontSize: 20,
                            fontFamily: 'Arial',
                            width: videoDimensions.width - (konvaTextPadding * 4),
                            padding: konvaTextPadding,
                            align: 'center',
                        });
                        const textHeight = tempTextNode.height();
                        const textWidth = tempTextNode.width(); 
                        
                        const rectHeight = textHeight;
                        const rectWidth = Math.max(textWidth, videoDimensions.width * 0.4);
                        
                        const rectX = (videoDimensions.width - rectWidth) / 2; 
                        const rectY = videoDimensions.height - rectHeight - (konvaTextPadding * 2);

                        const handleDoubleClick = () => {
                            console.log('[VideoPlayerWithKonva] handleDoubleClick triggered');
                            // activeSubtitle here refers to the one derived from activeSubtitleForKonva
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

                        return (
                          <Group
                            listening={true}
                            onDblClick={handleDoubleClick}
                          >
                            <Rect
                              x={rectX}
                              y={rectY}
                              width={rectWidth}
                              height={rectHeight}
                              fill="rgba(0,0,0,0.7)"
                              cornerRadius={8}
                              shadowColor="black"
                              shadowBlur={5}
                              shadowOpacity={0.5}
                              listening={true}
                            />
                            <Text
                              text={activeSubtitle.text}
                              x={rectX}
                              y={rectY}
                              fontSize={20}
                              fontFamily="Arial"
                              fill="white"
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
              {/* HTML Textarea for Editing Subtitles - MOVED HERE */}
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
                    backgroundColor: 'rgba(0,0,0,0.75)',
                    color: 'white',
                    border: '2px solid #60a5fa', // Tailwind blue-400
                    borderRadius: '8px',
                    fontSize: '20px',
                    fontFamily: 'Arial',
                    textAlign: 'center',
                    padding: `10px`, // Use a fixed value or a component-level const
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
          </div>

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