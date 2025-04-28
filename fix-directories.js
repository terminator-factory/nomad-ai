// fix-directories.js
// Скрипт для исправления путей директорий в проекте RAG
const fs = require('fs');
const path = require('path');

// Определяем корректные пути
const rootDir = path.resolve(__dirname); // Корневая директория проекта
const oldDataDir = path.join(rootDir, 'server', 'src', 'data');
const newDataDir = path.join(rootDir, 'server', 'data');

console.log('Проверка и исправление директорий данных...');
console.log(`Корневая директория: ${rootDir}`);
console.log(`Старая директория данных: ${oldDataDir}`);
console.log(`Новая директория данных: ${newDataDir}`);

// Создаем структуру директорий в новом месте если их нет
const dataSubDirs = ['content', 'metadata', 'uploads', 'vectors'];
[newDataDir, ...dataSubDirs.map(dir => path.join(newDataDir, dir))].forEach(dir => {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Создана директория: ${dir}`);
    } catch (error) {
      console.error(`Ошибка при создании директории ${dir}:`, error);
    }
  } else {
    console.log(`Директория уже существует: ${dir}`);
  }
});

// Проверка наличия данных в старой директории
if (fs.existsSync(oldDataDir)) {
  console.log(`Найдена старая директория данных: ${oldDataDir}`);
  
  // Копируем данные из старой директории в новую
  dataSubDirs.forEach(subDir => {
    const oldSubDir = path.join(oldDataDir, subDir);
    const newSubDir = path.join(newDataDir, subDir);
    
    if (fs.existsSync(oldSubDir)) {
      console.log(`Копирование данных из ${oldSubDir} в ${newSubDir}`);
      
      try {
        const files = fs.readdirSync(oldSubDir);
        console.log(`Найдено ${files.length} файлов для копирования`);
        
        files.forEach(file => {
          const oldFilePath = path.join(oldSubDir, file);
          const newFilePath = path.join(newSubDir, file);
          
          if (!fs.existsSync(newFilePath)) {
            // Копируем только если файл еще не существует в новой директории
            fs.copyFileSync(oldFilePath, newFilePath);
            console.log(`Скопирован файл: ${file}`);
          } else {
            console.log(`Пропущен файл (уже существует): ${file}`);
          }
        });
      } catch (error) {
        console.error(`Ошибка при копировании данных из ${oldSubDir}:`, error);
      }
    } else {
      console.log(`Директория ${oldSubDir} не найдена, пропускаем`);
    }
  });
  
  // Копируем JSON файлы из старой директории
  try {
    const jsonFiles = ['vector_store.json', 'vector_index.json', 'hash_index.json', 'embedding_cache.json'];
    
    jsonFiles.forEach(file => {
      const oldFilePath = path.join(oldDataDir, file);
      const newFilePath = path.join(newDataDir, file);
      
      if (fs.existsSync(oldFilePath) && !fs.existsSync(newFilePath)) {
        fs.copyFileSync(oldFilePath, newFilePath);
        console.log(`Скопирован файл: ${file}`);
      } else if (!fs.existsSync(oldFilePath)) {
        console.log(`Файл не найден, создаем пустой: ${file}`);
        fs.writeFileSync(newFilePath, file.includes('index') ? '{}' : '[]');
      } else {
        console.log(`Пропущен файл (уже существует): ${file}`);
      }
    });
  } catch (error) {
    console.error(`Ошибка при копировании JSON файлов:`, error);
  }
} else {
  console.log(`Старая директория данных не найдена: ${oldDataDir}`);
  console.log('Создаем пустые JSON файлы в новой директории...');
  
  // Создаем пустые JSON файлы в новой директории
  const jsonFiles = [
    { name: 'vector_store.json', content: '[]' },
    { name: 'vector_index.json', content: '{}' },
    { name: 'hash_index.json', content: '{}' },
    { name: 'embedding_cache.json', content: '{}' }
  ];
  
  jsonFiles.forEach(file => {
    const filePath = path.join(newDataDir, file.name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, file.content);
      console.log(`Создан файл: ${file.name}`);
    } else {
      console.log(`Файл уже существует: ${file.name}`);
    }
  });
}

console.log('\nГотово! Структура директорий исправлена.');
console.log('Теперь вы можете запустить приложение с корректными путями:');
console.log('npm run dev');