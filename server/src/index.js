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

// Настройка Express
const app = express();
const server = http.createServer(app);

// Настройка CORS для Socket.IO
const io = socketIo(server, {
  cors: {
    origin: ['http://10.15.123.137:9090', 'http://10.15.123.137:3000', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: ['http://10.15.123.137:9090', 'http://10.15.123.137:3000', 'http://localhost:3000'],
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
    const { sessionId, messages, attachments = [] } = data;
    
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
    
    console.log(`Начало генерации для сессии ${sessionId}, запрос ${requestId}`);
    
    try {
      // Обработка загруженных файлов (если есть)
      const processedAttachments = attachments.map(attachment => {
        if (attachment.content) {
          return {
            ...attachment,
            content: attachment.content
          };
        }
        return attachment;
      });
      
      // Стримим ответ от модели
      await llmService.streamResponse({
        messages,
        attachments: processedAttachments,
        onChunk: (chunk) => {
          // Отправляем чанк только если это текущий запрос и генерация активна
          if (isGenerating && currentRequestId === requestId) {
            socket.emit('message-chunk', chunk);
          }
        },
        onComplete: () => {
          // Завершаем только если это текущий запрос
          if (currentRequestId === requestId) {
            console.log(`Завершение генерации для запроса ${requestId}`);
            socket.emit('message-complete');
            isGenerating = false;
          }
        },
        onError: (error) => {
          console.error(`Ошибка при генерации для запроса ${requestId}:`, error);
          // Сообщаем об ошибке только если это текущий запрос
          if (currentRequestId === requestId) {
            socket.emit('error', 'Произошла ошибка при получении ответа от модели');
            isGenerating = false;
          }
        }
      });
    } catch (error) {
      console.error(`Ошибка при обработке запроса ${requestId}:`, error);
      if (currentRequestId === requestId) {
        socket.emit('error', 'Произошла ошибка при обработке сообщения');
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