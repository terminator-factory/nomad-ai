// server/src/services/llm.js
const axios = require('axios');
const csvAnalyzer = require('./csvAnalyzer');

// URL для доступа к модели в Docker
const LLM_API_URL = process.env.LLM_API_URL || 'http://localhost:11434/api/generate';

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

function isHTMLFile(file) {
  return file.type === 'text/html' || 
         (file.name && (file.name.toLowerCase().endsWith('.html') || 
                        file.name.toLowerCase().endsWith('.htm')));
}

/**
 * Получение списка доступных моделей
 * @returns {Array} - Список доступных моделей
 */
const getAvailableModels = () => {
  return AVAILABLE_MODELS;
};

/**
 * Форматирует сообщения в формат для запроса к API модели
 * @param {Array} messages - История сообщений
 * @param {Array} attachments - Прикрепленные файлы
 * @returns {string} - Форматированный запрос для модели
 */
const formatPrompt = (messages, attachments = []) => {
  console.log(`Форматирование запроса: ${messages.length} сообщений, ${attachments.length} вложений`);
  
  // Форматируем историю сообщений
  let prompt = '';
  
  // Добавляем системное сообщение
  prompt += `Ты дружелюбный и полезный ассистент. Ты можешь отвечать на различные вопросы и анализировать содержимое файлов. Всегда отвечай на вопросы пользователя прямо, не спрашивая дополнительные вопросы без необходимости.\n\n`;
  
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
  
  // Базовые инструкции по работе с файлами
  if (attachments && attachments.length > 0) {
    prompt += `Информация о прикрепленных файлах:\n\n`;
    
    attachments.forEach(file => {
      const fileName = file.name || 'Unnamed file';
      const fileType = file.type || 'unknown type';
      
      prompt += `К сообщению прикреплен файл: ${fileName} (${fileType})\n`;
      
      // Для CSV файлов добавляем базовую информацию
      if (isCSVFile(file) && file.content) {
        // Используем csvAnalyzer для анализа файла
        const csvInfo = csvAnalyzer.analyzeCSV(file.content);
        
        if (csvInfo.success) {
          prompt += `CSV файл содержит ${csvInfo.rowCount} строк данных.\n\n`;
          
          prompt += `Заголовки CSV: ${csvInfo.headers.join(', ')}\n\n`;
          
          prompt += `Первая строка данных:\n`;
          Object.entries(csvInfo.firstRow).forEach(([key, value]) => {
            prompt += `${key}: ${value}\n`;
          });
          prompt += `\n`;
          
          prompt += `Последняя строка данных:\n`;
          Object.entries(csvInfo.lastRow).forEach(([key, value]) => {
            prompt += `${key}: ${value}\n`;
          });
          prompt += `\n`;
          
          // Инструкции для модели по работе с CSV
          prompt += `Важное примечание: В CSV файле содержатся только данные, которые я предоставил выше. `;
          prompt += `Не придумывай дополнительные строки, которых нет в файле. `;
          prompt += `Если тебя просят показать строки из файла, показывай только реальные данные из файла.\n\n`;
        } else {
          // Если анализатор не сработал, используем простой подход
          const lines = file.content.split('\n');
          const totalRows = lines.length - 1; // Количество строк без заголовка
          
          prompt += `Этот CSV файл содержит ${totalRows} строк данных.\n`;
          
          // Добавляем заголовки и первую/последнюю строку
          if (lines.length > 1) {
            prompt += `Заголовки: ${lines[0]}\n`;
            prompt += `Первая строка данных: ${lines[1]}\n`;
            prompt += `Последняя строка данных: ${lines[lines.length - 1]}\n\n`;
            
            // Добавляем первые 5 строк как образец
            prompt += `Вот первые 5 строк файла:\n`;
            for (let i = 0; i < Math.min(5, lines.length); i++) {
              prompt += `${lines[i]}\n`;
            }
            prompt += `\n`;
          }
        }
      } 
      // Для других текстовых файлов добавляем кусочек содержимого
      else if (file.content) {
        prompt += `Вот первые 200 символов файла:\n${file.content.substring(0, 200)}...\n\n`;
      }
    });
  }
  
  // Добавляем префикс для ответа модели
  prompt += 'Ассистент: ';
  
  // Логирование итогового запроса
  console.log(`Итоговый запрос сформирован, длина: ${prompt.length} символов`);
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
    const prompt = formatPrompt(messages, attachments);
    
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

module.exports = {
  streamResponse,
  getAvailableModels
};