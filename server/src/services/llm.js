// server/src/services/llm.js
const axios = require('axios');

// URL для доступа к модели в Docker
const LLM_API_URL = process.env.LLM_API_URL || 'http://172.17.0.1:1134/api/generate';

/**
 * Форматирует сообщения в формат для запроса к API модели
 * @param {Array} messages - История сообщений
 * @param {Array} attachments - Прикрепленные файлы
 * @returns {string} - Форматированный запрос для модели
 */
const formatPrompt = (messages, attachments = []) => {
  // Форматируем историю сообщений
  let prompt = '';
  
  messages.forEach(msg => {
    if (msg.role === 'user') {
      prompt += `Пользователь: ${msg.content}\n\n`;
    } else if (msg.role === 'assistant') {
      prompt += `Ассистент: ${msg.content}\n\n`;
    } else if (msg.role === 'system') {
      prompt += `Системное сообщение: ${msg.content}\n\n`;
    }
  });
  
  // Добавляем информацию о прикрепленных файлах
  if (attachments && attachments.length > 0) {
    prompt += 'Прикрепленные файлы:\n';
    
    attachments.forEach(file => {
      prompt += `Файл: ${file.name} (${file.type})\n`;
      
      // Если у файла есть содержимое (текстовый файл), добавляем его
      if (file.content) {
        prompt += `Содержимое файла:\n${file.content}\n\n`;
      } else {
        prompt += `[Бинарный файл, содержимое недоступно]\n\n`;
      }
    });
  }
  
  // Добавляем префикс для ответа модели
  prompt += 'Ассистент: ';
  
  return prompt;
};

/**
 * Отправляет запрос к API модели с потоковым ответом
 * @param {Object} options - Параметры запроса
 * @param {Array} options.messages - История сообщений
 * @param {Array} options.attachments - Прикрепленные файлы
 * @param {Function} options.onChunk - Колбэк для каждого фрагмента ответа
 * @param {Function} options.onComplete - Колбэк при завершении ответа
 * @param {Function} options.onError - Колбэк при ошибке
 */
const streamResponse = async ({ messages, attachments = [], onChunk, onComplete, onError }) => {
  try {
    const prompt = formatPrompt(messages, attachments);
    
    const response = await axios({
      method: 'post',
      url: LLM_API_URL,
      data: {
        model: 'gemma3:4b',
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
  streamResponse
};