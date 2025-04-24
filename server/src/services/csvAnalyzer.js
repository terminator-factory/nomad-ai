// server/src/services/csvAnalyzer.js
/**
 * Анализирует CSV файл и возвращает основную информацию о нем
 * @param {string} csvContent - Содержимое CSV файла
 * @returns {Object} - Информация о CSV файле
 */
function analyzeCSV(csvContent) {
    try {
      // Нормализация переносов строк
      const normalizedContent = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalizedContent.trim().split('\n');
      
      if (lines.length <= 1) {
        return {
          success: false,
          error: 'CSV файл не содержит данных',
          rowCount: 0,
          headers: [],
          firstRow: null,
          lastRow: null
        };
      }
      
      const headers = lines[0].split(',');
      const firstRow = lines[1].split(',');
      const lastRow = lines[lines.length - 1].split(',');
      
      // Создаем объекты с данными
      const firstRowObj = {};
      const lastRowObj = {};
      
      headers.forEach((header, index) => {
        firstRowObj[header.trim()] = firstRow[index]?.trim() || '';
        lastRowObj[header.trim()] = lastRow[index]?.trim() || '';
      });
      
      return {
        success: true,
        rowCount: lines.length - 1, // Без заголовка
        headers: headers.map(h => h.trim()),
        firstRow: firstRowObj,
        lastRow: lastRowObj,
        firstRowRaw: lines[1],
        lastRowRaw: lines[lines.length - 1]
      };
    } catch (error) {
      console.error('Ошибка при анализе CSV:', error);
      return {
        success: false,
        error: error.message,
        rowCount: 0,
        headers: [],
        firstRow: null,
        lastRow: null
      };
    }
  }
  
  module.exports = {
    analyzeCSV
  };