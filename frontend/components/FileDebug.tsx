// src/components/FileDebug.tsx
import React from 'react';
import { FileAttachment } from '../types';

interface FileDebugProps {
  attachments: FileAttachment[];
}

const FileDebug: React.FC<FileDebugProps> = ({ attachments }) => {
  if (attachments.length === 0) {
    return null;
  }
  
  return (
    <div className="mb-3 p-2 border border-gray-700 rounded-md bg-gray-800/50">
      <h3 className="font-medium text-sm text-green-400 mb-1">Attached Files (Debug Info)</h3>
      <div className="text-xs text-gray-300">
        {attachments.map((file) => (
          <div key={file.id} className="mb-1">
            <div>• {file.name} ({formatFileSize(file.size)})</div>
            {file.content && (
              <div className="text-gray-400 ml-2">
                Content preview: {file.content.slice(0, 30)}...
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
};

export default FileDebug;