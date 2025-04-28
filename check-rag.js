// check-rag.js
// Скрипт для проверки статуса системы RAG
// Запустите node check-rag.js чтобы увидеть состояние вашей системы
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');

// Функция для проверки существования директории
const checkDirectory = (dir) => {
  try {
    const exists = fs.existsSync(dir);
    const isDir = exists && fs.statSync(dir).isDirectory();
    const items = isDir ? fs.readdirSync(dir).length : 0;
    
    return {
      exists,
      isDir,
      items,
      path: dir
    };
  } catch (error) {
    return {
      exists: false,
      error: error.message,
      path: dir
    };
  }
};

// Функция для проверки наличия Ollama
const checkOllama = () => {
  try {
    // Проверяем, установлен ли Ollama
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'where ollama' : 'which ollama';
    
    try {
      execSync(command, { stdio: 'ignore' });
      console.log('✅ Ollama найден в системе');
      
      // Проверяем, запущен ли Ollama
      const checkRunning = isWindows 
        ? 'tasklist | findstr ollama'
        : 'ps aux | grep ollama | grep -v grep';
      
      try {
        execSync(checkRunning, { stdio: 'ignore' });
        console.log('✅ Ollama запущен');
        
        // Проверяем работоспособность API
        return checkOllamaAPI();
      } catch (error) {
        console.log('❌ Ollama не запущен. Запустите его командой:');
        console.log('   ollama serve');
        return false;
      }
    } catch (error) {
      console.log('❌ Ollama не установлен. Установите по инструкции:');
      console.log('   Windows: https://ollama.com/download/windows');
      console.log('   Linux/Mac: curl -fsSL https://ollama.com/install.sh | sh');
      return false;
    }
  } catch (error) {
    console.log('❌ Ошибка при проверке Ollama:', error.message);
    return false;
  }
};

// Проверка API Ollama
const checkOllamaAPI = async () => {
  try {
    // Получаем URL API из .env файла или используем стандартный
    let apiUrl = 'http://localhost:11434/api';
    
    try {
      const envPath = path.join(__dirname, '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const match = envContent.match(/LLM_API_URL=(.+)/);
        if (match && match[1]) {
          apiUrl = match[1].replace('/generate', '');
        }
      }
    } catch (error) {
      console.error('Ошибка чтения .env файла:', error.message);
    }
    
    // Проверяем, что API работает
    try {
      const response = await axios.get(`${apiUrl}/tags`, { timeout: 3000 });
      console.log('✅ API Ollama доступно и отвечает');
      
      // Проверяем наличие моделей
      if (response.data && response.data.models && response.data.models.length > 0) {
        console.log(`✅ Доступные модели: ${response.data.models.map(m => m.name).join(', ')}`);
        
        // Проверяем наличие рекомендуемых моделей
        const recommendedModels = ['gemma', 'llama', 'mistral'];
        const hasRecommended = response.data.models.some(m => 
          recommendedModels.some(rec => m.name.toLowerCase().includes(rec))
        );
        
        if (hasRecommended) {
          console.log('✅ Найдены рекомендуемые модели');
        } else {
          console.log('⚠️ Рекомендуемые модели (gemma, llama, mistral) не найдены. Загрузите:');
          console.log('   ollama pull gemma3:4b');
        }
      } else {
        console.log('⚠️ Модели не найдены. Загрузите модель:');
        console.log('   ollama pull gemma3:4b');
      }
      return true;
    } catch (error) {
      console.log(`❌ API Ollama недоступно по адресу ${apiUrl}`);
      console.log('   Убедитесь, что Ollama запущен и работает корректно');
      return false;
    }
  } catch (error) {
    console.log('❌ Ошибка при проверке API Ollama:', error.message);
    return false;
  }
};

// Основная функция проверки
async function checkRagSystem() {
  console.log('=== Проверка системы RAG ===');
  console.log('Текущая директория:', __dirname);
  
  // Проверяем директории сервера
  const serverDir = path.join(__dirname, 'server');
  const oldDataDir = path.join(serverDir, 'src', 'data');
  const newDataDir = path.join(serverDir, 'data');
  
  console.log('\n=== Проверка директорий данных ===');
  
  const oldDirInfo = checkDirectory(oldDataDir);
  const newDirInfo = checkDirectory(newDataDir);
  
  if (oldDirInfo.exists && oldDirInfo.isDir) {
    console.log(`⚠️ Обнаружена старая директория данных: ${oldDataDir}`);
    console.log(`   Количество элементов: ${oldDirInfo.items}`);
    
    if (newDirInfo.exists && newDirInfo.isDir) {
      console.log(`✅ Новая директория данных существует: ${newDataDir}`);
      console.log(`   Количество элементов: ${newDirInfo.items}`);
      
      if (oldDirInfo.items > 0 && newDirInfo.items === 0) {
        console.log('⚠️ Данные из старой директории не перенесены в новую!');
        console.log('   Запустите скрипт fix-directories.js для переноса данных:');
        console.log('   node fix-directories.js');
      } else if (oldDirInfo.items > 0 && newDirInfo.items > 0) {
        console.log('✅ Обе директории содержат данные.');
      }
    } else {
      console.log(`❌ Новая директория данных не существует: ${newDataDir}`);
      console.log('   Запустите скрипт fix-directories.js для создания новой структуры:');
      console.log('   node fix-directories.js');
    }
  } else if (newDirInfo.exists && newDirInfo.isDir) {
    console.log(`✅ Директория данных существует: ${newDataDir}`);
    console.log(`   Количество элементов: ${newDirInfo.items}`);
    
    if (newDirInfo.items === 0) {
      console.log('⚠️ Директория данных пуста. Возможно, система RAG не инициализирована.');
    }
  } else {
    console.log(`❌ Ни одна из директорий данных не существует`);
    console.log('   Запустите скрипт fix-directories.js для создания структуры:');
    console.log('   node fix-directories.js');
  }
  
  // Проверка поддиректорий
  console.log('\n=== Проверка поддиректорий данных ===');
  const subdirs = ['content', 'metadata', 'uploads', 'vectors'];
  
  subdirs.forEach(subdir => {
    const path1 = path.join(oldDataDir, subdir);
    const path2 = path.join(newDataDir, subdir);
    
    const info1 = checkDirectory(path1);
    const info2 = checkDirectory(path2);
    
    if (info2.exists && info2.isDir) {
      console.log(`✅ ${subdir}: ${path2} (${info2.items} элементов)`);
    } else if (info1.exists && info1.isDir) {
      console.log(`⚠️ ${subdir}: только в старой директории ${path1} (${info1.items} элементов)`);
    } else {
      console.log(`❌ ${subdir}: не найдена ни в одной директории`);
    }
  });
  
  // Проверка JSON файлов
  console.log('\n=== Проверка JSON файлов ===');
  const jsonFiles = ['vector_store.json', 'vector_index.json', 'hash_index.json', 'embedding_cache.json'];
  
  jsonFiles.forEach(file => {
    const path1 = path.join(oldDataDir, file);
    const path2 = path.join(newDataDir, file);
    
    const exists1 = fs.existsSync(path1);
    const exists2 = fs.existsSync(path2);
    
    if (exists2) {
      try {
        const content = fs.readFileSync(path2, 'utf-8');
        const data = JSON.parse(content);
        const size = Object.keys(data).length;
        console.log(`✅ ${file}: ${path2} (${size} записей)`);
      } catch (error) {
        console.log(`⚠️ ${file}: ${path2} (невозможно прочитать или некорректный JSON)`);
      }
    } else if (exists1) {
      console.log(`⚠️ ${file}: только в старой директории ${path1}`);
    } else {
      console.log(`❌ ${file}: не найден ни в одной директории`);
    }
  });
  
  // Проверка Ollama
  console.log('\n=== Проверка Ollama ===');
  await checkOllama();
  
  console.log('\n=== Итоги ===');
  console.log('Если вы увидели ❌ или ⚠️ в результатах проверки:');
  console.log('1. Запустите скрипт fix-directories.js: node fix-directories.js');
  console.log('2. Убедитесь, что Ollama установлен и запущен');
  console.log('3. Запустите приложение: npm run dev');
}