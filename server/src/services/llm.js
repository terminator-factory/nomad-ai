// server/src/services/llm.js
const axios = require('axios');
const documentProcessor = require('./documentProcessor');
const { countTokens, truncateToTokenCount } = require('./tokenizer');
const fileManager = require('./fileManager');
const vectorStore = require('./vectorStore');

// URL to access the LLM API
const LLM_API_URL = process.env.LLM_API_URL || 'http://localhost:11434/api/generate';

// Token limits and context settings
const MAX_CONTEXT_LENGTH = 6000;
const MAX_RETRIEVED_CHUNKS = 10;
const CHUNK_TOKEN_LIMIT = 500;

// Available models
const AVAILABLE_MODELS = [
  { id: 'llama3', name: 'Ботагөз', description: 'Мудрая и грациозная. Идеальна для глубоких аналитических задач. \nЗнание русского: Базовое, но уверенно поддерживает общение.' },
  { id: 'gemma3:4b', name: 'Жека', description: 'Сильный и умный. Отлично подходит для сложных запросов и высокоэффективных решений. \nЗнание русского: Хорошее, поддерживает точность и логику в ответах.' },
  { id: 'gemma3:1b', name: 'Жемic', description: 'Лёгкая и быстрая. Подходит для повседневных задач и простых вопросов. \nЗнание русского: Базовое, для коротких и чётких ответов.' },
  { id: 'mistral', name: 'Маке', description: 'Мощный и вдумчивый. Отлично решает сложные задачи и генерирует глубокие ответы. \nЗнание русского: Отличное, способен воспринимать и точно интерпретировать сложные запросы.' }
];

// Helper functions for file type detection
function isCSVFile(file) {
  return file.type === 'text/csv' || 
         (file.name && file.name.toLowerCase().endsWith('.csv'));
}

function isJSONFile(file) {
  return file.type === 'application/json' || 
         (file.name && file.name.toLowerCase().endsWith('.json'));
}

// Format file size for display
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/**
 * Get available models
 * @returns {Array} - List of available models
 */
const getAvailableModels = () => {
  return AVAILABLE_MODELS;
};

/**
 * Process attachments and store them in the knowledge base
 * @param {Array} attachments - File attachments
 * @returns {Promise<Array>} - Processing results for each attachment
 */
async function processAttachments(attachments) {
  if (!attachments || attachments.length === 0) {
    return [];
  }
  
  console.log(`Processing ${attachments.length} attachments for RAG`);
  
  const results = [];
  
  for (const file of attachments) {
    if (!file.content || typeof file.content !== 'string') {
      console.warn(`File ${file.name} has no content or invalid content type`);
      results.push({
        fileName: file.name,
        success: false,
        message: 'No content provided for file'
      });
      continue;
    }
    
    console.log(`Processing file: ${file.name} (${formatFileSize(file.size)})`);
    
    try {
      // Process document for RAG
      const processResult = await documentProcessor.processDocument(file);
      
      results.push({
        fileName: file.name,
        success: processResult.success,
        isDuplicate: processResult.isDuplicate,
        documentId: processResult.documentId,
        message: processResult.message
      });
      
      if (processResult.success) {
        if (processResult.isDuplicate) {
          console.log(`File ${file.name} is a duplicate of existing document`);
        } else {
          console.log(`Successfully processed file ${file.name}, created ${processResult.chunks?.length || 0} chunks`);
        }
      } else {
        console.error(`Failed to process file ${file.name}: ${processResult.error}`);
      }
    } catch (error) {
      console.error(`Error processing attachment ${file.name}:`, error);
      results.push({
        fileName: file.name,
        success: false,
        error: error.message,
        message: 'Error processing file'
      });
    }
  }
  
  return results;
}

/**
 * Get file content for direct inclusion in prompt
 * @param {string} documentId - Document ID
 * @returns {Promise<string|null>} - File content or null if not found
 */
async function getFileContentForPrompt(documentId) {
  try {
    // Try to get content directly from file manager
    const content = await fileManager.getFileContent(documentId);
    if (content) {
      return content;
    }
    
    // If not found, try to get metadata and read from disk
    const metadata = await fileManager.getFileMeta(documentId);
    if (!metadata) {
      console.warn(`No metadata found for document: ${documentId}`);
      return null;
    }
    
    // Get file path and read content
    const contentPath = path.join(__dirname, '../../data/content', `${documentId}.txt`);
    
    if (fs.existsSync(contentPath)) {
      return fs.readFileSync(contentPath, 'utf-8');
    }
    
    console.warn(`Content file not found for document: ${documentId}`);
    return null;
  } catch (error) {
    console.error(`Error getting content for document ${documentId}:`, error);
    return null;
  }
}

/**
 * Retrieve relevant context from the knowledge base
 * @param {string} query - Query text
 * @param {string} chatHistory - Formatted chat history
 * @returns {Promise<Object>} - Retrieved context and metadata
 */
async function retrieveContext(query, chatHistory) {
  console.log(`Retrieving context for query: "${query}"`);
  
  // Combine the latest query with chat history for better context
  const searchText = query;
  
  // Search for relevant chunks
  const searchResult = await documentProcessor.searchRelevantChunks(searchText, MAX_RETRIEVED_CHUNKS);
  
  if (!searchResult.success || !searchResult.results || searchResult.results.length === 0) {
    console.log('No relevant context found in knowledge base');
    
    // Even though we didn't find chunks, try to find relevant files by name
    const allDocuments = await fileManager.getAllFileMeta();
    
    // Look for files that might match the query by name
    const relevantFiles = allDocuments.filter(doc => {
      return doc.fileName.toLowerCase().includes(query.toLowerCase()) || 
             (query.toLowerCase().includes(doc.fileName.toLowerCase()));
    });
    
    if (relevantFiles.length > 0) {
      console.log(`Found ${relevantFiles.length} files by name matching query`);
      
      let contextText = '### Relevant Information from Files ###\n\n';
      const sources = [];
      
      // Include content from relevant files
      for (const file of relevantFiles.slice(0, 3)) { // Limit to 3 files
        const content = await getFileContentForPrompt(file.id);
        
        if (content) {
          contextText += `File: ${file.fileName}\n`;
          
          // For CSV files, try to show structured content
          if (file.fileType.includes('csv') || file.fileName.endsWith('.csv')) {
            const lines = content.split('\n');
            const headers = lines[0];
            
            contextText += `Headers: ${headers}\n`;
            contextText += `Sample Content (first 10 rows):\n`;
            
            for (let i = 0; i < Math.min(10, lines.length); i++) {
              contextText += `${lines[i]}\n`;
            }
          } else {
            // For other text files
            contextText += `Content (excerpt):\n${content.substring(0, 3000)}`;
            if (content.length > 3000) {
              contextText += "\n... (content truncated)";
            }
          }
          
          contextText += '\n\n';
          
          sources.push({
            id: file.id,
            fileName: file.fileName,
            similarity: 'Direct match by name'
          });
        }
      }
      
      // Add source summary at the end
      if (sources.length > 0) {
        contextText += '### Sources ###\n';
        sources.forEach((source, index) => {
          contextText += `[${index + 1}] ${source.fileName} (Match: ${source.similarity})\n`;
        });
        
        return {
          hasContext: true,
          contextText,
          sources
        };
      }
    }
    
    return {
      hasContext: false,
      contextText: '',
      sources: []
    };
  }
  
  console.log(`Found ${searchResult.results.length} relevant chunks`);
  
  // Format the retrieved chunks
  let contextText = '### Relevant Information from Knowledge Base ###\n\n';
  const sources = [];
  
  // Track included document IDs to avoid repeating source information
  const includedDocIds = new Set();
  
  for (const result of searchResult.results) {
    // Skip if no text or metadata
    if (!result.text || !result.metadata) {
      continue;
    }
    
    // Add chunk text with truncation to avoid excessive token usage
    const truncatedText = truncateToTokenCount(result.text, CHUNK_TOKEN_LIMIT);
    contextText += `${truncatedText}\n\n`;
    
    // Add source information if not already included
    const docId = result.metadata.id;
    if (docId && !includedDocIds.has(docId)) {
      includedDocIds.add(docId);
      
      sources.push({
        id: docId,
        fileName: result.metadata.fileName || 'Unknown file',
        similarity: result.score ? (result.score * 100).toFixed(1) + '%' : 'Unknown'
      });
    }
  }
  
  // If we have document IDs but not enough context from chunks, 
  // try to include the direct file content
  if (includedDocIds.size > 0 && searchResult.results.length < 3) {
    for (const docId of includedDocIds) {
      const content = await getFileContentForPrompt(docId);
      const metadata = await fileManager.getFileMeta(docId);
      
      if (content && metadata) {
        contextText += `\nAdditional content from file ${metadata.fileName}:\n`;
        
        // For CSV files, show more structured content
        if (metadata.fileType.includes('csv') || metadata.fileName.endsWith('.csv')) {
          const lines = content.split('\n');
          const headers = lines[0];
          
          contextText += `Headers: ${headers}\n`;
          contextText += `Sample Content (first 15 rows):\n`;
          
          for (let i = 0; i < Math.min(15, lines.length); i++) {
            contextText += `${lines[i]}\n`;
          }
        } else {
          // For other text files
          contextText += `Content (excerpt):\n${content.substring(0, 2000)}`;
          if (content.length > 2000) {
            contextText += "\n... (content truncated)";
          }
        }
        
        contextText += '\n\n';
      }
    }
  }
  
  // Add source summary at the end
  if (sources.length > 0) {
    contextText += '### Sources ###\n';
    sources.forEach((source, index) => {
      contextText += `[${index + 1}] ${source.fileName} (Relevance: ${source.similarity})\n`;
    });
  }
  
  return {
    hasContext: true,
    contextText,
    sources
  };
}

/**
 * Format prompt for LLM with RAG context
 * @param {Array} messages - Message history
 * @param {Array} attachments - File attachments
 * @returns {Promise<string>} - Formatted prompt for the model
 */
const formatPrompt = async (messages, attachments = []) => {
  console.log(`Formatting prompt: ${messages.length} messages, ${attachments.length} attachments`);
  
  // Process any new attachments for RAG
  if (attachments && attachments.length > 0) {
    const processResults = await processAttachments(attachments);
    console.log('Attachment processing results:', processResults.map(r => ({
      fileName: r.fileName,
      success: r.success,
      isDuplicate: r.isDuplicate
    })));
  }
  
  // Get the last user message for RAG search
  const lastUserMessage = messages.filter(msg => msg.role === 'user').pop();
  const lastUserContent = lastUserMessage ? lastUserMessage.content.trim() : '';
  
  // Format chat history for context retrieval
  let chatHistoryText = messages.slice(-5).map(msg => {
    if (msg.role === 'user') {
      return `User: ${msg.content}`;
    } else if (msg.role === 'assistant') {
      return `Assistant: ${msg.content}`;
    }
    return '';
  }).join('\n\n');
  
  // Retrieve relevant context using RAG
  let retrievedContext = null;
  let fileContents = '';
  
  if (lastUserContent) {
    retrievedContext = await retrieveContext(lastUserContent, chatHistoryText);
    console.log(`RAG context retrieved: ${retrievedContext.hasContext ? 'Yes' : 'No'}, Sources: ${retrievedContext.sources.length}`);
  }
  
  // Start building the prompt with system instructions
  let prompt = '';
  
  // Basic system instructions
  prompt += `Ты дружелюбный и полезный ассистент. Ты можешь анализировать содержимое файлов и отвечать на вопросы пользователя.\n`;
  
  // Indicate RAG capabilities
  prompt += `У тебя есть доступ к базе знаний документов, которые были загружены пользователями. Когда отвечаешь на вопросы, используй информацию из этой базы знаний, если она релевантна вопросу.\n\n`;
  
  // General instructions
  prompt += `ИНСТРУКЦИИ: Внимательно анализируй содержимое файлов и отвечай на вопросы пользователя, используя полученную информацию. Старайся давать полные и информативные ответы, основываясь на данных из файлов.\n\n`;
  
  // Add RAG context if available
  if (retrievedContext && retrievedContext.hasContext) {
    prompt += retrievedContext.contextText + '\n\n';
    
    // Add specific instructions for using retrieved context
    prompt += `ВАЖНО: Используй информацию выше для ответа на вопрос пользователя. Если информация релевантна, ссылайся на источники в своем ответе, используя номера в квадратных скобках, например [1].\n\n`;
  }
  
  // Add message history
  messages.forEach(msg => {
    if (msg.role === 'user') {
      prompt += `Пользователь: ${msg.content}\n\n`;
    } else if (msg.role === 'assistant') {
      prompt += `Ассистент: ${msg.content}\n\n`;
    } else if (msg.role === 'system') {
      prompt += `Системное сообщение: ${msg.content}\n\n`;
    }
  });
  
  // For CSV files, include direct content
  if (attachments && attachments.length > 0) {
    prompt += `### ЗАГРУЖЕННЫЕ ФАЙЛЫ ###\n`;
    
    for (const file of attachments) {
      const fileName = file.name || 'Unnamed file';
      const fileType = file.type || 'unknown type';
      const fileSize = formatFileSize(file.size);
      
      prompt += `Файл: ${fileName} (${fileType}, ${fileSize})\n`;
      
      // For CSV files, include the content directly
      if (isCSVFile(file) && file.content) {
        try {
          const lines = file.content.split('\n');
          const linesCount = lines.length;
          const firstLine = lines[0] || '';
          const columnCount = firstLine.split(',').length;
          
          // Add file details
          prompt += `CSV файл: ${linesCount} строк, ${columnCount} столбцов\n`;
          prompt += `Заголовки: ${firstLine}\n\n`;
          
          // Include actual content (first 20 lines or all if less than 20)
          prompt += "Содержимое CSV файла (первые строки):\n";
          const linesToShow = Math.min(20, linesCount);
          
          for (let i = 0; i < linesToShow; i++) {
            prompt += `${lines[i]}\n`;
          }
          
          if (linesCount > linesToShow) {
            prompt += `... (и еще ${linesCount - linesToShow} строк)\n`;
          }
          
          prompt += '\n';
          
          // Track that we've included file content
          fileContents = file.content;
        } catch (error) {
          console.error('Error processing CSV content:', error);
        }
      } else if (file.content && file.content.length < 5000) {
        // For other text files that aren't too large, include content
        prompt += "Содержимое файла:\n";
        prompt += file.content.substring(0, 3000) + "\n";
        if (file.content.length > 3000) {
          prompt += "... (содержимое обрезано для краткости)\n";
        }
        prompt += "\n";
        fileContents = file.content;
      }
      
      // Check for duplicate content
      if (file.content) {
        const contentHash = documentProcessor.calculateContentHash(file.content);
        
        // Check if this is a duplicate file
        const existingFile = await fileManager.findFileByHash(contentHash);
        if (existingFile && existingFile.fileName !== file.name) {
          prompt += `Примечание: Этот файл имеет идентичное содержимое с ранее загруженным файлом "${existingFile.fileName}"\n`;
        }
      }
    }
    
    prompt += `### КОНЕЦ СПИСКА ФАЙЛОВ ###\n\n`;
  }
  
  // Special handling for document-specific queries
  if (fileContents && lastUserContent) {
    const lowerQuery = lastUserContent.toLowerCase();
    
    // Check if this is a request for rows or table data
    if ((lowerQuery.includes('строк') || lowerQuery.includes('row') || 
        lowerQuery.includes('таблиц') || lowerQuery.includes('table')) && 
        isCSVFile(attachments[0])) {
      
      prompt += "ВАЖНО: Пользователь запрашивает данные из CSV файла. Используй ТОЛЬКО реальные данные из приведенного выше содержимого файла, не выдумывай информацию. Если запрос касается данных вне предоставленного содержимого, укажи, что у тебя есть только часть данных.\n\n";
    }
  }
  
  // General reminders
  prompt += `НАПОМИНАНИЕ: Дай информативный и точный ответ на вопрос пользователя, опираясь на содержимое загруженных файлов. НИКОГДА не придумывай данные, которых нет в файлах.\n\n`;
  
  // Repeat the current user question
  if (lastUserMessage) {
    prompt += `Вопрос пользователя: "${lastUserMessage.content}"\n\n`;
  }
  
  // Add prefix for model response
  prompt += 'Ассистент: ';
  
  // Ensure we don't exceed token limit
  const estimatedTokens = countTokens(prompt);
  console.log(`Estimated prompt tokens: ${estimatedTokens}`);
  
  if (estimatedTokens > MAX_CONTEXT_LENGTH) {
    console.log(`Warning: Prompt exceeds max token length. Truncating from ${estimatedTokens} tokens to ${MAX_CONTEXT_LENGTH}`);
    prompt = truncateToTokenCount(prompt, MAX_CONTEXT_LENGTH);
  }
  
  return prompt;
};

/**
 * Stream response from LLM
 * @param {Object} options - Request options
 * @param {Array} options.messages - Message history
 * @param {Array} options.attachments - File attachments
 * @param {string} options.model - Model ID to use
 * @param {Function} options.onChunk - Callback for each response chunk
 * @param {Function} options.onComplete - Callback when response completes
 * @param {Function} options.onError - Callback for errors
 */
const streamResponse = async ({ messages, attachments = [], model = 'gemma3:4b', onChunk, onComplete, onError }) => {
  try {
    const prompt = await formatPrompt(messages, attachments);
    
    // Check if selected model exists
    const selectedModel = AVAILABLE_MODELS.find(m => m.id === model) || AVAILABLE_MODELS[0];
    const modelId = selectedModel.id;
    
    console.log(`Using model: ${modelId}`);
    
    const response = await axios({
      method: 'post',
      url: LLM_API_URL,
      data: {
        model: modelId,
        prompt,
        stream: true
      },
      responseType: 'stream',
      timeout: 60000 // 60 second timeout
    });
    
    let buffer = '';
    
    response.data.on('data', (chunk) => {
      const chunkStr = chunk.toString();
      buffer += chunkStr;
      
      // Process buffer line by line
      while (buffer.includes('\n')) {
        const lineEndIndex = buffer.indexOf('\n');
        const line = buffer.substring(0, lineEndIndex);
        buffer = buffer.substring(lineEndIndex + 1);
        
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            
            // Check if there's text in the response
            if (data.response) {
              onChunk(data.response);
            }
            
            // If stream is complete, call complete callback
            if (data.done) {
              onComplete();
            }
          } catch (error) {
            console.error('Error parsing JSON:', error, 'Line:', line);
          }
        }
      }
    });
    
    response.data.on('end', () => {
      // Process any remaining data in buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.response) {
            onChunk(data.response);
          }
        } catch (error) {
          console.error('Error parsing remaining JSON:', error);
        }
      }
      
      onComplete();
    });
    
    response.data.on('error', (error) => {
      console.error('Stream error:', error);
      onError(error);
    });
  } catch (error) {
    console.error('Error sending request to model:', error);
    onError(error);
  }
};

/**
 * Get all knowledge base documents
 * @returns {Promise<Array>} - Array of document metadata
 */
async function getKnowledgeBase() {
  return await fileManager.getAllFileMeta();
}

/**
 * Delete a document from the knowledge base
 * @param {string} documentId - Document ID
 * @returns {Promise<boolean>} - Success status
 */
async function deleteDocument(documentId) {
  console.log(`Deleting document: ${documentId}`);
  
  const vectorRemoved = await vectorStore.removeDocument(documentId);
  console.log(`Vector data removed: ${vectorRemoved}`);
  
  const fileRemoved = await fileManager.deleteFile(documentId);
  console.log(`File data removed: ${fileRemoved}`);
  
  return vectorRemoved && fileRemoved;
}

module.exports = {
  streamResponse,
  formatPrompt,
  getAvailableModels,
  getKnowledgeBase,
  deleteDocument,
  processAttachments
};