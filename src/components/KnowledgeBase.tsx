// src/components/KnowledgeBase.tsx
import React, { useState, useEffect } from 'react';
import { TrashIcon, DocumentTextIcon, FolderIcon, XMarkIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import axios from 'axios';

interface Document {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  contentHash: string;
  createdAt: string;
  chunkCount: number;
}

interface KnowledgeBaseProps {
  onClose: () => void;
}

const KnowledgeBase: React.FC<KnowledgeBaseProps> = ({ onClose }) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statsVisible, setStatsVisible] = useState<boolean>(false);
  const [vectorStats, setVectorStats] = useState<any>(null);
  
  // Format file size helper
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };
  
  // Format date helper
  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch (e) {
      return dateString;
    }
  };
  
  // Load documents from API
  const loadDocuments = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await axios.get('/api/kb/documents');
      setDocuments(response.data.documents || []);
    } catch (err) {
      setError('Failed to load knowledge base documents');
      console.error('Error loading documents:', err);
    } finally {
      setLoading(false);
    }
  };
  
  // Load vector store stats
  const loadStats = async () => {
    try {
      const response = await axios.get('/api/kb/stats');
      setVectorStats(response.data.knowledgeBase.vectorStats);
    } catch (err) {
      console.error('Error loading vector store stats:', err);
    }
  };
  
  // Delete document from knowledge base
  const deleteDocument = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document from the knowledge base?')) {
      return;
    }
    
    try {
      await axios.delete(`/api/kb/documents/${documentId}`);
      // Remove from state
      setDocuments(prev => prev.filter(doc => doc.id !== documentId));
    } catch (err) {
      setError('Failed to delete document');
      console.error('Error deleting document:', err);
    }
  };
  
  // Load documents on component mount
  useEffect(() => {
    loadDocuments();
    loadStats();
  }, []);
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-30">
      <div className="bg-gray-800 rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-700 p-4">
          <h2 className="text-xl font-medium flex items-center">
            <FolderIcon className="h-6 w-6 mr-2 text-green-500" />
            Knowledge Base
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center items-center h-32">
              <div className="dot-typing"></div>
            </div>
          ) : error ? (
            <div className="bg-red-900/30 text-red-300 p-4 rounded">
              {error}
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <DocumentTextIcon className="h-12 w-12 mx-auto mb-3 text-gray-500" />
              <p>No documents in knowledge base yet.</p>
              <p className="mt-2 text-sm">Upload files to chat to add them to the knowledge base.</p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm text-gray-400">
                  {documents.length} document{documents.length !== 1 ? 's' : ''} in knowledge base
                </div>
                <button 
                  onClick={() => {
                    setStatsVisible(!statsVisible);
                    if (!statsVisible && !vectorStats) {
                      loadStats();
                    }
                  }}
                  className="text-blue-400 hover:text-blue-300 text-sm flex items-center"
                >
                  <InformationCircleIcon className="h-4 w-4 mr-1" />
                  {statsVisible ? 'Hide Stats' : 'Show Stats'}
                </button>
              </div>
              
              {statsVisible && vectorStats && (
                <div className="mb-4 p-3 bg-gray-700/50 rounded-md text-sm">
                  <h3 className="font-medium mb-2 text-gray-300">Vector Store Statistics</h3>
                  <div className="grid grid-cols-2 gap-2 text-gray-400">
                    <div>Total Vectors:</div>
                    <div className="text-white">{vectorStats.totalVectors}</div>
                    <div>Total Documents:</div>
                    <div className="text-white">{vectorStats.totalDocuments}</div>
                    <div>Average Chunks/Document:</div>
                    <div className="text-white">{vectorStats.averageChunksPerDocument.toFixed(1)}</div>
                  </div>
                </div>
              )}
              
              <div className="space-y-2">
                {documents.map(doc => (
                  <div key={doc.id} className="bg-gray-700 rounded-md p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-white flex items-center">
                          <DocumentTextIcon className="h-5 w-5 mr-2 flex-shrink-0 text-green-500" />
                          <span className="truncate">{doc.fileName}</span>
                        </div>
                        
                        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-400">
                          <div>Added:</div>
                          <div>{formatDate(doc.createdAt)}</div>
                          
                          <div>Size:</div>
                          <div>{formatFileSize(doc.fileSize)}</div>
                          
                          <div>Type:</div>
                          <div>{doc.fileType}</div>
                          
                          <div>Chunks:</div>
                          <div>{doc.chunkCount}</div>
                        </div>
                      </div>
                      
                      <button
                        onClick={() => deleteDocument(doc.id)}
                        className="ml-2 p-1 text-gray-400 hover:text-red-400 flex-shrink-0"
                        title="Delete from knowledge base"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        
        <div className="border-t border-gray-700 p-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeBase;