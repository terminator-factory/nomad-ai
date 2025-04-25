// server/src/services/embeddings.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Local embedding size 
const LOCAL_EMBEDDING_SIZE = 384;

// Cache for embeddings
const embeddingCache = new Map();
const CACHE_FILE_PATH = path.join(__dirname, '../data/embedding_cache.json');

// Ensure cache directory exists
function ensureCacheDirectoryExists() {
  const dir = path.dirname(CACHE_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
}

// Load embedding cache from disk
function loadEmbeddingCache() {
  ensureCacheDirectoryExists();
  
  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      const data = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
      const cache = JSON.parse(data);
      
      // Convert from object back to Map
      Object.entries(cache).forEach(([key, value]) => {
        embeddingCache.set(key, value);
      });
      
      console.log(`Loaded ${embeddingCache.size} embeddings from cache.`);
    }
  } catch (error) {
    console.error('Error loading embedding cache:', error);
    // Continue with empty cache
  }
}

// Save embedding cache to disk
function saveEmbeddingCache() {
  ensureCacheDirectoryExists();
  
  try {
    // Convert Map to object for serialization
    const cacheObj = Object.fromEntries(embeddingCache);
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cacheObj, null, 2), 'utf-8');
    console.log(`Saved ${embeddingCache.size} embeddings to cache.`);
  } catch (error) {
    console.error('Error saving embedding cache:', error);
  }
}

// Load cache on startup
loadEmbeddingCache();
// Set up periodic saving of cache (every 5 minutes)
setInterval(saveEmbeddingCache, 5 * 60 * 1000);

/**
 * Simple tokenizer for generating local embeddings
 * @param {string} text - Input text
 * @returns {Array<number>} - Token IDs
 */
function simpleTokenize(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  
  // Simple word and punctuation tokenization
  const tokens = text
    .toLowerCase()
    .replace(/([.,!?;:()])/g, ' $1 ') // Add spaces around punctuation
    .replace(/\s+/g, ' ')             // Normalize whitespace
    .trim()
    .split(' ')
    .filter(token => token.length > 0);
  
  return tokens;
}

/**
 * Generate a deterministic embedding vector based on text content
 * This is a naive implementation for when external APIs are not available
 * @param {string} text - Text to generate embedding for
 * @returns {Array<number>} - Embedding vector
 */
function generateLocalEmbedding(text) {
  // Use a simple tokenizer
  const tokens = simpleTokenize(text);
  
  // Create a hash from the text to use as a seed
  const hash = crypto.createHash('md5').update(text).digest('hex');
  let hashNum = parseInt(hash.substring(0, 8), 16);
  
  // Initialize embedding vector with values derived from hash
  const embedding = new Array(LOCAL_EMBEDDING_SIZE).fill(0);
  
  // Fill embedding vector based on tokens and hash
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const position = i % LOCAL_EMBEDDING_SIZE;
    
    // Generate a token hash
    const tokenHash = crypto.createHash('md5').update(token).digest('hex');
    const tokenValue = parseInt(tokenHash.substring(0, 8), 16) / 0xffffffff;
    
    // Mix token value into embedding at this position
    embedding[position] = (embedding[position] + tokenValue) % 1;
    
    // Use the hash number to add some randomness but deterministically
    hashNum = (hashNum * 48271) % 0x7fffffff;
    const hashValue = hashNum / 0x7fffffff;
    
    // Mix hash value in as well for more variety
    const mixPosition = (position + 7) % LOCAL_EMBEDDING_SIZE;
    embedding[mixPosition] = (embedding[mixPosition] + hashValue * 0.5) % 1;
  }
  
  // Normalize the embedding to unit length
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    return embedding.map(val => val / magnitude);
  }
  
  // If empty or all zeros, create a random but deterministic embedding
  const seedRandom = new Array(LOCAL_EMBEDDING_SIZE).fill(0).map((_, i) => {
    const h = crypto.createHash('md5').update(`${text}_${i}`).digest('hex');
    return parseInt(h.substring(0, 8), 16) / 0xffffffff;
  });
  
  const seedMagnitude = Math.sqrt(seedRandom.reduce((sum, val) => sum + val * val, 0));
  return seedRandom.map(val => val / seedMagnitude);
}

/**
 * Try to get embeddings from external API (e.g., Ollama)
 * @param {string} text - Text to generate embedding for
 * @returns {Promise<Array<number>|null>} - Embedding vector or null if failed
 */
async function getExternalEmbedding(text) {
  try {
    // Fix: Safely handle undefined LLM_API_URL
    const llmApiUrl = process.env.LLM_API_URL || 'http://localhost:11434/api/generate';
    let llmBaseUrl = llmApiUrl;
    
    // Extract base URL from API URL
    if (llmApiUrl.includes('/api/generate')) {
      llmBaseUrl = llmApiUrl.replace('/api/generate', '');
    }
    
    const embeddingUrl = `${llmBaseUrl}/api/embeddings`;
    
    console.log(`Requesting embedding from ${embeddingUrl}`);
    
    const response = await axios.post(embeddingUrl, {
      model: 'all-MiniLM-L6-v2', // Example model
      prompt: text  // Ollama expects 'prompt' not 'text'
    }, {
      timeout: 10000 // 10 second timeout
    });
    
    // Handle different API response formats
    if (response.data && response.data.embedding) {
      return response.data.embedding;
    } else if (response.data && response.data.embeddings) {
      return response.data.embeddings;
    } else {
      console.warn('Unexpected embedding API response format:', response.data);
      return null;
    }
  } catch (error) {
    console.warn('Error getting external embedding, falling back to local:', error.message);
    return null;
  }
}

/**
 * Generate embedding for text
 * @param {string} text - Text to generate embedding for
 * @returns {Promise<Array<number>>} - Embedding vector
 */
async function generateEmbedding(text) {
  if (!text || typeof text !== 'string') {
    console.warn('Empty or invalid text for embedding, using default embedding');
    // Return a default embedding
    return new Array(LOCAL_EMBEDDING_SIZE).fill(1 / Math.sqrt(LOCAL_EMBEDDING_SIZE));
  }
  
  // Normalize text for caching
  const normalizedText = text.trim().toLowerCase();
  
  // Create a hash of the text for caching
  const textHash = crypto.createHash('md5').update(normalizedText).digest('hex');
  
  // Check cache first
  if (embeddingCache.has(textHash)) {
    return embeddingCache.get(textHash);
  }
  
  // Try external API first, fall back to local implementation
  const embedding = await getExternalEmbedding(normalizedText) || generateLocalEmbedding(normalizedText);
  
  // Cache the result
  embeddingCache.set(textHash, embedding);
  
  // Save to cache occasionally (not every time to reduce I/O)
  if (Math.random() < 0.1) { // 10% chance to save
    saveEmbeddingCache();
  }
  
  return embedding;
}

/**
 * Calculate cosine similarity between two vectors
 * @param {Array<number>} vec1 - First vector
 * @param {Array<number>} vec2 - Second vector
 * @returns {number} - Similarity score (0-1)
 */
function cosineSimilarity(vec1, vec2) {
  if (!Array.isArray(vec1) || !Array.isArray(vec2)) {
    console.error('Invalid vectors for similarity calculation');
    return 0;
  }
  
  // Handle different vector dimensions by using the smaller dimension
  const length = Math.min(vec1.length, vec2.length);
  
  if (length === 0) {
    return 0;
  }
  
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;
  
  for (let i = 0; i < length; i++) {
    const v1 = vec1[i] || 0;
    const v2 = vec2[i] || 0;
    
    dotProduct += v1 * v2;
    mag1 += v1 * v1;
    mag2 += v2 * v2;
  }
  
  mag1 = Math.sqrt(mag1);
  mag2 = Math.sqrt(mag2);
  
  if (mag1 === 0 || mag2 === 0) {
    return 0;
  }
  
  return dotProduct / (mag1 * mag2);
}

module.exports = {
  generateEmbedding,
  cosineSimilarity,
  saveEmbeddingCache,
  loadEmbeddingCache
};