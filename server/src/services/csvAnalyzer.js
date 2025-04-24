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
    
    if (lines.length === 0) {
      return {
        success: false,
        error: 'Файл пуст',
        rowCount: 0,
        columnCount: 0,
        headers: [],
        firstRow: null,
        lastRow: null,
        firstColumnValues: []
      };
    }
    
    // Получаем заголовки из первой строки
    const headers = lines[0].split(',').map(header => header.trim());
    const columnCount = headers.length;
    
    // Общее количество строк в файле (включая заголовок)
    const rowCount = lines.length;
    
    // Если в файле только заголовок
    if (rowCount <= 1) {
      return {
        success: true,
        rowCount,
        columnCount,
        headers,
        firstRow: null,
        lastRow: null,
        firstColumnValues: []
      };
    }
    
    // Получаем первую и последнюю строку данных
    const firstRow = lines[1];
    const lastRow = lines[lines.length - 1];
    
    // Извлекаем значения первого столбца
    const firstColumnValues = [];
    for (let i = 1; i < Math.min(rowCount, 21); i++) {
      const columns = lines[i].split(',');
      if (columns.length > 0) {
        const value = columns[0].trim();
        if (value) {
          firstColumnValues.push(value);
        }
      }
    }
    
    // Создаем объекты для первой и последней строки
    const firstRowObj = {};
    const lastRowObj = {};
    
    const firstRowCols = firstRow.split(',');
    const lastRowCols = lastRow.split(',');
    
    headers.forEach((header, index) => {
      if (index < firstRowCols.length) {
        firstRowObj[header] = firstRowCols[index].trim();
      }
      
      if (index < lastRowCols.length) {
        lastRowObj[header] = lastRowCols[index].trim();
      }
    });
    
    return {
      success: true,
      rowCount,
      columnCount,
      headers,
      firstRow,
      lastRow,
      firstRowObj,
      lastRowObj,
      firstColumnValues
    };
  } catch (error) {
    console.error('Ошибка при анализе CSV:', error);
    return {
      success: false,
      error: error.message,
      rowCount: 0,
      columnCount: 0,
      headers: [],
      firstRow: null,
      lastRow: null,
      firstColumnValues: []
    };
  }
}

/**
 * Форматирует информацию о CSV для включения в промпт
 * @param {string} csvContent - Содержимое CSV файла
 * @returns {string} - Отформатированная информация для промпта
 */
function formatCSVInfo(csvContent) {
  const info = analyzeCSV(csvContent);
  
  if (!info.success) {
    return `Не удалось проанализировать CSV файл: ${info.error}\n`;
  }
  
  let result = '';
  result += `=== ИНФОРМАЦИЯ О CSV ФАЙЛЕ ===\n`;
  result += `Количество строк (включая заголовок): ${info.rowCount}\n`;
  result += `Количество столбцов: ${info.columnCount}\n`;
  result += `Заголовки: ${info.headers.join(', ')}\n\n`;
  
  if (info.firstRow) {
    result += `Первая строка данных: ${info.firstRow}\n\n`;
  }
  
  if (info.lastRow) {
    result += `Последняя строка данных: ${info.lastRow}\n\n`;
  }
  
  if (info.firstColumnValues && info.firstColumnValues.length > 0) {
    result += `Примеры значений из первого столбца: ${info.firstColumnValues.join(', ')}\n\n`;
  }
  
  return result;
}

module.exports = {
  analyzeCSV,
  formatCSVInfo
};