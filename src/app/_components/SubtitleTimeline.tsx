"use client";

import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useSubtitleStore } from '~/store/subtitleStore';
import { Play, ZoomIn, ZoomOut } from 'lucide-react'; // Re-using Play icon for playhead
import { VideoThumbnailStrip } from './VideoThumbnailStrip';

// Helper to format time for the ruler
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
    const timelineRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Zoom state (pixels per second)
    const [pixelsPerSecond, setPixelsPerSecond] = useState(50);
    const timelineWidth = duration * pixelsPerSecond;

    // Min and max zoom levels
    const MIN_ZOOM = 10; // 10px per second
    const MAX_ZOOM = 200; // 200px per second
    
    // Handle zoom with wheel/trackpad
    const handleZoom = (event: WheelEvent) => {
        event.preventDefault();

        // Check if it's a pinch-to-zoom gesture (trackpad)
        const isPinch = event.ctrlKey;
        
        // Get the mouse position relative to the timeline
        const rect = timelineRef.current?.getBoundingClientRect();
        if (!rect) return;
        
        const mouseX = event.clientX - rect.left;
        const scrollLeft = containerRef.current?.scrollLeft ?? 0;
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
            setPixelsPerSecond(newPixelsPerSecond);

            // Adjust scroll position to keep the mouse point at the same time position
            if (containerRef.current) {
                const newScrollLeft = (timeAtMouse * newPixelsPerSecond) - mouseX;
                containerRef.current.scrollLeft = newScrollLeft;
            }
        }
    };

    // Add zoom event listeners
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
    }, [pixelsPerSecond]); // Include pixelsPerSecond in dependencies

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
        if (!timelineRef.current || !duration) return;

        const rect = timelineRef.current.getBoundingClientRect();
        const scrollLeft = containerRef.current?.scrollLeft ?? 0;
        const clickX = event.clientX - rect.left + scrollLeft;
        const seekTime = clickX / pixelsPerSecond;
        
        onSeek(Math.max(0, Math.min(seekTime, duration)));
    };

    return (
        <div className="w-full bg-[#252526] overflow-hidden select-none border-t border-gray-700">
            {/* Timeline container with horizontal scroll */}
            <div 
                ref={containerRef}
                className="overflow-x-auto overflow-y-hidden h-48"
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
                        <div className="absolute top-0 left-0 right-0 h-16 bg-[#2a2a2c] rounded mx-1 border-b border-gray-700">
                            {subtitles.map((sub) => {
                                const left = sub.start * pixelsPerSecond;
                                const width = (sub.end - sub.start) * pixelsPerSecond;
                                return (
                                    <div
                                        key={sub.id}
                                        className="absolute top-2 h-12 bg-teal-600 rounded border border-teal-400 flex items-center px-2 overflow-hidden shadow-md cursor-pointer hover:bg-teal-500 transition-colors"
                                        style={{ left: `${left}px`, width: `${width}px`, minWidth: '10px' }}
                                    >
                                        <span className="text-white text-xs font-medium whitespace-nowrap overflow-hidden text-ellipsis select-none">
                                            {sub.text}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Video Thumbnail Track */}
                        <div className="absolute top-16 left-0 right-0 h-24 bg-[#1a1a1c] rounded mx-1">
                            {videoUrl && (
                                <VideoThumbnailStrip
                                    videoUrl={videoUrl}
                                    duration={duration}
                                    width={timelineWidth}
                                    height={96}
                                    interval={1}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
} 