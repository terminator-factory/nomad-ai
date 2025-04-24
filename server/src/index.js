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
      
      attachments.forEach((attachment, index) => {
        console.log(`Вложение ${index + 1}:`);
        console.log(`  Имя: ${attachment.name}`);
        console.log(`  Тип: ${attachment.type}`);
        console.log(`  Размер: ${attachment.size} байт`);
        console.log(`  Наличие контента: ${attachment.content ? 'Да' : 'Нет'}`);
        if (attachment.content) {
          console.log(`  Длина контента: ${attachment.content.length} символов`);
          console.log(`  Фрагмент контента: ${attachment.content.substring(0, 50)}...`);
        }
        
        // Проверка на CSV файл
        const isCSV = attachment.type === 'text/csv' || 
                     (attachment.name && attachment.name.toLowerCase().endsWith('.csv'));
        console.log(`  Это CSV файл: ${isCSV}`);
      });
    } else if (sessionAttachments.has(sessionId)) {
      // Если в текущем сообщении нет вложений, но в сессии они были ранее, добавляем их к запросу
      const savedAttachments = sessionAttachments.get(sessionId);
      console.log(`Повторно используем вложения из сессии ${sessionId}: ${savedAttachments.length} файлов`);
      
      // Используем сохраненные вложения вместо пустого массива
      processedAttachments = savedAttachments;
    } else {
      console.log(`No attachments received`);
      processedAttachments = [];
    }
    
    try {
      // Проверяем, есть ли вложения для обработки
      let processedAttachments = attachments;
      
      // Если нет текущих вложений, но есть сохраненные, используем их
      if (attachments.length === 0 && sessionAttachments.has(sessionId)) {
        processedAttachments = sessionAttachments.get(sessionId);
      }
      
      // Обработка загруженных файлов (если есть)
      processedAttachments = processedAttachments.map(attachment => {
        // Make sure content is preserved for text files
        if (attachment.content) {
          console.log(`Processing file: ${attachment.name} (${attachment.type}) - Content length: ${attachment.content.length}`);
          
          // Special handling for CSV files to ensure they're properly processed
          if (attachment.type === 'text/csv' || 
              (attachment.name && attachment.name.toLowerCase().endsWith('.csv'))) {
            console.log(`Special processing for CSV file: ${attachment.name}`);
            
            // Make sure content is properly formatted if needed
            // This is just a simple check - you can enhance this based on your needs
            const content = attachment.content.trim();
            
            return {
              ...attachment,
              content,
              type: 'text/csv'  // Ensure type is set correctly
            };
          }
          
          return {
            ...attachment,
            content: attachment.content
          };
        }
        console.log(`Processing file: ${attachment.name} (${attachment.type}) - No content`);
        return attachment;
      });
      
      // Перед вызовом llmService.streamResponse
      console.log(`Отправка запроса к ИИ модели с ${processedAttachments.length} вложениями`);
      
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
});