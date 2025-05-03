"use client";

import dynamic from 'next/dynamic'

// Dynamically import the component that uses Konva, disabling SSR
const DynamicVideoPlayer = dynamic(
  () => import('./VideoPlayerWithKonva').then((mod) => mod.VideoPlayerWithKonva),
  { 
    ssr: false, 
    // Optional: Add a loading component while the dynamic component loads
    loading: () => <p className="text-white/70">Loading Video Player...</p> 
  }
)

// Keep the export name the same so page.tsx doesn't need changes
export function VideoUpload() {
  return <DynamicVideoPlayer />;
} 