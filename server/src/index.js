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

// Настройка директорий для хранения данных
const dataDir = path.join(__dirname, '../../data'); // Используем корневую директорию /data в контейнере
const uploadDir = path.join(dataDir, 'uploads');
const contentDir = path.join(dataDir, 'content');
const metadataDir = path.join(dataDir, 'metadata');
const vectorsDir = path.join(dataDir, 'vectors');

// Создаем все необходимые директории
[dataDir, uploadDir, contentDir, metadataDir, vectorsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

// Настройка загрузки файлов
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

// Маршрут для проверки директорий
app.get('/api/check-dirs', (req, res) => {
  const dirs = {
    dataDir: { path: dataDir, exists: fs.existsSync(dataDir) },
    uploadDir: { path: uploadDir, exists: fs.existsSync(uploadDir) },
    contentDir: { path: contentDir, exists: fs.existsSync(contentDir) },
    metadataDir: { path: metadataDir, exists: fs.existsSync(metadataDir) },
    vectorsDir: { path: vectorsDir, exists: fs.existsSync(vectorsDir) },
  };
  res.status(200).json(dirs);
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
  
  // Сохраняем информацию о файлах в content и metadata директории
  files.forEach(file => {
    const fileId = uuidv4();
    const contentPath = path.join(contentDir, fileId);
    const metadataPath = path.join(metadataDir, `${fileId}.json`);
    
    // Копируем файл из uploads в content
    fs.copyFileSync(file.path, contentPath);
    
    // Создаем метаданные
    const metadata = {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type,
      uploadedAt: new Date().toISOString(),
      path: contentPath
    };
    
    // Сохраняем метаданные
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    console.log(`File ${file.name} saved as ${fileId} to content and metadata directories`);
  });
  
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
      
      // Проверяем и сохраняем вложения в правильные директории
      if (processedAttachments.length > 0) {
        console.log(`Received attachments: ${processedAttachments.length}`);
        
        // Сохраняем вложения в директории content и metadata
        const savedAttachments = processedAttachments.map((attachment, index) => {
          const fileId = uuidv4();
          const contentPath = path.join(contentDir, fileId);
          const metadataPath = path.join(metadataDir, `${fileId}.json`);
          
          // Если есть содержимое, сохраняем в файл
          if (attachment.content) {
            fs.writeFileSync(contentPath, attachment.content);
            
            // Сохраняем метаданные
            const metadata = {
              id: fileId,
              name: attachment.name,
              size: attachment.size,
              type: attachment.type,
              sessionId: sessionId,
              uploadedAt: new Date().toISOString()
            };
            
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
            
            console.log(`Attachment ${index + 1}:`);
            console.log(`  Name: ${attachment.name}`);
            console.log(`  Type: ${attachment.type}`);
            console.log(`  Size: ${attachment.size} bytes`);
            console.log(`  Has content: Yes`);
            console.log(`  Saved to: ${contentPath}`);
            console.log(`  Metadata: ${metadataPath}`);
          }
          
          return {
            ...attachment,
            id: fileId,
            contentPath,
            metadataPath
          };
        });
        
        console.log(`Saved attachments for session ${sessionId}: ${savedAttachments.length} files`);
      }
      
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
  console.log(`API доступен по адресу http://localhost:${PORT}/api`);
  console.log(`Socket.IO доступен по адресу http://localhost:${PORT}`);
  console.log(`Директории для хранения данных:`);
  console.log(`  Uploads: ${uploadDir}`);
  console.log(`  Content: ${contentDir}`);
  console.log(`  Metadata: ${metadataDir}`);
  console.log(`  Vectors: ${vectorsDir}`);
});