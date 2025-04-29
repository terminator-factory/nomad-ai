// src/components/CsvDebug.tsx
import React from 'react';
import { FileAttachment } from '../types';

interface CsvDebugProps {
  attachments: FileAttachment[];
}

const CsvDebug: React.FC<CsvDebugProps> = ({ attachments }) => {
  const csvFiles = attachments.filter(
    file => file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')
  );
  
  if (csvFiles.length === 0) {
    return null;
  }
  
  // Simple function to detect if a string looks like CSV data
  const looksLikeCSV = (text: string): boolean => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return false;
    
    // Check if most lines have the same number of commas
    const commasInFirstLine = (lines[0].match(/,/g) || []).length;
    let sameCommaCount = 0;
    
    for (let i = 1; i < Math.min(lines.length, 5); i++) {
      const commasInThisLine = (lines[i].match(/,/g) || []).length;
      if (commasInThisLine === commasInFirstLine) {
        sameCommaCount++;
      }
    }
    
    // If most of the first 5 rows have the same comma count, likely CSV
    return sameCommaCount >= Math.min(lines.length - 1, 3);
  };
  
  // Simple function to parse a small preview of CSV data
  const parseCsvPreview = (csvText: string): Array<Array<string>> => {
    const lines = csvText.trim().split('\n').slice(0, 5); // Only process first 5 lines
    return lines.map(line => line.split(',').map(cell => cell.trim()));
  };
  
  return (
    <div className="mb-3 p-2 border border-yellow-700 rounded-md bg-yellow-900/20">
      <h3 className="font-medium text-sm text-yellow-400 mb-2">CSV Debug Info</h3>
      
      {csvFiles.map((file, fileIndex) => (
        <div key={file.id} className="mb-3 text-xs">
          <div className="text-yellow-300 font-medium">{file.name} ({formatFileSize(file.size)})</div>
          
          {file.content ? (
            <>
              <div className="text-gray-300 mt-1">
                Content length: {file.content.length} characters
              </div>
              
              <div className="text-gray-300">
                Looks like CSV: {looksLikeCSV(file.content) ? 'Yes' : 'No'}
              </div>
              
              {looksLikeCSV(file.content) && (
                <div className="mt-2">
                  <div className="text-yellow-300 mb-1">CSV Preview:</div>
                  <div className="bg-gray-800 p-2 rounded overflow-x-auto">
                    <table className="w-full border-collapse">
                      <tbody>
                        {parseCsvPreview(file.content).map((row, rowIndex) => (
                          <tr key={rowIndex} className={rowIndex === 0 ? "bg-gray-700" : ""}>
                            {row.map((cell, cellIndex) => (
                              <td 
                                key={cellIndex} 
                                className="border border-gray-600 p-1 text-gray-300"
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-red-400">
              No content available. CSV file was not properly read.
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
};

export default CsvDebug;