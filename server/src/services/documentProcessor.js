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
 * Process a CSV file for better content retrieval
 * @param {string} content - CSV content
 * @returns {Object} - Processed CSV information
 */
function processCSVContent(content) {
  if (!content || typeof content !== 'string') {
    return {
      success: false,
      error: 'Invalid content',
      rowCount: 0,
      columnCount: 0,
      headers: [],
      sample: []
    };
  }

  try {
    // Split into lines and filter out empty lines
    const lines = content.split('\n').filter(line => line.trim().length > 0);

    if (lines.length === 0) {
      return {
        success: false,
        error: 'Empty CSV',
        rowCount: 0,
        columnCount: 0,
        headers: [],
        sample: []
      };
    }

    // Get headers from first line
    const headers = parseCSVLine(lines[0]);

    // Parse a sample of data rows (up to 20)
    const sampleSize = Math.min(20, lines.length - 1);
    const sample = [];

    for (let i = 1; i <= sampleSize; i++) {
      if (i < lines.length) {
        const parsedLine = parseCSVLine(lines[i]);
        sample.push(parsedLine);
      }
    }

    return {
      success: true,
      rowCount: lines.length - 1, // Exclude header row
      columnCount: headers.length,
      headers,
      sample,
      content: content // Keep original content for reference
    };
  } catch (error) {
    console.error('Error processing CSV content:', error);
    return {
      success: false,
      error: error.message,
      rowCount: 0,
      columnCount: 0,
      headers: [],
      sample: []
    };
  }
}

/**
 * Parse a CSV line, handling quoted fields properly
 * @param {string} line - CSV line to parse
 * @returns {Array<string>} - Array of field values
 */
function parseCSVLine(line) {
  if (!line) return [];

  const result = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = i < line.length - 1 ? line[i + 1] : null;

    if (char === '"' && !inQuotes) {
      // Start of quoted field
      inQuotes = true;
    } else if (char === '"' && inQuotes) {
      if (nextChar === '"') {
        // Escaped quote inside quoted field
        currentField += '"';
        i++; // Skip the next quote
      } else {
        // End of quoted field
        inQuotes = false;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(currentField);
      currentField = '';
    } else {
      // Regular character
      currentField += char;
    }
  }

  // Add the last field
  result.push(currentField);

  return result;
}

/**
 * Split text into chunks with special handling for CSV
 * @param {string} text - Document text
 * @param {string} fileType - File type 
 * @param {number} chunkSize - Size of each chunk
 * @param {number} overlap - Overlap between chunks
 * @returns {Array<string>} - Array of text chunks
 */
function splitIntoChunksWithFileType(text, fileType, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text || typeof text !== 'string') {
    console.warn('Invalid text for chunking');
    return [];
  }

  // For CSV files, we'll use a different chunking strategy
  if (fileType && (fileType.includes('csv') || fileType.endsWith('.csv'))) {
    return splitCSVIntoChunks(text, chunkSize, overlap);
  }

  // Default chunking for other file types
  return splitIntoChunks(text, chunkSize, overlap);
}

/**
 * Split CSV into meaningful chunks based on rows
 * @param {string} csvText - CSV content
 * @param {number} chunkSize - Target chunk size
 * @param {number} overlap - Chunk overlap
 * @returns {Array<string>} - Array of chunks
 */
function splitCSVIntoChunks(csvText, chunkSize, overlap) {
  try {
    // Split into lines
    const lines = csvText.split('\n').filter(line => line.trim() !== '');

    if (lines.length <= 1) {
      // Just header or empty file
      return [csvText];
    }

    const headers = lines[0];
    const dataRows = lines.slice(1);

    // Calculate how many rows to include per chunk
    const avgRowLength = dataRows.reduce((sum, row) => sum + row.length, 0) / dataRows.length;
    const rowsPerChunk = Math.max(1, Math.floor(chunkSize / avgRowLength));
    const rowsOverlap = Math.max(1, Math.floor(overlap / avgRowLength));

    const chunks = [];
    let i = 0;

    while (i < dataRows.length) {
      // Calculate end position
      const end = Math.min(i + rowsPerChunk, dataRows.length);

      // Create chunk with headers + selected rows
      const chunkRows = [headers, ...dataRows.slice(i, end)];
      chunks.push(chunkRows.join('\n'));

      // Move to next chunk position, accounting for overlap
      i += rowsPerChunk - rowsOverlap;

      // If we're near the end, avoid tiny chunks
      if (i + rowsPerChunk - rowsOverlap >= dataRows.length) {
        break;
      }
    }

    return chunks;
  } catch (error) {
    console.error('Error splitting CSV into chunks:', error);

    // Fall back to standard chunking
    return splitIntoChunks(csvText, chunkSize, overlap);
  }
}

// Update the processDocument function to use the new CSV-aware chunking
const originalProcessDocument = processDocument;

async function processDocument(file, forceProcess = false) {
  try {
    console.log(`Processing document: ${file.name} (${file.size} bytes)`);

    // Check if this is a CSV file
    const isCSV = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv');

    if (isCSV && file.content) {
      console.log(`Processing CSV file: ${file.name}`);

      // Process CSV content for better understanding
      const csvInfo = processCSVContent(file.content);

      if (csvInfo.success) {
        console.log(`CSV file analyzed: ${csvInfo.rowCount} rows, ${csvInfo.columnCount} columns`);

        // Add CSV info to file object for better context later
        file.csvInfo = csvInfo;
      }
    }

    // Handle the rest of document processing using the improved chunking method
    const fileType = file.type || (file.name ? file.name.split('.').pop() : '');

    // Original validation and duplicate checking
    if (!file || !file.name) {
      return {
        success: false,
        error: 'Invalid file object',
        message: 'File object is missing required properties.'
      };
    }

    if (!file.content || typeof file.content !== 'string') {
      console.error(`No content provided for file: ${file.name}`);
      return {
        success: false,
        error: 'No content provided',
        message: 'Document has no content to process.'
      };
    }

    // Generate content hash
    const contentHash = calculateContentHash(file.content);

    // Check if we've already processed this file
    const existingFile = await fileManager.findFileByHash(contentHash);
    if (existingFile && !forceProcess) {
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
      chunkCount: 0,
      isCSV: isCSV
    };

    // If it's a CSV, add the CSV info to metadata
    if (isCSV && file.csvInfo) {
      metadata.csvInfo = {
        rowCount: file.csvInfo.rowCount,
        columnCount: file.csvInfo.columnCount,
        headers: file.csvInfo.headers.join(',')
      };
    }

    console.log(`Created metadata for document: ${docId} (${file.name})`);

    // Split content into chunks with awareness of file type
    const chunks = splitIntoChunksWithFileType(file.content, fileType);
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
        if (added) {
          savedChunks++;
          // Принудительно сохраняем после каждого 10-го чанка
          if (savedChunks % 10 === 0) {
            await vectorStore.saveAll();
            console.log(`Сохранено ${savedChunks} чанков`);
          }
        }
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