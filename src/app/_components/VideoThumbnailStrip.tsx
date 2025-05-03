import React, { useEffect, useRef, useState } from 'react';

interface VideoThumbnailStripProps {
    videoUrl: string;
    duration: number;
    width: number;
    height: number;
    interval?: number; // Interval between thumbnails in seconds
}

export function VideoThumbnailStrip({ 
    videoUrl, 
    duration, 
    width, 
    height,
    interval = 1 // Default to 1 second between thumbnails
}: VideoThumbnailStripProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [thumbnails, setThumbnails] = useState<string[]>([]);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (!videoUrl || !duration || !width || !height) return;

        const video = document.createElement('video');
        video.src = videoUrl;
        video.crossOrigin = 'anonymous'; // Enable CORS if needed

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set canvas size to match thumbnail dimensions
        const thumbnailWidth = Math.floor(width / (duration / interval));
        canvas.width = thumbnailWidth;
        canvas.height = height;

        const newThumbnails: string[] = [];

        video.addEventListener('loadedmetadata', async () => {
            // Calculate number of thumbnails needed
            const numThumbnails = Math.ceil(duration / interval);

            for (let i = 0; i < numThumbnails; i++) {
                const time = i * interval;
                if (time > duration) break;

                // Set video to desired time
                video.currentTime = time;

                // Wait for the video to seek to the specified time
                await new Promise<void>((resolve) => {
                    video.onseeked = () => resolve();
                });

                // Draw the video frame to canvas
                ctx.drawImage(video, 0, 0, thumbnailWidth, height);

                // Convert canvas to data URL and store it
                const thumbnail = canvas.toDataURL('image/jpeg', 0.5); // Use JPEG with 50% quality for better performance
                newThumbnails.push(thumbnail);
            }

            setThumbnails(newThumbnails);
        });

        video.load();

        return () => {
            video.remove();
        };
    }, [videoUrl, duration, width, height, interval]);

    return (
        <div 
            className="absolute top-0 left-0 w-full h-full opacity-50"
            style={{ 
                display: 'flex',
                width: `${width}px`,
                height: `${height}px`
            }}
        >
            {thumbnails.map((thumbnail, index) => (
                <div
                    key={index}
                    style={{
                        backgroundImage: `url(${thumbnail})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        width: `${width / (duration / interval)}px`,
                        height: '100%',
                    }}
                />
            ))}
        </div>
    );
} 