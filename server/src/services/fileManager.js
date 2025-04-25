// server/src/services/fileManager.js
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// File storage paths
const DATA_DIR = path.join(__dirname, '../data');
const METADATA_DIR = path.join(DATA_DIR, 'metadata');
const CONTENT_DIR = path.join(DATA_DIR, 'content');
const HASH_INDEX_PATH = path.join(DATA_DIR, 'hash_index.json');

// In-memory index of file metadata
let fileMetadata = {};
let hashIndex = {}; // Maps content hash to file ID

// Ensure directories exist
function ensureDirectoriesExist() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(METADATA_DIR)) {
    fs.mkdirSync(METADATA_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(CONTENT_DIR)) {
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
  }
}

// Initialize the file management system
function initialize() {
  ensureDirectoriesExist();
  
  // Load hash index if it exists
  try {
    if (fs.existsSync(HASH_INDEX_PATH)) {
      const data = fs.readFileSync(HASH_INDEX_PATH, 'utf-8');
      hashIndex = JSON.parse(data);
      console.log(`Loaded hash index with ${Object.keys(hashIndex).length} entries.`);
    } else {
      hashIndex = {};
      saveHashIndex();
    }
  } catch (error) {
    console.error('Error loading hash index:', error);
    hashIndex = {};
    saveHashIndex();
  }
  
  // Load metadata for all files
  try {
    if (fs.existsSync(METADATA_DIR)) {
      const files = fs.readdirSync(METADATA_DIR);
      console.log(`Found ${files.length} metadata files to load.`);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(METADATA_DIR, file);
            const data = fs.readFileSync(filePath, 'utf-8');
            const metadata = JSON.parse(data);
            
            // Add to in-memory store
            if (metadata && metadata.id) {
              fileMetadata[metadata.id] = metadata;
            }
          } catch (error) {
            console.error(`Error reading metadata file ${file}:`, error);
          }
        }
      }
      
      console.log(`Loaded metadata for ${Object.keys(fileMetadata).length} files.`);
    }
  } catch (error) {
    console.error('Error loading file metadata:', error);
  }
}

// Save hash index to disk
function saveHashIndex() {
  ensureDirectoriesExist();
  fs.writeFileSync(HASH_INDEX_PATH, JSON.stringify(hashIndex, null, 2), 'utf-8');
}

/**
 * Find a file by content hash
 * @param {string} contentHash - MD5 hash of file content
 * @returns {Object|null} - File metadata or null if not found
 */
async function findFileByHash(contentHash) {
  const fileId = hashIndex[contentHash];
  if (!fileId) {
    return null;
  }
  
  const metadata = fileMetadata[fileId];
  return metadata || null;
}

/**
 * Save file metadata and content
 * @param {Object} metadata - File metadata
 * @param {string} content - File content
 * @returns {boolean} - Success status
 */
async function saveFileMeta(metadata, content) {
  try {
    ensureDirectoriesExist();
    
    // Make sure we have an ID
    if (!metadata.id) {
      metadata.id = uuidv4();
    }
    
    // Add timestamp if not provided
    if (!metadata.createdAt) {
      metadata.createdAt = new Date().toISOString();
    }
    
    // Save metadata
    const metaPath = path.join(METADATA_DIR, `${metadata.id}.json`);
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
    
    // Save content
    const contentPath = path.join(CONTENT_DIR, `${metadata.id}.txt`);
    fs.writeFileSync(contentPath, content, 'utf-8');
    
    // Update in-memory index
    fileMetadata[metadata.id] = metadata;
    
    // Update hash index if we have a content hash
    if (metadata.contentHash) {
      hashIndex[metadata.contentHash] = metadata.id;
      saveHashIndex();
    }
    
    return true;
  } catch (error) {
    console.error('Error saving file metadata:', error);
    return false;
  }
}

/**
 * Get file metadata by ID
 * @param {string} fileId - File ID
 * @returns {Object|null} - File metadata or null if not found
 */
async function getFileMeta(fileId) {
  return fileMetadata[fileId] || null;
}

/**
 * Get file content by ID
 * @param {string} fileId - File ID
 * @returns {string|null} - File content or null if not found
 */
async function getFileContent(fileId) {
  try {
    const contentPath = path.join(CONTENT_DIR, `${fileId}.txt`);
    
    if (!fs.existsSync(contentPath)) {
      return null;
    }
    
    return fs.readFileSync(contentPath, 'utf-8');
  } catch (error) {
    console.error(`Error getting content for file ${fileId}:`, error);
    return null;
  }
}

/**
 * Delete a file by ID
 * @param {string} fileId - File ID
 * @returns {boolean} - Success status
 */
async function deleteFile(fileId) {
  try {
    const metadata = fileMetadata[fileId];
    if (!metadata) {
      return false;
    }
    
    // Remove from hash index
    if (metadata.contentHash && hashIndex[metadata.contentHash] === fileId) {
      delete hashIndex[metadata.contentHash];
      saveHashIndex();
    }
    
    // Delete metadata file
    const metaPath = path.join(METADATA_DIR, `${fileId}.json`);
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
    
    // Delete content file
    const contentPath = path.join(CONTENT_DIR, `${fileId}.txt`);
    if (fs.existsSync(contentPath)) {
      fs.unlinkSync(contentPath);
    }
    
    // Remove from in-memory index
    delete fileMetadata[fileId];
    
    return true;
  } catch (error) {
    console.error(`Error deleting file ${fileId}:`, error);
    return false;
  }
}

/**
 * Get all file metadata
 * @returns {Array} - Array of file metadata objects
 */
async function getAllFileMeta() {
  return Object.values(fileMetadata);
}

/**
 * Search for files by name or content
 * @param {string} query - Search query
 * @returns {Array} - Array of matching file metadata objects
 */
async function searchFiles(query) {
  if (!query || typeof query !== 'string') {
    return [];
  }
  
  query = query.toLowerCase();
  
  // Search in metadata
  const results = Object.values(fileMetadata).filter(file => {
    // Search in file name
    if (file.fileName && file.fileName.toLowerCase().includes(query)) {
      return true;
    }
    
    return false;
  });
  
  return results;
}

// Initialize on module load
initialize();

module.exports = {
  saveFileMeta,
  getFileMeta,
  getFileContent,
  deleteFile,
  getAllFileMeta,
  findFileByHash,
  searchFiles
};