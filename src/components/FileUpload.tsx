// src/components/FileUpload.tsx
import React, { useRef } from 'react';
import { FileAttachment } from '../types';
import { PaperClipIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface FileUploadProps {
  attachments: FileAttachment[];
  onFileUpload: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ 
  attachments, 
  onFileUpload, 
  onRemoveAttachment 
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
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
  
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };
  
  return (
    <div className="w-full">
      <div className="flex items-center">
        <button
          type="button"
          onClick={handleClick}
          className="flex items-center text-gray-400 hover:text-white"
        >
          <PaperClipIcon className="w-5 h-5" />
          <span className="ml-1 text-sm">Attach files</span>
        </button>
        <input
          type="file"
          multiple
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileChange}
        />
      </div>
      
      {attachments.length > 0 && (
        <div className="mt-2 space-y-2">
          {attachments.map((file) => (
            <div 
              key={file.id} 
              className="flex items-center justify-between bg-gray-700 rounded p-2"
            >
              <div className="flex items-center">
                <div className="w-8 h-8 bg-gray-600 rounded flex items-center justify-center text-xs">
                  {file.type.split('/')[0].charAt(0).toUpperCase()}
                </div>
                <div className="ml-2">
                  <div className="text-sm font-medium text-white">{file.name}</div>
                  <div className="text-xs text-gray-400">{formatFileSize(file.size)}</div>
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