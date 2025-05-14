"use client";

import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useSubtitleStore, type Subtitle } from '~/store/subtitleStore';
import { Play, ZoomIn, ZoomOut, Mic } from 'lucide-react'; // Added Mic icon
import { VideoThumbnailStrip } from './VideoThumbnailStrip';
import { api } from "~/trpc/react";
import type { TranscriptionSegment } from "~/server/api/routers/video";

// Define the expected structure for segments coming from the backend
interface TranscriptionSegmentFromBackend {
  text: string;
  start: number;
  end: number;
  words?: Array<{ word: string; start: number; end: number }>;
}

// --- START: Restore Audio processing functions ---
/**
 * Helper to write ASCII strings into DataView.
 */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Encodes a Float32Array of mono PCM samples into a WAV file ArrayBuffer.
 */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample * 1;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);          // Subchunk1Size
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, 1, true);           // channels
  view.setUint32(24, sampleRate, true);  // sample rate
  view.setUint32(28, byteRate, true);    // byte rate
  view.setUint16(32, blockAlign, true);  // block align
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples
  let offset = 44;
  for (const sample of Array.from(samples)) {
    const s = Math.max(-1, Math.min(1, sample));
    const intSample = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return buffer;
}

/**
 * Decodes, resamples, and encodes the audio track of a video File into a 16 kHz PCM WAV ArrayBuffer.
 */
async function extractCompressedAudioFromVideo(
  videoBuffer: ArrayBuffer
): Promise<ArrayBuffer> {
  // 1. Decode audio via Web Audio API
  const decodeCtx = new AudioContext();
  const decodedBuffer = await decodeCtx.decodeAudioData(videoBuffer);

  // 2. Resample to 16 kHz using OfflineAudioContext
  const targetRate = 16000;
  const offlineCtx = new OfflineAudioContext(
    1, // Mono
    Math.ceil(decodedBuffer.length * (targetRate / decodedBuffer.sampleRate)),
    targetRate
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = decodedBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  const renderedBuffer = await offlineCtx.startRendering();
  const samples = renderedBuffer.getChannelData(0);

  // 3. Encode samples as 16-bit PCM WAV
  return encodeWav(samples, targetRate);
}
// Helper function to convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return window.btoa(binary);
}
// --- END: Restore Audio processing functions ---

const formatTimeRuler = (timeInSeconds: number): string => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

interface SubtitleTimelineProps {
    currentTime: number;
    duration: number;
    onSeek: (time: number) => void; // Function to call when seeking
    videoUrl?: string; // Add videoUrl prop
}

export function SubtitleTimeline({ 
    currentTime,
    duration,
    onSeek,
    videoUrl
}: SubtitleTimelineProps) {
    const subtitles = useSubtitleStore((state) => state.subtitles);
    const addSubtitles = useSubtitleStore((state) => state.addSubtitles);
    const updateSubtitleTime = useSubtitleStore((state) => state.updateSubtitle); // Renamed for clarity
    const timelineRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const zoomAnchorRef = useRef<{ time: number; mouseX: number } | null>(null); // Ref to store zoom anchor point
    
    // State for drag operations
    const [activeDrag, setActiveDrag] = useState<{
        id: string;
        mode: 'resize-start' | 'resize-end'; // Later: | 'move'
        initialMouseX: number;
        originalStart: number;
        originalEnd: number;
    } | null>(null);

    // Zoom state (pixels per second)
    const [pixelsPerSecond, setPixelsPerSecond] = useState(50);
    const timelineWidth = duration * pixelsPerSecond;

    // Effect for handling global mouse move and up during drag operations
    useEffect(() => {
        if (!activeDrag) return;

        const handleGlobalMouseMove = (event: MouseEvent) => {
            if (!activeDrag || !containerRef.current) return; // Ensure activeDrag and containerRef are present
            
            // Prevent text selection during drag
            event.preventDefault();

            const deltaX = event.clientX - activeDrag.initialMouseX;
            const deltaTime = deltaX / pixelsPerSecond;
            const MIN_DURATION = 0.1; // Minimum duration of a subtitle segment in seconds

            let newStart = activeDrag.originalStart;
            let newEnd = activeDrag.originalEnd;

            if (activeDrag.mode === 'resize-start') {
                newStart = activeDrag.originalStart + deltaTime;
                // Constraints
                newStart = Math.max(0, newStart); // Cannot be less than 0
                newStart = Math.min(newStart, activeDrag.originalEnd - MIN_DURATION); // Must be less than end - min_duration
            } else if (activeDrag.mode === 'resize-end') {
                newEnd = activeDrag.originalEnd + deltaTime;
                // Constraints
                newEnd = Math.max(activeDrag.originalStart + MIN_DURATION, newEnd); // Must be greater than start + min_duration
                if (duration > 0) { // Only apply if duration is known
                    newEnd = Math.min(newEnd, duration); // Cannot exceed video duration
                }
            }
            
            // Ensure start is always less than end
            if (newStart >= newEnd) {
                if (activeDrag.mode === 'resize-start') {
                    newStart = newEnd - MIN_DURATION;
                } else {
                    newEnd = newStart + MIN_DURATION;
                }
            }

            // Update the subtitle store
            // Consider debouncing or updating on mouseUp if performance issues arise
            if (activeDrag.mode === 'resize-start' && newStart !== activeDrag.originalStart) {
                 updateSubtitleTime(activeDrag.id, { start: newStart });
            } else if (activeDrag.mode === 'resize-end' && newEnd !== activeDrag.originalEnd) {
                 updateSubtitleTime(activeDrag.id, { end: newEnd });
            }
        };

        const handleGlobalMouseUp = () => {
            // console.log('Mouse up, clearing activeDrag');
            setActiveDrag(null);
        };

        // Add event listeners to the window
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);

        // Cleanup function to remove event listeners
        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [activeDrag, pixelsPerSecond, duration, updateSubtitleTime]); // Dependencies for the effect

    // Min and max zoom levels
    const MIN_ZOOM = 10; // 10px per second
    const MAX_ZOOM = 200; // 200px per second
    
    const transcribeMutation = api.video.transcribe.useMutation({
        onSuccess: (data: TranscriptionSegmentFromBackend[]) => {
            console.log('Transcription successful:', data);
            // Generate unique IDs for each subtitle segment
            const newSubtitles: Subtitle[] = data.map((segment, index) => ({
                id: `sub-${Date.now()}-${index}`,
                text: segment.text,
                start: segment.start,
                end: segment.end,
                words: segment.words // Pass the words array directly
            }));
            addSubtitles(newSubtitles);
        },
        onError: (error) => {
            console.error('Transcription failed:', error);
            // Here you might want to show an error message to the user
        },
    });

    // Handle zoom with wheel/trackpad
    const handleZoom = (event: WheelEvent) => {
        event.preventDefault();
        if (!containerRef.current) return; // Ensure container exists

        // Check if it's a pinch-to-zoom gesture (trackpad)
        const isPinch = event.ctrlKey;

        // Get the mouse position relative to the CONTAINER
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = event.clientX - rect.left; // Use container's rect.left
        const scrollLeft = containerRef.current.scrollLeft;
        const timeAtMouse = (mouseX + scrollLeft) / pixelsPerSecond;

        // Calculate zoom factor based on wheel delta or pinch gesture
        let zoomFactor = 1;
        if (isPinch) {
            // For pinch gestures
            zoomFactor = 1 - (event.deltaY * 0.01);
        } else if (event.deltaY !== 0) {
            // For mouse wheel + Ctrl/Cmd
            zoomFactor = 1 - (Math.sign(event.deltaY) * 0.1);
        }

        // Apply zoom
        const newPixelsPerSecond = Math.min(
            Math.max(
                pixelsPerSecond * zoomFactor,
                MIN_ZOOM
            ),
            MAX_ZOOM
        );

        if (newPixelsPerSecond !== pixelsPerSecond) {
            // Store anchor point BEFORE updating state
            zoomAnchorRef.current = { time: timeAtMouse, mouseX: mouseX };
            setPixelsPerSecond(newPixelsPerSecond);

            // DO NOT adjust scrollLeft here directly
            // if (containerRef.current) {
            //     const newScrollLeft = (timeAtMouse * newPixelsPerSecond) - mouseX;
            //     containerRef.current.scrollLeft = newScrollLeft;
            // }
        }
    };

    // Effect to adjust scroll AFTER zoom state changes and re-render
    useEffect(() => {
        if (zoomAnchorRef.current && containerRef.current) {
            const { time, mouseX } = zoomAnchorRef.current;
            // Calculate the new scroll position to keep the anchor time under the mouse
            const newScrollLeft = (time * pixelsPerSecond) - mouseX;
            containerRef.current.scrollLeft = Math.max(0, newScrollLeft); // Ensure scrollLeft isn't negative

            // Reset the anchor ref so this only runs once per zoom action
            zoomAnchorRef.current = null;
        }
    }, [pixelsPerSecond]); // Run this effect when pixelsPerSecond changes

    // Add zoom event listeners (wheel)
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                handleZoom(e);
            }
        };

        container.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            container.removeEventListener('wheel', handleWheel);
        };
    }, [pixelsPerSecond]); // Re-attach if pixelsPerSecond changes (might not be strictly necessary but safer)

    // Calculate playhead position
    const playheadPosition = currentTime * pixelsPerSecond;

    // Generate time markers for the ruler
    const timeMarkers = useMemo(() => {
        if (!duration || duration <= 0) return [];
        const markers = [];
        
        // Calculate appropriate interval based on duration
        let interval = 5; // default 5 seconds
        if (duration > 60) interval = 10; // use 10s intervals for videos > 1 min
        if (duration > 300) interval = 30; // use 30s intervals for videos > 5 min
        if (duration > 900) interval = 60; // use 1min intervals for videos > 15 min

        // Calculate number of markers needed
        const numMarkers = Math.ceil(duration / interval);

        for (let i = 0; i <= numMarkers; i++) {
            const time = i * interval;
            if (time > duration) break;
            markers.push({
                time,
                label: formatTimeRuler(time),
                position: time * pixelsPerSecond,
            });
        }

        // Always add the end marker if it's not already included
        const lastMarkerTime = markers[markers.length - 1]?.time ?? 0;
        if (lastMarkerTime < duration) {
            markers.push({
                time: duration,
                label: formatTimeRuler(duration),
                position: duration * pixelsPerSecond,
            });
        }

        return markers;
    }, [duration, pixelsPerSecond]);

    const handleTimelineClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!timelineRef.current || !containerRef.current || !duration) return; // Ensure containerRef exists

        // Use the container's rectangle for calculation
        const containerRect = containerRef.current.getBoundingClientRect();
        const scrollLeft = containerRef.current.scrollLeft;

        // Calculate click position relative to the container + scroll offset
        const clickX = event.clientX - containerRect.left + scrollLeft;
        const seekTime = clickX / pixelsPerSecond;

        onSeek(Math.max(0, Math.min(seekTime, duration)));
    };

    const handleTranscribe = async () => {
        if (!videoUrl || transcribeMutation.status === 'pending') return;

        try {
            // Fetch the video file from the URL
            const response = await fetch(videoUrl);
            const videoBlob = await response.blob();
            const originalVideoArrayBuffer = await videoBlob.arrayBuffer();

            // Process video to 16kHz WAV ArrayBuffer using client-side functions
            const wavAudioArrayBuffer = await extractCompressedAudioFromVideo(originalVideoArrayBuffer);

            // Convert WAV ArrayBuffer to Base64 string
            const wavAudioBase64 = arrayBufferToBase64(wavAudioArrayBuffer);

            // Get transcription using tRPC mutation
            await transcribeMutation.mutateAsync({
                videoBuffer: wavAudioBase64 // Send Base64 encoded WAV audio
            });

        } catch (error) {
            // Errors from mutateAsync are handled by onError in useMutation options
            // This catch is for errors during fetch, blob, or arrayBuffer conversion
            console.error('Error in handleTranscribe before mutation call:', error instanceof Error ? error.message : String(error));
        }
    };

    return (
        <div className="w-full bg-[#252526] overflow-hidden select-none border-t border-gray-700">
            {/* Add transcribe button */}
            <div className="absolute top-2 right-2 z-40">
                <button
                    onClick={handleTranscribe}
                    disabled={transcribeMutation.status === 'pending' || !videoUrl}
                    className={`p-2 rounded-full ${
                        transcribeMutation.status === 'pending' 
                            ? 'bg-gray-600 cursor-not-allowed' 
                            : 'bg-teal-600 hover:bg-teal-500'
                    } transition-colors`}
                    title={transcribeMutation.status === 'pending' ? 'Transcribing...' : 'Transcribe video'}
                >
                    <Mic size={16} className={transcribeMutation.status === 'pending' ? 'animate-pulse' : ''} />
                </button>
            </div>

            {/* Timeline container with horizontal scroll */}
            <div 
                ref={containerRef}
                className="overflow-x-auto overflow-y-hidden h-48"
                style={{ scrollbarWidth: 'thin', scrollbarColor: '#4B5563 transparent' }}
            >
                <div className="relative h-full" style={{ width: `${timelineWidth}px` }}>
                    {/* Container for the full-height playhead */}
                    <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-30">
                        <div 
                            className="absolute top-0 h-full w-0.5 bg-yellow-400"
                            style={{ left: `${playheadPosition}px` }}
                        >
                            <div className="absolute -top-1 bg-yellow-400 p-0.5 rounded-sm">
                                <Play size={10} fill="#facc15" strokeWidth={0} className="-rotate-90"/>
                            </div>
                        </div>
                    </div>

                    {/* Timeline Ruler & Click Area */}
                    <div 
                        ref={timelineRef}
                        className="relative h-8 bg-[#333333] border-b border-gray-600 cursor-pointer"
                        onClick={handleTimelineClick}
                    >
                        {timeMarkers.map((marker) => (
                            <div key={marker.time} className="absolute top-0 h-full flex flex-col items-center" style={{ left: `${marker.position}px` }}>
                                <div className="w-px h-2 bg-gray-500"></div>
                                <span className="text-xs text-gray-400 mt-1 select-none">
                                    {marker.label}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Content Area with Tracks */}
                    <div className="relative w-full flex-grow">
                        {/* Subtitle track */}
                        <div className="absolute top-0 left-0 right-0 h-16 bg-[#2a2a2c] rounded mx-1 border-b border-gray-700 overflow-hidden">
                            {subtitles.map((segment) => {
                                const left = segment.start * pixelsPerSecond;
                                const width = (segment.end - segment.start) * pixelsPerSecond;

                                const handleMouseDownOnSegment = (
                                    event: React.MouseEvent<HTMLDivElement>,
                                    mode: 'resize-start' | 'resize-end'
                                ) => {
                                    event.stopPropagation(); // Prevent timeline click
                                    // console.log(`Mouse down on ${mode} for segment ${segment.id}`);
                                    setActiveDrag({
                                        id: segment.id,
                                        mode,
                                        initialMouseX: event.clientX,
                                        originalStart: segment.start,
                                        originalEnd: segment.end,
                                    });
                                };

                                return (
                                    <div
                                        key={segment.id}
                                        className="absolute top-1/2 -translate-y-1/2 h-12 bg-blue-500/30 border border-blue-400 rounded p-1 flex items-center justify-center group"
                                        style={{
                                            left: `${left}px`,
                                            width: `${Math.max(width, 1)}px`, // Ensure a minimum width for visibility
                                        }}
                                        title={`[${formatTimeRuler(segment.start)} - ${formatTimeRuler(segment.end)}] ${segment.text}`}
                                    >
                                        {/* Resize handle at the start */}
                                        <div
                                            className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-blue-700/50 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onMouseDown={(e) => handleMouseDownOnSegment(e, 'resize-start')}
                                        />
                                        <p className="text-xs text-white truncate select-text pointer-events-none">
                                            {segment.text}
                                        </p>
                                        {/* Resize handle at the end */}
                                        <div
                                            className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-blue-700/50 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onMouseDown={(e) => handleMouseDownOnSegment(e, 'resize-end')}
                                        />
                                    </div>
                                );
                            })}
                        </div>

                        {/* Video Thumbnail Track */}
                        <div className="absolute top-16 left-0 right-0 h-24 bg-[#1a1a1c] rounded mx-1 overflow-hidden">
                            {videoUrl && (
                                <>
                                    <div className="absolute inset-0 opacity-40 bg-gradient-to-b from-transparent to-black z-10"></div>
                                    <VideoThumbnailStrip
                                        videoUrl={videoUrl}
                                        duration={duration}
                                        width={timelineWidth}
                                        height={96}
                                        interval={Math.max(1, Math.floor(duration / 100))} // Adaptive interval based on duration
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
} 