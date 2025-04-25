// src/components/FileUpload.tsx - Updated for RAG
import React, { useRef, useState } from 'react';
import { FileAttachment } from '../types';
import { 
  PaperClipIcon, 
  XMarkIcon, 
  DocumentTextIcon, 
  TableCellsIcon,
  CodeBracketIcon,
  BookOpenIcon,
  ExclamationCircleIcon
} from '@heroicons/react/24/outline';

interface FileUploadProps {
  attachments: FileAttachment[];
  onFileUpload: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  duplicateFiles?: {[fileName: string]: string}; // Map of fileName to existing file name
  onOpenKnowledgeBase?: () => void; // Optional callback to open knowledge base
}

const FileUpload: React.FC<FileUploadProps> = ({ 
  attachments, 
  onFileUpload, 
  onRemoveAttachment,
  duplicateFiles = {},
  onOpenKnowledgeBase
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  
  const handleClick = () => {
    fileInputRef.current?.click();
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileUpload(Array.from(e.target.files));
      // Reset input value to allow selecting the same file again
      e.target.value = '';
    }
  };
  
  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };
  
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileUpload(Array.from(e.dataTransfer.files));
    }
  };
  
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };
  
  const getFileIcon = (file: FileAttachment) => {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    
    if (type === 'text/csv' || name.endsWith('.csv')) {
      return <TableCellsIcon className="w-5 h-5" />;
    } else if (type === 'text/html' || name.endsWith('.html') || name.endsWith('.htm')) {
      return <CodeBracketIcon className="w-5 h-5" />;
    } else {
      return <DocumentTextIcon className="w-5 h-5" />;
    }
  };
  
  // Check if this file is a duplicate
  const isDuplicate = (fileName: string): boolean => {
    return duplicateFiles[fileName] !== undefined;
  };
  
  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between mb-2">
        <div 
          className={`flex-1 flex items-center justify-center p-2 rounded-md border-2 border-dashed transition-colors ${
            dragActive ? 'border-green-500 bg-green-500/10' : 'border-gray-700'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <button
            type="button"
            onClick={handleClick}
            className="flex items-center text-gray-400 hover:text-white py-1"
          >
            <PaperClipIcon className="w-5 h-5" />
            <span className="ml-1 text-sm">Загрузить файл или перетащите сюда</span>
          </button>
          <input
            type="file"
            multiple
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".txt,.csv,.html,.htm,.json,.xml,.js,.ts,.jsx,.tsx,.md,.css"
          />
        </div>
        
        {onOpenKnowledgeBase && (
          <button
            type="button"
            onClick={onOpenKnowledgeBase}
            className="ml-2 flex items-center bg-green-900/50 hover:bg-green-900 text-white px-2 py-1 rounded text-sm"
            title="Browse knowledge base"
          >
            <BookOpenIcon className="w-4 h-4 mr-1" />
            <span>KB</span>
          </button>
        )}
      </div>
      
      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((file) => (
            <div 
              key={file.id} 
              className={`flex items-center justify-between rounded p-2 ${
                isDuplicate(file.name) ? 'bg-yellow-900/50 border border-yellow-800' : 'bg-gray-700'
              }`}
            >
              <div className="flex items-center">
                <div className={`w-8 h-8 rounded flex items-center justify-center text-xs ${
                  isDuplicate(file.name) ? 'bg-yellow-800 text-yellow-200' : 'bg-gray-600'
                }`}>
                  {isDuplicate(file.name) ? (
                    <ExclamationCircleIcon className="w-5 h-5" />
                  ) : (
                    getFileIcon(file)
                  )}
                </div>
                <div className="ml-2">
                  <div className="text-sm font-medium text-white flex items-center">
                    {file.name}
                    {isDuplicate(file.name) && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 bg-yellow-800 text-yellow-100 rounded-full">Duplicate</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">
                    {formatFileSize(file.size)} - {file.content ? 'Обработано' : 'Двоичный файл'}
                    {isDuplicate(file.name) && (
                      <span className="ml-1 text-yellow-400">
                        Similar to: {duplicateFiles[file.name]}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemoveAttachment(file.id)}
                className="text-gray-400 hover:text-white"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileUpload;