import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Configuration for the Redis connection
// BullMQ uses ioredis by default.
// Ensure your Redis server is running and accessible.
// This default configuration connects to localhost:6379.
// For production, you'll likely use environment variables for these settings.
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // Important for BullMQ
});

// Name for our video export queue
const VIDEO_EXPORT_QUEUE_NAME = 'video-export';

// Create a new BullMQ Queue instance for video exports
// This instance will be used by the "producer" (our tRPC mutation) to add jobs.
export const videoExportQueue = new Queue(VIDEO_EXPORT_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3, // Try a job 3 times if it fails
    backoff: {
      type: 'exponential', // Use exponential backoff for retries
      delay: 1000, // Initial delay of 1 second
    },
    removeOnComplete: { // Keep completed jobs for a certain amount of time or count
      count: 1000, // Keep the last 1000 completed jobs
      age: 24 * 60 * 60, // Keep completed jobs for 24 hours
    },
    removeOnFail: { // Keep failed jobs for a certain amount of time or count
      count: 5000, // Keep the last 5000 failed jobs
      age: 7 * 24 * 60 * 60, // Keep failed jobs for 7 days
    },
  },
});

// You can also export the connection if needed elsewhere, though often it's encapsulated.
// export { connection as redisConnection };

console.log(`BullMQ: Initialized queue '${VIDEO_EXPORT_QUEUE_NAME}'`);

// It's good practice to handle connection errors for Redis
connection.on('connect', () => {
  console.log('BullMQ: Successfully connected to Redis.');
});

connection.on('error', (err) => {
  console.error('BullMQ: Redis connection error:', err);
});

// Graceful shutdown for the queue (optional, but good for cleanup)
// This might be more relevant in the worker or a central app cleanup logic.
// async function gracefulShutdown() {
//   console.log('BullMQ: Closing queue connection...');
//   await videoExportQueue.close();
//   await connection.quit();
//   console.log('BullMQ: Queue connection closed.');
//   process.exit(0);
// }

// process.on('SIGTERM', gracefulShutdown);
// process.on('SIGINT', gracefulShutdown); 