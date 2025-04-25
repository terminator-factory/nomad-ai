// server/setup.js
// Скрипт для настройки директорий и создания необходимых файлов для RAG-системы

const fs = require('fs');
const path = require('path');

// Определяем все необходимые директории
const BASE_DIR = path.join(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const directoriesToCreate = [
  DATA_DIR,
  path.join(DATA_DIR, 'content'),    // Для хранения исходного содержимого документов
  path.join(DATA_DIR, 'metadata'),   // Для хранения метаданных документов
  path.join(DATA_DIR, 'uploads'),    // Для временных загрузок файлов
];

// Создаем директории
directoriesToCreate.forEach(dir => {
  if (!fs.existsSync(dir)) {
    console.log(`Создание директории: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  } else {
    console.log(`Директория уже существует: ${dir}`);
  }
});

// Создаем пустые JSON-файлы для хранения данных, если они отсутствуют
const filesToCreate = [
  { path: path.join(DATA_DIR, 'vector_store.json'), content: '[]' },
  { path: path.join(DATA_DIR, 'vector_index.json'), content: '{}' },
  { path: path.join(DATA_DIR, 'hash_index.json'), content: '{}' },
  { path: path.join(DATA_DIR, 'embedding_cache.json'), content: '{}' }
];

filesToCreate.forEach(file => {
  if (!fs.existsSync(file.path)) {
    console.log(`Создание файла: ${file.path}`);
    fs.writeFileSync(file.path, file.content, 'utf8');
  } else {
    console.log(`Файл уже существует: ${file.path}`);
  }
});

// Создаем файл .env с настройками, если он отсутствует
const envFilePath = path.join(BASE_DIR, '..', '.env');
if (!fs.existsSync(envFilePath)) {
  const envContent = `
# URL для LLM API (например, Ollama)
LLM_API_URL=http://localhost:11434/api/generate

# URL для Socket.IO
REACT_APP_SOCKET_URL=http://localhost:3001

# Порт сервера
PORT=3001
`;
  
  console.log(`Создание файла .env с настройками по умолчанию: ${envFilePath}`);
  fs.writeFileSync(envFilePath, envContent, 'utf8');
} else {
  console.log(`Файл .env уже существует: ${envFilePath}`);
}

console.log('\n=== Настройка системы RAG завершена ===');
console.log('Теперь вы можете запустить приложение с помощью команды:');
console.log('npm run dev');

// Проверка наличия Ollama
const { exec } = require('child_process');
exec('ollama --version', (error, stdout, stderr) => {
  if (error) {
    console.log('\nПредупреждение: Ollama не найдена в системе.');
    console.log('Для полноценной работы RAG необходимо установить Ollama:');
    console.log('- Linux/macOS: curl -fsSL https://ollama.com/install.sh | sh');
    console.log('- Windows: Скачайте установщик с https://ollama.com/download');
    console.log('\nПосле установки Ollama запустите её командой:');
    console.log('ollama serve');
    console.log('\nЗатем загрузите модель командой:');
    console.log('ollama pull mistral');
  } else {
    console.log(`\nОбнаружена Ollama: ${stdout.trim()}`);
    console.log('Убедитесь, что Ollama запущена командой: ollama serve');
  }
});