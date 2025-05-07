export const getOpenAIConfig = () => {
    // In Next.js, we need to prefix environment variables with NEXT_PUBLIC_ to use them on the client side
    const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    
    console.log('Available env vars:', {
        NEXT_PUBLIC_OPENAI_API_KEY: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
        // Log the length if it exists, to avoid logging the full key
        keyLength: apiKey?.length
    });
    
    if (!apiKey) {
        throw new Error('OpenAI API key is not configured. Please add NEXT_PUBLIC_OPENAI_API_KEY to your .env.local file.');
    }

    return {
        apiKey,
    };
}; 