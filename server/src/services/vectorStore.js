// server/src/services/vectorStore.js
const fs = require('fs');
const path = require('path');
const { cosineSimilarity } = require('./embeddings');

// Исправленный путь: используем ../data вместо предыдущего пути
const VECTOR_DB_PATH = path.join(__dirname, '../../data/vector_store.json');
const INDEX_FILE_PATH = path.join(__dirname, '../../data/vector_index.json');

// In-memory storage for vectors and their metadata
let vectorStore = [];
let vectorIndex = {};

// Ensure data directory exists
function ensureDataDirectoryExists() {
  const dir = path.dirname(VECTOR_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
}

// Initialize the vector store by loading from disk
function initializeVectorStore() {
  ensureDataDirectoryExists();
  
  try {
    if (fs.existsSync(VECTOR_DB_PATH)) {
      const data = fs.readFileSync(VECTOR_DB_PATH, 'utf-8');
      vectorStore = JSON.parse(data);
      console.log(`Loaded ${vectorStore.length} vectors from disk.`);
    } else {
      console.log('No vector store found. Creating new one.');
      vectorStore = [];
      saveVectorStore();
    }
    
    if (fs.existsSync(INDEX_FILE_PATH)) {
      const data = fs.readFileSync(INDEX_FILE_PATH, 'utf-8');
      vectorIndex = JSON.parse(data);
      console.log(`Loaded vector index with ${Object.keys(vectorIndex).length} entries.`);
    } else {
      console.log('No vector index found. Creating new one.');
      vectorIndex = {};
      saveVectorIndex();
    }
  } catch (error) {
    console.error('Error initializing vector store:', error);
    // Recover from corrupt files by creating new ones
    vectorStore = [];
    vectorIndex = {};
    saveVectorStore();
    saveVectorIndex();
  }
}

// Save vector store to disk
function saveVectorStore() {
  ensureDataDirectoryExists();
  try {
    fs.writeFileSync(VECTOR_DB_PATH, JSON.stringify(vectorStore), 'utf-8');
    console.log(`Saved ${vectorStore.length} vectors to disk.`);
  } catch (error) {
    console.error("Error saving vector store:", error);
  }
}

// Save vector index to disk
function saveVectorIndex() {
  ensureDataDirectoryExists();
  try {
    fs.writeFileSync(INDEX_FILE_PATH, JSON.stringify(vectorIndex), 'utf-8');
    console.log(`Saved vector index with ${Object.keys(vectorIndex).length} entries to disk.`);
  } catch (error) {
    console.error("Error saving vector index:", error);
  }
}

// Save both vector store and index
async function saveAll() {
  await saveVectorStore();
  await saveVectorIndex();
  
  // Обновляем статистику при сохранении
  console.log(`Сохранено ${vectorStore.length} векторов, ${Object.keys(vectorIndex).length} документов`);
}

// Set up periodic saving
function setupPeriodicSaving(interval = 5 * 60 * 1000) { // Default: 5 minutes
  setInterval(saveAll, interval);
}

/**
 * Add a chunk to the vector store
 * @param {Object} chunk - Chunk object with text, embedding, and metadata
 * @returns {boolean} - Success status
 */
async function addChunk(chunk) {
  try {
    if (!chunk || !chunk.id || !chunk.text || !chunk.embedding || !chunk.metadata) {
      console.error('Invalid chunk data:', chunk);
      return false;
    }
    
    // Check if this chunk already exists using its ID
    const existingIndex = vectorStore.findIndex(v => v.id === chunk.id);
    
    if (existingIndex !== -1) {
      // Update existing chunk
      vectorStore[existingIndex] = chunk;
    } else {
      // Add new chunk
      vectorStore.push(chunk);
    }
    
    // Update the index to map from document ID to vector positions
    if (chunk.metadata && chunk.metadata.id) {
      const docId = chunk.metadata.id;
      
      if (!vectorIndex[docId]) {
        vectorIndex[docId] = [];
      }
      
      // Add this chunk's position to the document's index if not already there
      const chunkPosition = vectorStore.length - 1;
      if (!vectorIndex[docId].includes(chunkPosition)) {
        vectorIndex[docId].push(chunkPosition);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error adding chunk to vector store:', error);
    return false;
  }
}

/**
 * Get all chunks for a document
 * @param {string} documentId - Document ID
 * @returns {Array} - Array of chunks
 */
function getDocumentChunks(documentId) {
  if (!vectorIndex[documentId]) {
    return [];
  }
  
  return vectorIndex[documentId]
    .map(position => {
      if (position >= 0 && position < vectorStore.length) {
        return vectorStore[position];
      }
      return null;
    })
    .filter(chunk => chunk !== null);
}

/**
 * Remove all chunks for a document
 * @param {string} documentId - Document ID
 * @returns {boolean} - Success status
 */
function removeDocument(documentId) {
  try {
    if (!vectorIndex[documentId]) {
      return true; // Document doesn't exist, nothing to do
    }
    
    // Filter out all chunks belonging to this document
    vectorStore = vectorStore.filter(chunk => {
      return !(chunk.metadata && chunk.metadata.id === documentId);
    });
    
    // Remove from index
    delete vectorIndex[documentId];
    
    // Rebuild index since array positions have changed
    rebuildIndex();
    
    // Save changes
    saveAll();
    
    return true;
  } catch (error) {
    console.error('Error removing document from vector store:', error);
    return false;
  }
}

/**
 * Rebuild the index after changes to the vector store
 */
function rebuildIndex() {
  // Clear the index
  vectorIndex = {};
  
  // Rebuild index
  vectorStore.forEach((chunk, index) => {
    if (chunk.metadata && chunk.metadata.id) {
      const docId = chunk.metadata.id;
      
      if (!vectorIndex[docId]) {
        vectorIndex[docId] = [];
      }
      
      vectorIndex[docId].push(index);
    }
  });
}

/**
 * Search for similar chunks
 * @param {Array} queryEmbedding - Query embedding vector
 * @param {number} limit - Maximum number of results to return
 * @param {number} similarityThreshold - Minimum similarity score (0-1)
 * @returns {Array} - Similar chunks with scores
 */
async function similaritySearch(queryEmbedding, limit = 5, similarityThreshold = 0.4) {
  try {
    if (vectorStore.length === 0) {
      console.log("Vector store is empty");
      return [];
    }
    
    if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
      console.error('Invalid query embedding');
      return [];
    }
    
    // Calculate similarity for all vectors
    const scoredChunks = [];
    
    for (let i = 0; i < vectorStore.length; i++) {
      const chunk = vectorStore[i];
      
      if (!chunk.embedding || !Array.isArray(chunk.embedding)) {
        console.error(`Chunk ${chunk.id} missing valid embedding`);
        continue;
      }
      
      try {
        const score = cosineSimilarity(queryEmbedding, chunk.embedding);
        
        if (score >= similarityThreshold) {
          scoredChunks.push({
            ...chunk,
            score
          });
        }
      } catch (error) {
        console.error(`Error calculating similarity for chunk ${chunk.id}:`, error);
      }
    }
    
    // Sort by similarity score (descending)
    scoredChunks.sort((a, b) => b.score - a.score);
    
    // Return top results limited by limit
    return scoredChunks.slice(0, limit);
  } catch (error) {
    console.error('Error performing similarity search:', error);
    return [];
  }
}

/**
 * Get stats about the vector store
 * @returns {Object} - Stats about the vector store
 */
function getStats() {
  const docCount = Object.keys(vectorIndex).length;
  
  return {
    totalVectors: vectorStore.length,
    totalDocuments: docCount,
    averageChunksPerDocument: docCount ? vectorStore.length / docCount : 0
  };
}

// Check vector store integrity and repair if needed
function checkAndRepairVectorStore() {
  console.log('Checking vector store integrity...');
  
  // Check if vectorStore is an array
  if (!Array.isArray(vectorStore)) {
    console.error('Vector store is not an array, resetting');
    vectorStore = [];
  }
  
  // Check if vectorIndex is an object
  if (typeof vectorIndex !== 'object' || vectorIndex === null) {
    console.error('Vector index is not an object, resetting');
    vectorIndex = {};
  }
  
  // Check for valid chunks and embeddings
  let invalidChunks = 0;
  
  for (let i = vectorStore.length - 1; i >= 0; i--) {
    const chunk = vectorStore[i];
    
    // Check if chunk is valid
    if (!chunk || !chunk.id || !chunk.text || !chunk.embedding || !Array.isArray(chunk.embedding)) {
      vectorStore.splice(i, 1);
      invalidChunks++;
    }
  }
  
  if (invalidChunks > 0) {
    console.warn(`Removed ${invalidChunks} invalid chunks from vector store`);
    rebuildIndex();
    saveAll();
  }
  
  console.log('Vector store integrity check complete');
}

// Initialize on module load
initializeVectorStore();
setupPeriodicSaving();
checkAndRepairVectorStore();

module.exports = {
  addChunk,
  getDocumentChunks,
  removeDocument,
  similaritySearch,
  getStats,
  saveAll,
  checkAndRepairVectorStore
};