// server/src/services/embeddings.js
const axios = require('axios');
const { encode } = require('./tokenizer');
const path = require('path');
const fs = require('fs');

// Fallback to a simple embedding function if external API is not available
// This is not ideal for production but allows the system to work offline
const LOCAL_EMBEDDING_SIZE = 384;

// Cache for embeddings
const embeddingCache = new Map();
const CACHE_FILE_PATH = path.join(__dirname, '../data/embedding_cache.json');

// Ensure cache directory exists
function ensureCacheDirectoryExists() {
  const dir = path.dirname(CACHE_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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
// Set up periodic saving of cache
setInterval(saveEmbeddingCache, 5 * 60 * 1000); // Save every 5 minutes

/**
 * Generate a deterministic embedding vector based on text content
 * This is a naive implementation that doesn't produce semantically meaningful embeddings
 * but is useful as a fallback when external APIs are not available
 * 
 * @param {string} text - Text to generate embedding for
 * @returns {Array<number>} - Embedding vector
 */
function generateLocalEmbedding(text) {
  // Use a tokenizer to handle text consistently
  const tokens = encode(text);
  
  // Initialize embedding vector with zeros
  const embedding = new Array(LOCAL_EMBEDDING_SIZE).fill(0);
  
  // Fill embedding vector based on tokens
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const position = i % LOCAL_EMBEDDING_SIZE;
    
    // Mix token value into embedding at this position
    embedding[position] = (embedding[position] + token / 100) % 1;
  }
  
  // Normalize the embedding
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => val / magnitude);
}

/**
 * Try to get embeddings from external API (e.g. OpenAI, Hugging Face)
 * @param {string} text - Text to generate embedding for
 * @returns {Promise<Array<number>>} - Embedding vector
 */
async function getExternalEmbedding(text) {
  try {
    // Fix: Safely handle undefined LLM_API_URL
    const llmApiUrl = process.env.LLM_API_URL || 'http://localhost:11434/api/generate';
    let llmBaseUrl = llmApiUrl;
    
    // Only try to extract base URL if it includes the target string
    if (llmApiUrl.includes('/api/generate')) {
      llmBaseUrl = llmApiUrl.replace('/api/generate', '');
    }
    
    const embeddingUrl = `${llmBaseUrl}/api/embeddings`;
    
    const response = await axios.post(embeddingUrl, {
      text,
      model: 'all-MiniLM-L6-v2' // Example model
    }, {
      timeout: 5000 // 5 second timeout
    });
    
    if (response.data && response.data.embedding) {
      return response.data.embedding;
    }
    
    throw new Error('Invalid response format from embedding API');
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
  // Normalize text for caching
  const normalizedText = text.trim().toLowerCase();
  
  // Check cache first
  const cacheKey = normalizedText.slice(0, 100); // Use first 100 chars as key
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey);
  }
  
  // Try external API first, fall back to local implementation
  const embedding = await getExternalEmbedding(normalizedText) || generateLocalEmbedding(normalizedText);
  
  // Cache the result
  embeddingCache.set(cacheKey, embedding);
  
  return embedding;
}

/**
 * Calculate cosine similarity between two vectors
 * @param {Array<number>} vec1 - First vector
 * @param {Array<number>} vec2 - Second vector
 * @returns {number} - Similarity score (0-1)
 */
function cosineSimilarity(vec1, vec2) {
  if (vec1.length !== vec2.length) {
    throw new Error('Vectors must have the same dimensions');
  }
  
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    mag1 += vec1[i] * vec1[i];
    mag2 += vec2[i] * vec2[i];
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
  saveEmbeddingCache
};