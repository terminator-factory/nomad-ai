// server/src/services/documentProcessor.js
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const embeddings = require('./embeddings');
const vectorStore = require('./vectorStore');
const fileManager = require('./fileManager');

// Settings for document processing
const CHUNK_SIZE = 1000; // Characters per chunk
const CHUNK_OVERLAP = 200; // Overlap between chunks

/**
 * Calculate MD5 hash of file content
 * @param {string} content - File content
 * @returns {string} - MD5 hash
 */
function calculateContentHash(content) {
  if (!content || typeof content !== 'string') {
    console.warn('Invalid content for hashing');
    return '';
  }
  
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
  if (!text || typeof text !== 'string') {
    console.warn('Invalid text for chunking');
    return [];
  }
  
  const chunks = [];
  let i = 0;
  
  // Handle very short texts
  if (text.length <= chunkSize) {
    return [text];
  }
  
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
  
  // Make sure we have at least one chunk
  if (chunks.length === 0 && text.length > 0) {
    chunks.push(text);
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
    console.log(`Processing document: ${file.name} (${file.size} bytes)`);
    
    // Validate file object
    if (!file || !file.name) {
      return {
        success: false,
        error: 'Invalid file object',
        message: 'File object is missing required properties.'
      };
    }
    
    // Ensure we have content to process
    if (!file.content || typeof file.content !== 'string') {
      console.error(`No content provided for file: ${file.name}`);
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
      fileType: file.type || 'text/plain',
      fileSize: file.size || file.content.length,
      contentHash,
      createdAt: new Date().toISOString(),
      chunkCount: 0
    };
    
    console.log(`Created metadata for document: ${docId} (${file.name})`);
    
    // Split content into chunks
    const chunks = splitIntoChunks(file.content);
    console.log(`Split document into ${chunks.length} chunks`);
    
    // Process each chunk and generate embeddings
    const processedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkId = `${docId}-chunk-${i}`;
      
      try {
        // Generate embedding for chunk
        const embedding = await embeddings.generateEmbedding(chunk);
        
        if (!embedding || !Array.isArray(embedding)) {
          console.error(`Failed to generate embedding for chunk ${i} of ${docId}`);
          continue;
        }
        
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
        
        console.log(`Processed chunk ${i + 1}/${chunks.length} for ${docId}`);
      } catch (chunkError) {
        console.error(`Error processing chunk ${i} of ${docId}:`, chunkError);
      }
    }
    
    // Save document metadata
    metadata.chunkCount = processedChunks.length;
    const saveResult = await fileManager.saveFileMeta(metadata, file.content);
    
    if (!saveResult) {
      console.error(`Failed to save metadata for ${docId}`);
      return {
        success: false,
        error: 'Failed to save document metadata',
        message: 'Could not save document metadata to disk.'
      };
    }
    
    console.log(`Saved metadata for ${docId} with ${processedChunks.length} chunks`);
    
    // Save all chunks to vector store
    let savedChunks = 0;
    for (const chunk of processedChunks) {
      try {
        const added = await vectorStore.addChunk(chunk);
        if (added) savedChunks++;
      } catch (vectorError) {
        console.error(`Error adding chunk to vector store:`, vectorError);
      }
    }
    
    console.log(`Added ${savedChunks}/${processedChunks.length} chunks to vector store for ${docId}`);
    
    // Save vector store changes
    vectorStore.saveAll();
    
    return {
      success: true,
      isDuplicate: false,
      documentId: docId,
      metadata,
      chunks: processedChunks,
      message: `Document processed successfully. Created ${processedChunks.length} chunks.`
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
    console.log(`Searching for chunks relevant to query: "${query}"`);
    
    if (!query || typeof query !== 'string' || query.trim() === '') {
      console.warn('Empty or invalid search query');
      return {
        success: false,
        results: [],
        error: 'Invalid query',
        message: 'Search query is empty or invalid.'
      };
    }
    
    // Generate embedding for query
    const queryEmbedding = await embeddings.generateEmbedding(query);
    
    if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
      console.error('Failed to generate embedding for query');
      return {
        success: false,
        results: [],
        error: 'Embedding generation failed',
        message: 'Could not generate vector embedding for query.'
      };
    }
    
    // Search vector store for similar chunks
    const results = await vectorStore.similaritySearch(queryEmbedding, limit);
    
    console.log(`Found ${results.length} relevant chunks for query`);
    
    // For debugging, show similarity scores
    if (results.length > 0) {
      console.log('Top result similarity:', results[0].score);
    }
    
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
  calculateContentHash,
  splitIntoChunks
};