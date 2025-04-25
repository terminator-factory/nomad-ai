// server/src/services/documentProcessor.js
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const embeddings = require('./embeddings');
const vectorStore = require('./vectorStore');
const fileManager = require('./fileManager');

// Regex patterns for splitting documents
const CHUNK_SIZE = 1000; // Characters per chunk
const CHUNK_OVERLAP = 200; // Overlap between chunks

/**
 * Calculate MD5 hash of file content
 * @param {string} content - File content
 * @returns {string} - MD5 hash
 */
function calculateContentHash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Split text into chunks with overlap
 * @param {string} text - Document text
 * @param {number} chunkSize - Size of each chunk
 * @param {number} overlap - Overlap between chunks
 * @returns {Array<string>} - Array of text chunks
 */
function splitIntoChunks(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let i = 0;
  
  while (i < text.length) {
    // Calculate end position with potential overlap
    const end = Math.min(i + chunkSize, text.length);
    chunks.push(text.slice(i, end));
    
    // Move to next chunk position, accounting for overlap
    i += chunkSize - overlap;
    
    // If we're near the end, avoid tiny chunks
    if (i + chunkSize - overlap >= text.length) {
      break;
    }
  }
  
  return chunks;
}

/**
 * Process a document for RAG
 * @param {Object} file - File object with content
 * @returns {Object} - Processing result including chunks and metadata
 */
async function processDocument(file) {
  try {
    console.log(`Processing document: ${file.name}`);
    
    if (!file.content) {
      return {
        success: false,
        error: 'No content provided',
        message: 'Document has no content to process.'
      };
    }
    
    // Generate a content hash to identify duplicate files
    const contentHash = calculateContentHash(file.content);
    
    // Check if we've already processed this file
    const existingFile = await fileManager.findFileByHash(contentHash);
    if (existingFile) {
      console.log(`Document with same content already exists: ${existingFile.fileName}`);
      return {
        success: true,
        isDuplicate: true,
        existingFile,
        message: 'Document with identical content already exists.'
      };
    }
    
    // Generate document metadata
    const docId = uuidv4();
    const metadata = {
      id: docId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      contentHash,
      createdAt: new Date().toISOString(),
      chunkCount: 0
    };
    
    // Split content into chunks
    const chunks = splitIntoChunks(file.content);
    console.log(`Split document into ${chunks.length} chunks`);
    
    // Process each chunk and generate embeddings
    const processedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkId = `${docId}-chunk-${i}`;
      
      // Generate embedding for chunk
      const embedding = await embeddings.generateEmbedding(chunk);
      
      const chunkMetadata = {
        ...metadata,
        chunkId,
        chunkIndex: i,
        chunkSize: chunk.length,
        chunkTotal: chunks.length
      };
      
      processedChunks.push({
        id: chunkId,
        text: chunk,
        embedding,
        metadata: chunkMetadata
      });
    }
    
    // Save document metadata
    metadata.chunkCount = processedChunks.length;
    await fileManager.saveFileMeta(metadata, file.content);
    
    // Save all chunks to vector store
    for (const chunk of processedChunks) {
      await vectorStore.addChunk(chunk);
    }
    
    return {
      success: true,
      isDuplicate: false,
      documentId: docId,
      metadata,
      chunks: processedChunks,
      message: 'Document processed successfully.'
    };
  } catch (error) {
    console.error('Error processing document:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to process document.'
    };
  }
}

/**
 * Get relevant chunks for a query
 * @param {string} query - Search query
 * @param {number} limit - Maximum number of results
 * @returns {Array} - Matching chunks with similarity scores
 */
async function searchRelevantChunks(query, limit = 5) {
  try {
    console.log(`Searching for chunks relevant to query: ${query}`);
    
    // Generate embedding for query
    const queryEmbedding = await embeddings.generateEmbedding(query);
    
    // Search vector store for similar chunks
    const results = await vectorStore.similaritySearch(queryEmbedding, limit);
    
    return {
      success: true,
      results,
      message: `Found ${results.length} relevant chunks.`
    };
  } catch (error) {
    console.error('Error searching for relevant chunks:', error);
    return {
      success: false,
      results: [],
      error: error.message,
      message: 'Failed to search for relevant chunks.'
    };
  }
}

module.exports = {
  processDocument,
  searchRelevantChunks,
  calculateContentHash
};