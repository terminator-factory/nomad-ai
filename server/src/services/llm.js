// server/src/services/llm.js
const axios = require('axios');

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

function isJSONFile(file) {
  return file.type === 'application/json' || 
         (file.name && file.name.toLowerCase().endsWith('.json'));
}

// Форматирование размера файла
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / 1048576).toFixed(1) + ' МБ';
}

/**
 * Получение списка доступных моделей
 * @returns {Array} - Список доступных моделей
 */
const getAvailableModels = () => {
  return AVAILABLE_MODELS;
};

/**
 * Анализирует CSV файл и возвращает информацию о его структуре
 * @param {string} content - Содержимое CSV файла
 * @returns {Object} - Информация о структуре CSV
 */
function analyzeCSV(content) {
  try {
    const lines = content.trim().split('\n');
    const totalRows = lines.length;
    
    // Если файл пустой или содержит только заголовок
    if (totalRows <= 1) {
      return {
        success: true,
        rowCount: totalRows,
        columnCount: totalRows > 0 ? lines[0].split(',').length : 0,
        headers: totalRows > 0 ? lines[0].split(',').map(h => h.trim()) : [],
        firstRow: totalRows > 1 ? lines[1] : null,
        lastRow: totalRows > 1 ? lines[totalRows - 1] : null
      };
    }
    
    // Получаем заголовки и определяем количество столбцов
    const headers = lines[0].split(',').map(h => h.trim());
    const columnCount = headers.length;
    
    // Получаем первую и последнюю строки данных
    const firstRow = lines[1];
    const lastRow = lines[totalRows - 1];
    
    // Получаем все уникальные значения первого столбца
    const firstColumnValues = [];
    for (let i = 1; i < totalRows; i++) {
      const columns = lines[i].split(',');
      if (columns.length > 0) {
        firstColumnValues.push(columns[0].trim());
      }
    }
    
    return {
      success: true,
      rowCount: totalRows,
      columnCount,
      headers,
      firstRow,
      lastRow,
      firstColumnValues: firstColumnValues.slice(0, 20) // Ограничиваем до 20 значений
    };
  } catch (error) {
    console.error('Ошибка при анализе CSV:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Обрабатывает CSV, упрощая данные для модели
 * @param {string} content - Содержимое CSV файла
 * @returns {string} - Форматированное описание CSV
 */
function processCSVForModel(content) {
  const csvInfo = analyzeCSV(content);
  if (!csvInfo.success) {
    return `CSV файл не удалось проанализировать: ${csvInfo.error}\n`;
  }
  
  let result = '';
  
  // Базовая информация о файле
  result += `=== ИНФОРМАЦИЯ О CSV ФАЙЛЕ ===\n`;
  result += `Всего строк: ${csvInfo.rowCount}\n`;
  result += `Всего столбцов: ${csvInfo.columnCount}\n`;
  result += `Заголовки: ${csvInfo.headers.join(', ')}\n\n`;
  
  // Первая строка данных
  if (csvInfo.firstRow) {
    result += `Первая строка данных:\n${csvInfo.firstRow}\n\n`;
  }
  
  // Последняя строка данных
  if (csvInfo.lastRow) {
    result += `Последняя строка данных:\n${csvInfo.lastRow}\n\n`;
  }
  
  // Примеры значений из первого столбца
  if (csvInfo.firstColumnValues && csvInfo.firstColumnValues.length > 0) {
    result += `Примеры значений из первого столбца: ${csvInfo.firstColumnValues.join(', ')}\n\n`;
  }
  
  return result;
}

/**
 * Форматирует сообщения в формат для запроса к API модели
 * @param {Array} messages - История сообщений
 * @param {Array} attachments - Прикрепленные файлы
 * @returns {string} - Форматированный запрос для модели
 */
const formatPrompt = (messages, attachments = []) => {
  console.log(`Форматирование запроса: ${messages.length} сообщений, ${attachments.length} вложений`);
  
  // Получаем последнее сообщение пользователя
  const lastUserMessage = messages.filter(msg => msg.role === 'user').pop();
  const lastUserContent = lastUserMessage ? lastUserMessage.content.trim().toLowerCase() : '';
  
  // Определяем специальные типы запросов
  const askingAboutRows = /сколько.*строк/i.test(lastUserContent) || /кол.*строк/i.test(lastUserContent);
  const askingAboutColumns = /сколько.*столб/i.test(lastUserContent) || /кол.*столб/i.test(lastUserContent);
  const askingAboutBoth = (askingAboutRows && askingAboutColumns) || /строк.*столб/i.test(lastUserContent);
  const askingAboutFirstRow = /перв.*строк/i.test(lastUserContent);
  const askingAboutLastRow = /послед.*строк/i.test(lastUserContent);
  const askingAboutFirstColumn = /перв.*столб/i.test(lastUserContent);
  const isMathQuestion = /сколько будет/i.test(lastUserContent) || /\d+\s*[+\-*/]\s*\d+/.test(lastUserContent);
  
  // Форматируем промпт, начиная с системного сообщения
  let prompt = '';
  
  // Базовые системные инструкции
  prompt += `Ты дружелюбный и полезный ассистент. Ты можешь анализировать содержимое файлов и отвечать на вопросы пользователя.\n`;
  
  // Специальные инструкции в зависимости от типа вопроса
  if (askingAboutBoth) {
    prompt += `СПЕЦИАЛЬНЫЕ ИНСТРУКЦИИ: Пользователь спрашивает о количестве строк и столбцов. Ответь только в формате: "В файле X строк и Y столбцов."\n\n`;
  } else if (askingAboutRows) {
    prompt += `СПЕЦИАЛЬНЫЕ ИНСТРУКЦИИ: Пользователь спрашивает о количестве строк. Ответь только числом строк.\n\n`;
  } else if (askingAboutColumns) {
    prompt += `СПЕЦИАЛЬНЫЕ ИНСТРУКЦИИ: Пользователь спрашивает о количестве столбцов. Ответь только числом столбцов.\n\n`;
  } else if (askingAboutFirstRow) {
    prompt += `СПЕЦИАЛЬНЫЕ ИНСТРУКЦИИ: Пользователь спрашивает о первой строке. Покажи содержимое первой строки данных (не заголовка).\n\n`;
  } else if (askingAboutLastRow) {
    prompt += `СПЕЦИАЛЬНЫЕ ИНСТРУКЦИИ: Пользователь спрашивает о последней строке. Покажи содержимое последней строки данных.\n\n`;
  } else if (askingAboutFirstColumn) {
    prompt += `СПЕЦИАЛЬНЫЕ ИНСТРУКЦИИ: Пользователь спрашивает о первом столбце. Покажи примеры значений из первого столбца.\n\n`;
  } else if (isMathQuestion) {
    prompt += `СПЕЦИАЛЬНЫЕ ИНСТРУКЦИИ: Пользователь задал математический вопрос. Ответь только результатом вычисления.\n\n`;
  } else {
    prompt += `ИНСТРУКЦИИ: Отвечай только на вопрос пользователя. Не повторяй содержимое файлов без необходимости.\n\n`;
  }
  
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
  
  // Добавляем информацию о файлах
  if (attachments && attachments.length > 0) {
    prompt += `### ДАННЫЕ ДЛЯ АНАЛИЗА ###\n`;
    
    attachments.forEach(file => {
      const fileName = file.name || 'Unnamed file';
      const fileType = file.type || 'unknown type';
      const fileSize = formatFileSize(file.size);
      
      prompt += `Файл: ${fileName} (${fileType}, ${fileSize})\n`;
      
      // Обработка CSV файлов
      if (isCSVFile(file) && file.content) {
        const csvInfo = analyzeCSV(file.content);
        const rowCount = csvInfo.rowCount;
        const columnCount = csvInfo.columnCount;
        
        // Добавляем структурированную информацию для специальных запросов
        if (askingAboutBoth) {
          prompt += `В файле ${rowCount} строк и ${columnCount} столбцов.\n`;
        } else if (askingAboutRows) {
          prompt += `Количество строк в файле: ${rowCount}\n`;
        } else if (askingAboutColumns) {
          prompt += `Количество столбцов в файле: ${columnCount}\n`;
        } else {
          // Общая информация о CSV
          prompt += processCSVForModel(file.content);
        }
      }
      // Обработка JSON файлов
      else if (isJSONFile(file) && file.content) {
        if (file.content.length <= 5000) {
          prompt += `Содержимое JSON файла:\n${file.content}\n\n`;
        } else {
          prompt += `JSON файл слишком большой для полного включения (${file.content.length} символов).\n`;
          prompt += `Начало файла:\n${file.content.substring(0, 1000)}...\n\n`;
        }
      }
      // Обработка остальных текстовых файлов
      else if (file.content) {
        if (file.content.length <= 5000) {
          prompt += `Содержимое файла:\n${file.content}\n\n`;
        } else {
          prompt += `Файл слишком большой для полного включения (${file.content.length} символов).\n`;
          prompt += `Начало файла:\n${file.content.substring(0, 1000)}...\n\n`;
        }
      }
      // Для бинарных файлов
      else {
        prompt += `[Бинарный файл, содержимое недоступно для анализа]\n\n`;
      }
    });
    
    prompt += `### КОНЕЦ ДАННЫХ ###\n\n`;
  }
  
  // Финальные инструкции перед ответом
  if (askingAboutBoth) {
    prompt += `НАПОМИНАНИЕ: Ответь только в формате "В файле X строк и Y столбцов."\n\n`;
  } else if (askingAboutRows) {
    prompt += `НАПОМИНАНИЕ: Ответь только числом строк.\n\n`;
  } else if (askingAboutColumns) {
    prompt += `НАПОМИНАНИЕ: Ответь только числом столбцов.\n\n`;
  } else if (isMathQuestion) {
    prompt += `НАПОМИНАНИЕ: Ответь только результатом математического вычисления.\n\n`;
  } else {
    prompt += `НАПОМИНАНИЕ: Отвечай кратко и точно на вопрос пользователя.\n\n`;
  }
  
  // Повторяем актуальный вопрос пользователя
  if (lastUserMessage) {
    prompt += `Вопрос пользователя: "${lastUserMessage.content}"\n\n`;
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