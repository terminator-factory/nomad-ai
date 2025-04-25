// server/src/services/llm.js
const axios = require('axios');
const documentProcessor = require('./documentProcessor');
const { countTokens, truncateToTokenCount } = require('./tokenizer');
const fileManager = require('./fileManager');

// URL для доступа к модели в Docker
const LLM_API_URL = process.env.LLM_API_URL || 'http://localhost:11434/api/generate';

// Maximum token context length to maintain
const MAX_CONTEXT_LENGTH = 6000;
const MAX_RETRIEVED_CHUNKS = 10;
const CHUNK_TOKEN_LIMIT = 500;

// Доступные модели
const AVAILABLE_MODELS = [
  { id: 'llama3', name: 'Ботагөз ', description: 'Мудрая и грациозная. Идеальна для глубоких аналитических задач. \nЗнание русского: Базовое, но уверенно поддерживает общение.' },
  { id: 'gemma3:4b', name: 'Жека', description: 'Сильный и умный. Отлично подходит для сложных запросов и высокоэффективных решений. \nЗнание русского: Хорошее, поддерживает точность и логику в ответах.' },
  { id: 'gemma3:1b', name: 'Жемic', description: 'Лёгкая и быстрая. Подходит для повседневных задач и простых вопросов. \nЗнание русского: Базовое, для коротких и чётких ответов.' },
  { id: 'mistral', name: 'Маке', description: 'Мощный и вдумчивый. Отлично решает сложные задачи и генерирует глубокие ответы. \nЗнание русского: Отличное, способен воспринимать и точно интерпретировать сложные запросы.' }
];

// Вспомогательные функции для определения типов файлов
function isCSVFile(file) {
  return file.type === 'text/csv' || 
         (file.name && file.name.toLowerCase().endsWith('.csv'));
}

function isJSONFile(file) {
  return file.type === 'application/json' || 
         (file.name && file.name.toLowerCase().endsWith('.json'));
}

// Форматирование размера файла
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / 1048576).toFixed(1) + ' МБ';
}

/**
 * Получение списка доступных моделей
 * @returns {Array} - Список доступных моделей
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
    if (!file.content) {
      results.push({
        fileName: file.name,
        success: false,
        message: 'No content provided for file'
      });
      continue;
    }
    
    // Process document for RAG
    const processResult = await documentProcessor.processDocument(file);
    results.push({
      fileName: file.name,
      success: processResult.success,
      isDuplicate: processResult.isDuplicate,
      documentId: processResult.documentId,
      message: processResult.message
    });
  }
  
  return results;
}

/**
 * Retrieve relevant context from the knowledge base
 * @param {string} query - Query text
 * @param {string} chatHistory - Formatted chat history
 * @returns {Promise<Object>} - Retrieved context and metadata
 */
async function retrieveContext(query, chatHistory) {
  // Combine the latest query with chat history for better context
  const searchText = query;
  
  // Search for relevant chunks
  const searchResult = await documentProcessor.searchRelevantChunks(searchText, MAX_RETRIEVED_CHUNKS);
  
  if (!searchResult.success || !searchResult.results || searchResult.results.length === 0) {
    return {
      hasContext: false,
      contextText: '',
      sources: []
    };
  }
  
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
 * Форматирует сообщения в формат для запроса к API модели с учетом RAG
 * @param {Array} messages - История сообщений
 * @param {Array} attachments - Прикрепленные файлы
 * @returns {Promise<string>} - Форматированный запрос для модели
 */
const formatPrompt = async (messages, attachments = []) => {
  console.log(`Форматирование запроса: ${messages.length} сообщений, ${attachments.length} вложений`);
  
  // Process any new attachments for RAG
  if (attachments && attachments.length > 0) {
    const processResults = await processAttachments(attachments);
    console.log('Attachment processing results:', processResults);
  }
  
  // Получаем последнее сообщение пользователя для RAG поиска
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
  if (lastUserContent) {
    retrievedContext = await retrieveContext(lastUserContent, chatHistoryText);
    console.log(`RAG context retrieved: ${retrievedContext.hasContext ? 'Yes' : 'No'}, Sources: ${retrievedContext.sources.length}`);
  }
  
  // Форматируем промпт, начиная с системного сообщения
  let prompt = '';
  
  // Базовые системные инструкции
  prompt += `Ты дружелюбный и полезный ассистент. Ты можешь анализировать содержимое файлов и отвечать на вопросы пользователя.\n`;
  
  // Indicate RAG capabilities
  prompt += `У тебя есть доступ к базе знаний документов, которые были загружены пользователями. Когда отвечаешь на вопросы, используй информацию из этой базы знаний, если она релевантна вопросу.\n\n`;
  
  // Общие инструкции вместо специфичных
  prompt += `ИНСТРУКЦИИ: Внимательно анализируй содержимое файлов и отвечай на вопросы пользователя, используя полученную информацию. Старайся давать полные и информативные ответы, основываясь на данных из файлов.\n\n`;
  
  // Add RAG context if available
  if (retrievedContext && retrievedContext.hasContext) {
    prompt += retrievedContext.contextText + '\n\n';
    
    // Add specific instructions for using retrieved context
    prompt += `ВАЖНО: Используй информацию выше для ответа на вопрос пользователя. Если информация релевантна, ссылайся на источники в своем ответе, используя номера в квадратных скобках, например [1].\n\n`;
  }
  
  // Добавляем историю сообщений
  messages.forEach(msg => {
    if (msg.role === 'user') {
      prompt += `Пользователь: ${msg.content}\n\n`;
    } else if (msg.role === 'assistant') {
      prompt += `Ассистент: ${msg.content}\n\n`;
    } else if (msg.role === 'system') {
      prompt += `Системное сообщение: ${msg.content}\n\n`;
    }
  });
  
  // Добавляем информацию о новых файлах
  if (attachments && attachments.length > 0) {
    prompt += `### НОВЫЕ ЗАГРУЖЕННЫЕ ФАЙЛЫ ###\n`;
    
    attachments.forEach(file => {
      const fileName = file.name || 'Unnamed file';
      const fileType = file.type || 'unknown type';
      const fileSize = formatFileSize(file.size);
      
      prompt += `Файл: ${fileName} (${fileType}, ${fileSize})\n`;
      
      // Check for duplicate content
      const contentHash = documentProcessor.calculateContentHash(file.content);
      
      // Add note if duplicate file
      if (contentHash) {
        fileManager.findFileByHash(contentHash)
          .then(existingFile => {
            if (existingFile && existingFile.fileName !== file.name) {
              prompt += `Примечание: Этот файл имеет идентичное содержимое с ранее загруженным файлом "${existingFile.fileName}"\n`;
            }
          })
          .catch(err => console.error('Error checking for duplicate file:', err));
      }
      
      // Обработка CSV файлов (для прямых вопросов о файлах)
      if (isCSVFile(file) && file.content) {
        const linesCount = file.content.split('\n').length;
        const firstLine = file.content.split('\n')[0] || '';
        const columnsCount = firstLine.split(',').length;
        
        // Добавляем базовую информацию о CSV
        prompt += `CSV файл: ${linesCount} строк, ${columnsCount} столбцов\n`;
      }
    });
    
    prompt += `### КОНЕЦ СПИСКА ФАЙЛОВ ###\n\n`;
  }
  
  // Общие напоминания без жестких инструкций
  prompt += `НАПОМИНАНИЕ: Дай информативный и точный ответ на вопрос пользователя, опираясь на содержимое загруженных файлов.\n\n`;
  
  // Повторяем актуальный вопрос пользователя
  if (lastUserMessage) {
    prompt += `Вопрос пользователя: "${lastUserMessage.content}"\n\n`;
  }
  
  // Добавляем префикс для ответа модели
  prompt += 'Ассистент: ';
  
  // Ensure we don't exceed token limit
  if (countTokens(prompt) > MAX_CONTEXT_LENGTH) {
    console.log(`Warning: Prompt exceeds max token length (${countTokens(prompt)} tokens). Truncating...`);
    prompt = truncateToTokenCount(prompt, MAX_CONTEXT_LENGTH);
  }
  
  // Логирование итогового запроса
  console.log(`Итоговый запрос сформирован, длина: ${prompt.length} символов, примерно ${countTokens(prompt)} токенов`);
  console.log(`Первые 200 символов запроса: ${prompt.substring(0, 200)}...`);
  
  return prompt;
};

/**
 * Отправляет запрос к API модели с потоковым ответом
 * @param {Object} options - Параметры запроса
 * @param {Array} options.messages - История сообщений
 * @param {Array} options.attachments - Прикрепленные файлы
 * @param {string} options.model - ID модели для использования
 * @param {Function} options.onChunk - Колбэк для каждого фрагмента ответа
 * @param {Function} options.onComplete - Колбэк при завершении ответа
 * @param {Function} options.onError - Колбэк при ошибке
 */
const streamResponse = async ({ messages, attachments = [], model = 'gemma3:4b', onChunk, onComplete, onError }) => {
  try {
    const prompt = await formatPrompt(messages, attachments);
    
    // Проверяем, существует ли выбранная модель
    const selectedModel = AVAILABLE_MODELS.find(m => m.id === model) || AVAILABLE_MODELS[0];
    const modelId = selectedModel.id;
    
    console.log(`Используется модель: ${modelId}`);
    
    const response = await axios({
      method: 'post',
      url: LLM_API_URL,
      data: {
        model: modelId,
        prompt,
        stream: true
      },
      responseType: 'stream'
    });
    
    let buffer = '';
    
    response.data.on('data', (chunk) => {
      const chunkStr = chunk.toString();
      buffer += chunkStr;
      
      // Обрабатываем буфер построчно
      while (buffer.includes('\n')) {
        const lineEndIndex = buffer.indexOf('\n');
        const line = buffer.substring(0, lineEndIndex);
        buffer = buffer.substring(lineEndIndex + 1);
        
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            
            // Проверяем, есть ли текст в ответе
            if (data.response) {
              onChunk(data.response);
            }
            
            // Если поток завершен, вызываем колбэк завершения
            if (data.done) {
              onComplete();
            }
          } catch (error) {
            console.error('Ошибка при обработке JSON:', error);
          }
        }
      }
    });
    
    response.data.on('end', () => {
      // Если в буфере еще остались данные
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.response) {
            onChunk(data.response);
          }
        } catch (error) {
          console.error('Ошибка при обработке оставшегося JSON:', error);
        }
      }
      
      onComplete();
    });
    
    response.data.on('error', (error) => {
      console.error('Ошибка в потоке данных:', error);
      onError(error);
    });
  } catch (error) {
    console.error('Ошибка при отправке запроса к модели:', error);
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
  const vectorRemoved = await require('./vectorStore').removeDocument(documentId);
  const fileRemoved = await fileManager.deleteFile(documentId);
  
  return vectorRemoved && fileRemoved;
}

module.exports = {
  streamResponse,
  getAvailableModels,
  getKnowledgeBase,
  deleteDocument
};