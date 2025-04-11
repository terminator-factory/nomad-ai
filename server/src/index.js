// server/src/index.js
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
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
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

// Socket.IO обработка соединений
io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);
  
  socket.on('chat-message', async (data) => {
    const { sessionId, messages, attachments = [] } = data;
    
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
          socket.emit('message-chunk', chunk);
        },
        onComplete: () => {
          socket.emit('message-complete');
        },
        onError: (error) => {
          console.error('Ошибка при получении ответа от модели:', error);
          socket.emit('error', 'Произошла ошибка при получении ответа от модели');
        }
      });
    } catch (error) {
      console.error('Ошибка при обработке сообщения:', error);
      socket.emit('error', 'Произошла ошибка при обработке сообщения');
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Клиент отключился:', socket.id);
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});