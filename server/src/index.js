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
const vectorStore = require('./services/vectorStore');

// Настройка Express
const app = express();
const server = http.createServer(app);

// Получаем разрешенные источники из переменных окружения или используем стандартные
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000', 'http://localhost:9090'];

// Более гибкая настройка CORS для Socket.IO
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware с теми же разрешенными источниками
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));

// Настройка директорий для хранения данных
// ВАЖНО: используем server/data вместо src/data для согласованности с другими модулями
const dataDir = path.join(__dirname, '../data'); 
const uploadDir = path.join(dataDir, 'uploads');

// Создаем директорию для загрузок если она не существует
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log(`Created upload directory: ${uploadDir}`);
}

// Настройка загрузки файлов с помощью multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Убедимся, что fileManager инициализирован
fileManager.ensureDirectoriesExist();

// API маршруты
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Получить список доступных моделей
app.get('/api/models', (req, res) => {
  const models = llmService.getAvailableModels();
  res.status(200).json({ models });
});

// API для базы знаний (Knowledge Base)
app.get('/api/models', async (req, res) => {
  try {
    const models = await llmService.getAvailableModels();
    res.status(200).json({ models });
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(200).json({ models: [
      { id: 'gemma3:4b', name: 'Жека', description: 'Модель по умолчанию' }
    ]});
  }
});

app.get('/api/kb/stats', async (req, res) => {
  try {
    const vectorStats = vectorStore.getStats();
    res.status(200).json({ 
      knowledgeBase: { 
        vectorStats
      }
    });
  } catch (error) {
    console.error('Error getting KB stats:', error);
    res.status(500).json({ error: 'Failed to retrieve knowledge base statistics' });
  }
});

app.delete('/api/kb/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const success = await llmService.deleteDocument(id);
    
    if (success) {
      res.status(200).json({ success: true });
      // Также уведомляем всех подключенных клиентов
      io.emit('kb-document-deleted', { documentId: id });
    } else {
      res.status(404).json({ error: 'Document not found or could not be deleted' });
    }
  } catch (error) {
    console.error('Error deleting KB document:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// Socket.IO обработка соединений
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  // Отслеживание состояния для каждого соединения
  let currentRequestId = null;    // ID текущего запроса
  let isGenerating = false;       // Флаг генерации ответа
  let currentSessionId = null;    // ID текущей активной сессии
  
  // Запрос на получение документов базы знаний
  socket.on('kb-get-documents', async () => {
    try {
      const documents = await fileManager.getAllFileMeta();
      socket.emit('kb-documents', { documents });
    } catch (error) {
      console.error('Error getting KB documents:', error);
      socket.emit('kb-error', { message: 'Failed to retrieve knowledge base documents' });
    }
  });
  
  // Запрос на удаление документа из базы знаний
  socket.on('kb-delete-document', async (data) => {
    try {
      const { documentId } = data;
      const success = await llmService.deleteDocument(documentId);
      
      if (success) {
        socket.emit('kb-document-deleted', { documentId });
        // Также уведомляем всех остальных клиентов
        socket.broadcast.emit('kb-document-deleted', { documentId });
      } else {
        socket.emit('kb-error', { message: 'Document not found or could not be deleted' });
      }
    } catch (error) {
      console.error('Error deleting KB document:', error);
      socket.emit('kb-error', { message: 'Failed to delete document' });
    }
  });
  
  socket.on('chat-message', async (data) => {
    const { sessionId, messages, attachments = [], model = 'gemma3:4b' } = data;
    
    // Генерируем уникальный ID для этого запроса
    const requestId = uuidv4();
    
    // Если уже идет генерация, отменяем ее
    if (isGenerating) {
      console.log(`Interrupting previous generation for ${socket.id}`);
      socket.emit('message-complete');
      
      // Небольшая задержка для обработки завершения
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Устанавливаем новый ID запроса и сессии
    currentRequestId = requestId;
    currentSessionId = sessionId;
    isGenerating = true;
    
    console.log(`Starting generation for session ${sessionId}, request ${requestId}, model ${model}`);
    
    try {
      // Обработка загруженных файлов (если есть)
      console.log(`Received attachments: ${attachments.length}`);
      
      const processedAttachments = attachments.map(attachment => {
        console.log(`Attachment ${attachment.name}: ${attachment.size} bytes, has content: ${!!attachment.content}`);
        return attachment;
      });
      
      // Стримим ответ от модели
      await llmService.streamResponse({
        messages,
        attachments: processedAttachments,
        model,
        onChunk: (chunk) => {
          // Отправляем чанк только если это текущий запрос и генерация активна
          if (isGenerating && currentRequestId === requestId) {
            socket.emit('message-chunk', chunk);
          }
        },
        onComplete: () => {
          // Завершаем только если это текущий запрос
          if (currentRequestId === requestId) {
            console.log(`Completed generation for request ${requestId}`);
            socket.emit('message-complete');
            isGenerating = false;
          }
        },
        onError: (error) => {
          console.error(`Error during generation for request ${requestId}:`, error);
          // Сообщаем об ошибке только если это текущий запрос
          if (currentRequestId === requestId) {
            socket.emit('error', 'Error getting response from model');
            isGenerating = false;
          }
        }
      });
    } catch (error) {
      console.error(`Error processing request ${requestId}:`, error);
      if (currentRequestId === requestId) {
        socket.emit('error', 'Error processing message');
        isGenerating = false;
      }
    }
  });
  
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
  
  socket.on('change-session', (data) => {
    console.log(`Client ${socket.id} changed session to ${data.sessionId}`);
    
    // Если идет генерация для другой сессии, останавливаем ее
    if (isGenerating && currentSessionId !== data.sessionId) {
      console.log(`Stopping generation when changing session from ${currentSessionId} to ${data.sessionId}`);
      isGenerating = false;
      socket.emit('message-complete');
    }
    
    // Обновляем текущую сессию
    currentSessionId = data.sessionId;
  });
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    // Очищаем состояние при отключении
    isGenerating = false;
    currentRequestId = null;
    currentSessionId = null;
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api`);
  console.log(`Socket.IO available at http://localhost:${PORT}`);
  
  // Вывод статистики векторного хранилища
  const vectorStats = vectorStore.getStats();
  console.log(`Vector store stats:`, vectorStats);
});