// server/src/index.js
const axios = require('axios');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const llmService = require('./services/llm');
const fileManager = require('./services/fileManager');
const documentProcessor = require('./services/documentProcessor');
const vectorStore = require('./services/vectorStore');
const embeddings = require('./services/embeddings');

// Initialize services to ensure directories exist
fileManager.ensureDirectoriesExist();
embeddings.loadEmbeddingCache();

// Session attachment storage
const sessionAttachments = new Map();

// Setup Express
const app = express();
const server = http.createServer(app);

// CORS configuration for Socket.IO
const io = socketIo(server, {
  cors: {
    origin: '*', // Allow all origins for development - restrict in production
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: '*', // Allow all origins for development - restrict in production
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(morgan('dev'));

// File upload configuration
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename to avoid path traversal issues
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uuidv4()}-${sanitizedName}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// API Routes
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Get RAG knowledge base statistics
app.get('/api/kb/stats', async (req, res) => {
  try {
    // Get vector store stats
    const vectorStats = vectorStore.getStats();
    
    // Get all document metadata
    const documents = await fileManager.getAllFileMeta();
    
    res.status(200).json({
      status: 'ok',
      knowledgeBase: {
        documentCount: documents.length,
        vectorStats
      }
    });
  } catch (error) {
    console.error('Error getting knowledge base stats:', error);
    res.status(500).json({ error: 'Failed to get knowledge base statistics' });
  }
});

// Get all documents in knowledge base
app.get('/api/kb/documents', async (req, res) => {
  try {
    const documents = await fileManager.getAllFileMeta();
    res.status(200).json({ documents });
  } catch (error) {
    console.error('Error getting knowledge base documents:', error);
    res.status(500).json({ error: 'Failed to get knowledge base documents' });
  }
});

// Delete document from knowledge base
app.delete('/api/kb/documents/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const success = await llmService.deleteDocument(documentId);
    
    if (success) {
      res.status(200).json({ status: 'ok', message: 'Document deleted successfully' });
    } else {
      res.status(404).json({ status: 'error', message: 'Document not found or could not be deleted' });
    }
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// Upload files endpoint
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const files = req.files.map(file => {
      // Read file content synchronously - for real production use async methods
      let content = null;
      try {
        // Only read text files
        if (file.mimetype.startsWith('text/') || 
            file.mimetype === 'application/json' || 
            file.mimetype === 'application/xml' ||
            file.originalname.endsWith('.csv') ||
            file.originalname.endsWith('.txt') ||
            file.originalname.endsWith('.md')) {
          content = fs.readFileSync(file.path, 'utf-8');
        }
      } catch (readError) {
        console.error(`Error reading file ${file.originalname}:`, readError);
      }
      
      return {
        id: uuidv4(),
        name: file.originalname,
        path: file.path,
        type: file.mimetype,
        size: file.size,
        content
      };
    });
    
    // Process files for RAG if they have content
    const processingResults = [];
    for (const file of files) {
      if (file.content) {
        try {
          const result = await documentProcessor.processDocument(file);
          processingResults.push({
            fileName: file.name,
            success: result.success,
            isDuplicate: result.isDuplicate,
            documentId: result.documentId
          });
        } catch (procError) {
          console.error(`Error processing file ${file.name}:`, procError);
          processingResults.push({
            fileName: file.name,
            success: false,
            error: procError.message
          });
        }
      }
    }
    
    res.status(200).json({ 
      files,
      processingResults
    });
  } catch (error) {
    console.error('Error handling file upload:', error);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

// Get available models
app.get('/api/models', (req, res) => {
  const models = llmService.getAvailableModels();
  res.status(200).json({ models });
});

// Ollama API proxy for tags
app.get('/api/tags', async (req, res) => {
  try {
    // Extract base URL from environment variable
    const llmApiUrl = process.env.LLM_API_URL || 'http://localhost:11434/api/generate';
    const baseUrl = llmApiUrl.replace('/api/generate', '');
    
    const response = await axios.get(`${baseUrl}/api/tags`);
    res.json(response.data);
  } catch (error) {
    console.error('Error proxying /api/tags:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Search documents endpoint
app.post('/api/search', async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const results = await documentProcessor.searchRelevantChunks(query, limit);
    res.json(results);
  } catch (error) {
    console.error('Error during search:', error);
    res.status(500).json({ error: 'Failed to search documents' });
  }
});

// Direct LLM query endpoint (for testing)
app.post('/api/query', async (req, res) => {
  try {
    const { messages, attachments, model = 'gemma3:4b' } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Valid messages array is required' });
    }
    
    // Format prompt
    const prompt = await llmService.formatPrompt(messages, attachments);
    
    // Send request to LLM API
    const llmResponse = await axios.post(process.env.LLM_API_URL, {
      model,
      prompt,
      stream: false
    });
    
    res.json({
      response: llmResponse.data.response,
      model,
      inputTokens: prompt.length / 4, // Rough estimate
      outputTokens: llmResponse.data.response.length / 4 // Rough estimate
    });
  } catch (error) {
    console.error('Error querying LLM:', error);
    res.status(500).json({ error: 'Failed to query LLM' });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  // State tracking for each connection
  let currentRequestId = null;
  let isGenerating = false;
  let currentSessionId = null;
  
  // Handle chat messages
  socket.on('chat-message', async (data) => {
    const { sessionId, messages, attachments = [], model = 'gemma3:4b' } = data;
    
    // Generate a unique ID for this request
    const requestId = uuidv4();
    
    // If already generating, stop
    if (isGenerating) {
      console.log(`Interrupting previous generation for ${socket.id}`);
      socket.emit('message-complete');
      
      // Short delay for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Set new request ID and session
    currentRequestId = requestId;
    currentSessionId = sessionId;
    isGenerating = true;
    
    console.log(`Starting generation for session ${sessionId}, request ${requestId}, model ${model}`);
    
    // Log attachment info
    console.log(`Received attachments: ${attachments.length}`);
    
    // Save attachments in session
    if (attachments && attachments.length > 0) {
      sessionAttachments.set(sessionId, [...attachments]);
      console.log(`Saved attachments for session ${sessionId}: ${attachments.length} files`);
      
      // Log attachment details
      attachments.forEach((attachment, index) => {
        console.log(`Attachment ${index + 1}:`);
        console.log(`  Name: ${attachment.name}`);
        console.log(`  Type: ${attachment.type || 'unknown'}`);
        console.log(`  Size: ${attachment.size || 'unknown'} bytes`);
        console.log(`  Has content: ${attachment.content ? 'Yes' : 'No'}`);
      });
    } else if (sessionAttachments.has(sessionId)) {
      // Reuse previous attachments from session
      console.log(`Reusing attachments from session ${sessionId}`);
    } else {
      console.log(`No attachments received`);
    }
    
    try {
      // Prepare attachments for processing
      let processedAttachments = attachments;
      
      // If no attachments but we have saved ones, use those
      if (attachments.length === 0 && sessionAttachments.has(sessionId)) {
        processedAttachments = sessionAttachments.get(sessionId);
      }
      
      // Check for duplicate files
      const duplicateChecks = [];
      
      for (const attachment of processedAttachments) {
        if (attachment.content) {
          const contentHash = documentProcessor.calculateContentHash(attachment.content);
          const existingFile = await fileManager.findFileByHash(contentHash);
          
          if (existingFile) {
            duplicateChecks.push({
              fileName: attachment.name,
              isDuplicate: true,
              existingFileName: existingFile.fileName
            });
            
            // Notify client about duplicate
            socket.emit('file-status', {
              fileName: attachment.name,
              status: 'duplicate',
              existingFileName: existingFile.fileName
            });
          } else {
            duplicateChecks.push({
              fileName: attachment.name,
              isDuplicate: false
            });
          }
        }
      }
      
      if (duplicateChecks.some(check => check.isDuplicate)) {
        console.log('Duplicate files detected:', duplicateChecks.filter(c => c.isDuplicate));
      }
      
      // Stream response from model
      await llmService.streamResponse({
        messages,
        attachments: processedAttachments,
        model,
        onChunk: (chunk) => {
          // Only send if this is the current request and still generating
          if (isGenerating && currentRequestId === requestId) {
            socket.emit('message-chunk', chunk);
          }
        },
        onComplete: () => {
          // Only complete if this is the current request
          if (currentRequestId === requestId) {
            console.log(`Completed generation for request ${requestId}`);
            socket.emit('message-complete');
            isGenerating = false;
          }
        },
        onError: (error) => {
          console.error(`Error generating for request ${requestId}:`, error);
          // Only report error if this is the current request
          if (currentRequestId === requestId) {
            socket.emit('error', 'An error occurred while getting a response from the model');
            isGenerating = false;
          }
        }
      });
    } catch (error) {
      console.error(`Error processing request ${requestId}:`, error);
      if (currentRequestId === requestId) {
        socket.emit('error', 'An error occurred while processing the message');
        isGenerating = false;
      }
    }
  });
  
  // Knowledge base operations
  socket.on('kb-get-documents', async () => {
    try {
      const documents = await fileManager.getAllFileMeta();
      socket.emit('kb-documents', { documents });
    } catch (error) {
      console.error('Error getting knowledge base documents:', error);
      socket.emit('kb-error', { message: 'Failed to get knowledge base documents' });
    }
  });
  
  socket.on('kb-delete-document', async (data) => {
    try {
      const { documentId } = data;
      const success = await llmService.deleteDocument(documentId);
      
      if (success) {
        socket.emit('kb-document-deleted', { documentId });
      } else {
        socket.emit('kb-error', { message: 'Document not found or could not be deleted' });
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      socket.emit('kb-error', { message: 'Failed to delete document' });
    }
  });
  
  // Stop generation
  socket.on('stop-generation', (data) => {
    console.log(`Request to stop generation from client ${socket.id} for session ${data?.sessionId || 'not specified'}`);
    
    if (isGenerating) {
      console.log('Stopping generation');
      isGenerating = false;
      socket.emit('message-complete');
    } else {
      console.log('Generation already stopped or not running');
    }
  });
  
  // Change session
  socket.on('change-session', (data) => {
    console.log(`Client ${socket.id} changed session to ${data.sessionId}`);
    
    // If generating for a different session, stop
    if (isGenerating && currentSessionId !== data.sessionId) {
      console.log(`Stopping generation when changing from session ${currentSessionId} to ${data.sessionId}`);
      isGenerating = false;
      socket.emit('message-complete');
    }
    
    // Update current session
    currentSessionId = data.sessionId;
  });
  
  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    isGenerating = false;
    currentRequestId = null;
    currentSessionId = null;
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api`);
  console.log(`Socket.IO available at http://localhost:${PORT}`);
  
  // Print vector store stats on startup
  const vectorStats = vectorStore.getStats();
  console.log('Vector store stats:', vectorStats);
  
  // Check vector store integrity
  vectorStore.checkAndRepairVectorStore();
});