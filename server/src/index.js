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

// Хранилище данных файлов по сессиям
const sessionAttachments = new Map();

// Настройка Express
const app = express();
const server = http.createServer(app);

// Настройка CORS для Socket.IO
const io = socketIo(server, {
  cors: {
    origin: ['http://localhost:9090', 'http://localhost:3000', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: ['http://localhost:9090', 'http://localhost:3000', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));

// Настройка загрузки файлов
const uploadDir = path.join(__dirname, '../uploads');

// Создаем папку для загрузок, если ее нет
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Основные маршруты API
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
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

// Маршрут для загрузки файлов
app.post('/api/upload', upload.array('files'), (req, res) => {
  const files = req.files.map(file => ({
    id: uuidv4(),
    name: file.originalname,
    path: file.path,
    size: file.size,
    type: file.mimetype
  }));
  
  res.status(200).json({ files });
});

// Маршрут для получения списка доступных моделей
app.get('/api/models', (req, res) => {
  const models = llmService.getAvailableModels();
  res.status(200).json({ models });
});

app.post('/api/tags', async (req, res) => {
  try {
    // Извлекаем базовый URL из переменной окружения
    const baseUrl = process.env.LLM_API_URL.replace('/api/generate', '');
    const response = await axios.get(`${baseUrl}/api/tags`);
    res.json(response.data);
  } catch (error) {
    console.error('Error proxying /api/tags:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Маршрут для тестирования поиска похожих документов
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

// Обработка прямого запроса к API для тестирования
app.post('/api/query', async (req, res) => {
  try {
    const { messages, attachments, model = 'gemma3:4b' } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Valid messages array is required' });
    }
    
    // Форматируем запрос
    const prompt = await llmService.formatPrompt(messages, attachments);
    
    // Отправляем запрос к модели напрямую
    const llmResponse = await axios.post(process.env.LLM_API_URL, {
      model,
      prompt,
      stream: false
    });
    
    res.json({
      response: llmResponse.data.response,
      prompt: prompt // include prompt for debugging
    });
  } catch (error) {
    console.error('Error querying LLM:', error);
    res.status(500).json({ error: 'Failed to query LLM' });
  }
});

// Socket.IO обработка соединений
io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);
  
  // Отслеживание состояния для каждого соединения
  let currentRequestId = null;    // ID текущего запроса
  let isGenerating = false;       // Флаг генерации ответа
  let currentSessionId = null;    // ID текущей активной сессии
  
  socket.on('chat-message', async (data) => {
    const { sessionId, messages, attachments = [], model = 'gemma3:4b' } = data;
    
    // Генерируем уникальный ID для этого запроса
    const requestId = uuidv4();
    
    // Если уже идет генерация, отменяем ее
    if (isGenerating) {
      console.log(`Прерывание предыдущей генерации для ${socket.id}`);
      socket.emit('message-complete');
      
      // Небольшая задержка для обработки завершения
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Устанавливаем новый ID запроса и сессии
    currentRequestId = requestId;
    currentSessionId = sessionId;
    isGenerating = true;
    
    console.log(`Начало генерации для сессии ${sessionId}, запрос ${requestId}, модель ${model}`);
    
    // Добавляем детальное логирование вложений
    console.log(`Получено вложений: ${attachments.length}`);
    
    // Сохраняем вложения в сессии
    if (attachments && attachments.length > 0) {
      sessionAttachments.set(sessionId, [...attachments]);
      console.log(`Сохранены вложения для сессии ${sessionId}: ${attachments.length} файлов`);
      
      // Log attachments details
      attachments.forEach((attachment, index) => {
        console.log(`Вложение ${index + 1}:`);
        console.log(`  Имя: ${attachment.name}`);
        console.log(`  Тип: ${attachment.type}`);
        console.log(`  Размер: ${attachment.size} байт`);
        console.log(`  Наличие контента: ${attachment.content ? 'Да' : 'Нет'}`);
      });
    } else if (sessionAttachments.has(sessionId)) {
      // Если в текущем сообщении нет вложений, но в сессии они были ранее
      console.log(`Повторно используем вложения из сессии ${sessionId}`);
    } else {
      console.log(`No attachments received`);
    }
    
    try {
      // Подготавливаем вложения для обработки
      let processedAttachments = attachments;
      
      // Если нет текущих вложений, но есть сохраненные, используем их
      if (attachments.length === 0 && sessionAttachments.has(sessionId)) {
        processedAttachments = sessionAttachments.get(sessionId);
      }
      
      // Check for duplicate files before processing
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
            
            // Notify client that file is duplicate
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
        model: model, // Используем выбранную модель
        onChunk: (chunk) => {
          // Only send chunk if this is the current request and generation is active
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
  
  socket.on('stop-generation', (data) => {
    console.log(`Запрос на остановку генерации от клиента ${socket.id} для сессии ${data?.sessionId || 'не указана'}`);
    
    if (isGenerating) {
      console.log('Остановка генерации');
      isGenerating = false;
      socket.emit('message-complete');
    } else {
      console.log('Генерация уже остановлена или не запущена');
    }
  });
  
  socket.on('change-session', (data) => {
    console.log(`Клиент ${socket.id} сменил сессию на ${data.sessionId}`);
    
    // Если идет генерация для другой сессии, останавливаем ее
    if (isGenerating && currentSessionId !== data.sessionId) {
      console.log(`Остановка генерации при смене сессии с ${currentSessionId} на ${data.sessionId}`);
      isGenerating = false;
      socket.emit('message-complete');
    }
    
    // Обновляем текущую сессию
    currentSessionId = data.sessionId;
  });
  
  socket.on('disconnect', () => {
    console.log(`Клиент отключился: ${socket.id}`);
    // Очищаем состояние при отключении
    isGenerating = false;
    currentRequestId = null;
    currentSessionId = null;
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Интерфейс API доступен по адресу http://localhost:${PORT}/api`);
  console.log(`Интерфейс socket.io доступен по адресу http://localhost:${PORT}`);
  
  // Print vector store stats on startup
  const vectorStats = vectorStore.getStats();
  console.log('Vector store stats:', vectorStats);
});