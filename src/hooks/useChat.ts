// src/hooks/useChat.ts - Updated with RAG support and fixed TypeScript errors
import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import io, { Socket } from 'socket.io-client';
import axios from 'axios';
import { Message, FileAttachment, ChatSession } from '../types';

interface UseChatProps {
  initialMessages?: Message[];
  sessionId?: string;
}

// Интерфейс для моделей
interface ModelOption {
  id: string;
  name: string;
  description?: string;
}

// Interface for knowledge base document
interface KnowledgeBaseDocument {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  contentHash: string;
  createdAt: string;
  chunkCount: number;
}

const useChat = ({ initialMessages = [], sessionId = uuidv4() }: UseChatProps = {}) => {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string>(sessionId);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  
  // State for models
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('gemma3:4b');
  
  // Knowledge base state
  const [knowledgeBaseDocuments, setKnowledgeBaseDocuments] = useState<KnowledgeBaseDocument[]>([]);
  const [knowledgeBaseStats, setKnowledgeBaseStats] = useState<any>(null);
  const [isKnowledgeBaseLoading, setIsKnowledgeBaseLoading] = useState<boolean>(false);
  
  // Duplicate file tracking
  const [duplicateFiles, setDuplicateFiles] = useState<{[fileName: string]: string}>({});

  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3001';

  useEffect(() => {
    // Connect to Socket.IO server
    socketRef.current = io(SOCKET_URL);

    // Handle incoming message streams
    socketRef.current.on('message-chunk', (chunk: string) => {
      setMessages(prevMessages => {
        const newMessages = [...prevMessages];
        const lastMessage = newMessages[newMessages.length - 1];

        if (lastMessage && lastMessage.role === 'assistant') {
          // Append to existing message
          const updatedMessage: Message = {
            ...lastMessage,
            content: lastMessage.content + chunk
          };
          newMessages[newMessages.length - 1] = updatedMessage;

          // Обновляем сессию с каждым чанком
          updateSessionWithMessage(updatedMessage);

          return newMessages;
        } else {
          // Create new message
          const newAssistantMessage: Message = {
            id: uuidv4(),
            role: 'assistant',
            content: chunk,
            timestamp: new Date()
          };
          newMessages.push(newAssistantMessage);

          // Обновляем сессию с новым сообщением
          updateSessionWithMessage(newAssistantMessage);

          return newMessages;
        }
      });
    });

    socketRef.current.on('message-complete', () => {
      setIsLoading(false);
    });

    socketRef.current.on('error', (errorMsg: string) => {
      setError(errorMsg);
      setIsLoading(false);
    });
    
    // Listen for file status updates (e.g., duplicate files)
    socketRef.current.on('file-status', (data: { fileName: string; status: string; existingFileName?: string }) => {
      if (data.status === 'duplicate' && data.existingFileName) {
        // Ensure existingFileName is treated as a non-optional string
        const fileName = data.fileName;
        const existingName = data.existingFileName as string; // Type assertion
        
        setDuplicateFiles(prev => {
          // Create a new object with the explicit string type
          const newState: {[fileName: string]: string} = {...prev};
          newState[fileName] = existingName;
          return newState;
        });
      }
    });
    
    // Listen for knowledge base updates
    socketRef.current.on('kb-documents', (data: { documents: KnowledgeBaseDocument[] }) => {
      setKnowledgeBaseDocuments(data.documents || []);
      setIsKnowledgeBaseLoading(false);
    });
    
    socketRef.current.on('kb-document-deleted', (data: { documentId: string }) => {
      setKnowledgeBaseDocuments(prev => 
        prev.filter(doc => doc.id !== data.documentId)
      );
    });
    
    socketRef.current.on('kb-error', (data: { message: string }) => {
      setError(data.message);
      setIsKnowledgeBaseLoading(false);
    });

    // Load sessions from local storage
    const savedSessions = localStorage.getItem('chatSessions');
    if (savedSessions) {
      setSessions(JSON.parse(savedSessions));
    }
    
    // Load available models
    const fetchModels = async () => {
      try {
        const response = await axios.get(`${SOCKET_URL}/api/models`);
        if (response.data && Array.isArray(response.data.models)) {
          setModels(response.data.models);
          // Установка модели по умолчанию, если доступна
          if (response.data.models.length > 0) {
            setSelectedModel(response.data.models[0].id);
          }
        } else {
          // Если ответ не массив, устанавливаем модели по умолчанию
          console.error('Invalid models response:', response.data);
          setModels([
            { id: 'gemma3:4b', name: 'Gemma 3 4B', description: 'Модель по умолчанию' }
          ]);
        }
      } catch (error) {
        console.error('Error loading models:', error);
        // Установка моделей по умолчанию в случае ошибки
        setModels([
          { id: 'gemma3:4b', name: 'Gemma 3 4B', description: 'Модель по умолчанию' }
        ]);
      }
    };

    fetchModels();
    
    // Initial load of knowledge base documents
    loadKnowledgeBaseDocuments();

    return () => {
      socketRef.current?.disconnect();
    };
  }, [SOCKET_URL]);

  // Helper function to update session with message
  const updateSessionWithMessage = (message: Message) => {
    setSessions(prevSessions => {
      const updatedSessions = prevSessions.map(session => {
        if (session.id === currentSessionId) {
          // Find message in session by ID
          const messageIndex = session.messages.findIndex(msg => msg.id === message.id);

          if (messageIndex !== -1) {
            // If message exists, update it
            const updatedMessages = [...session.messages];
            updatedMessages[messageIndex] = message;

            return {
              ...session,
              messages: updatedMessages,
              updatedAt: new Date()
            };
          } else {
            // If message doesn't exist, add it
            return {
              ...session,
              messages: [...session.messages, message],
              updatedAt: new Date()
            };
          }
        }
        return session;
      });

      // Save updated sessions to localStorage
      localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));

      return updatedSessions;
    });
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Save sessions to local storage
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('chatSessions', JSON.stringify(sessions));
    }
  }, [sessions]);

  // Load knowledge base documents
  const loadKnowledgeBaseDocuments = async () => {
    setIsKnowledgeBaseLoading(true);
    
    if (socketRef.current) {
      socketRef.current.emit('kb-get-documents');
    } else {
      try {
        const response = await axios.get(`${SOCKET_URL}/api/kb/documents`);
        setKnowledgeBaseDocuments(response.data.documents || []);
      } catch (error) {
        console.error('Error loading knowledge base documents:', error);
        setError('Failed to load knowledge base documents');
      } finally {
        setIsKnowledgeBaseLoading(false);
      }
    }
    
    // Also load stats
    try {
      const response = await axios.get(`${SOCKET_URL}/api/kb/stats`);
      setKnowledgeBaseStats(response.data.knowledgeBase.vectorStats);
    } catch (error) {
      console.error('Error loading knowledge base stats:', error);
    }
  };
  
  // Delete document from knowledge base
  const deleteKnowledgeBaseDocument = async (documentId: string) => {
    if (socketRef.current) {
      socketRef.current.emit('kb-delete-document', { documentId });
    } else {
      try {
        await axios.delete(`${SOCKET_URL}/api/kb/documents/${documentId}`);
        setKnowledgeBaseDocuments(prev => 
          prev.filter(doc => doc.id !== documentId)
        );
      } catch (error) {
        console.error('Error deleting document:', error);
        setError('Failed to delete document');
      }
    }
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() && attachments.length === 0) return;
    
    // If already generating, stop first
    if (isLoading) {
      stopGeneration();
      
      // Short delay to let server process the stop request
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Create user message
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: new Date()
    };
    
    // Create empty assistant message
    const emptyAssistantMessage: Message = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: new Date()
    };
    
    // Update local message array
    setMessages(prev => {
      // Check if there's already an empty assistant message at the end
      const lastMessage = prev[prev.length - 1];
      if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content === '') {
        // Replace it with new message pair
        return [...prev.slice(0, -1), userMessage, emptyAssistantMessage];
      }
      // Otherwise just add new messages
      return [...prev, userMessage, emptyAssistantMessage];
    });
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Prepare message history for API
      const messageHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      
      // Add new user message
      messageHistory.push({
        role: 'user',
        content
      });
      
      // Clear duplicate files state when sending a message
      setDuplicateFiles({});
      
      // Send message via Socket.IO with selected model
      socketRef.current?.emit('chat-message', {
        sessionId: currentSessionId,
        messages: messageHistory,
        attachments,
        model: selectedModel
      });
      
      // Clear attachments after sending
      setAttachments([]);
      
      // Update or create session
      const sessionExists = sessions.some(session => session.id === currentSessionId);
      if (sessionExists) {
        setSessions(prevSessions => 
          prevSessions.map(session => 
            session.id === currentSessionId 
              ? { 
                  ...session, 
                  messages: [...session.messages.filter(msg => 
                    // Remove any empty assistant messages before adding new ones
                    !(msg.role === 'assistant' && msg.content === '')
                  ), userMessage, emptyAssistantMessage], 
                  updatedAt: new Date(),
                  title: content.slice(0, 30) + (content.length > 30 ? '...' : '')
                }
              : session
          )
        );
      } else {
        const newSession: ChatSession = {
          id: currentSessionId,
          title: content.slice(0, 30) + (content.length > 30 ? '...' : ''),
          messages: [userMessage, emptyAssistantMessage],
          createdAt: new Date(),
          updatedAt: new Date()
        };
        setSessions(prev => [...prev, newSession]);
      }
      
      // Save sessions to localStorage after update
      setTimeout(() => {
        localStorage.setItem('chatSessions', JSON.stringify(sessions));
      }, 100);
      
    } catch (err) {
      setError('Failed to send message. Please try again.');
      setIsLoading(false);
      
      // Remove empty assistant message on error
      setMessages(prev => prev.filter(msg => 
        !(msg.id === emptyAssistantMessage.id && msg.content === '')
      ));
    }
  };

  // Stop generation
  const stopGeneration = () => {
    if (socketRef.current && isLoading) {
      // Send stop event to server
      socketRef.current.emit('stop-generation', { sessionId: currentSessionId });

      // Add note to last message
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          const updatedMessage = {
            ...lastMessage,
            content: lastMessage.content + "\n\n*Генерация была остановлена*"
          };

          // Update session with this message
          updateSessionWithMessage(updatedMessage);

          return [...prev.slice(0, -1), updatedMessage];
        }
        return prev;
      });
    }
  };

  const startNewChat = () => {
    // If generating, stop first
    if (isLoading) {
      stopGeneration();
    }

    const newSessionId = uuidv4();

    // Save current session before creating new one
    if (currentSessionId && messages.length > 0) {
      setSessions(prevSessions => {
        const updatedSessions = prevSessions.map(session =>
          session.id === currentSessionId
            ? { ...session, messages: [...messages], updatedAt: new Date() }
            : session
        );

        localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
        return updatedSessions;
      });
    }

    // Set new session
    setCurrentSessionId(newSessionId);
    setMessages([]);
    setAttachments([]);
    setDuplicateFiles({});

    // Create new session
    const newSession: ChatSession = {
      id: newSessionId,
      title: 'New chat',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    setSessions(prev => [...prev, newSession]);

    // Notify server of session change
    if (socketRef.current) {
      socketRef.current.emit('change-session', { sessionId: newSessionId });
    }
  };

  const loadSession = (sessionId: string) => {
    // If generating, stop first
    if (isLoading) {
      stopGeneration();
    }

    // Save current session before switching
    if (currentSessionId && messages.length > 0) {
      setSessions(prevSessions => {
        const updatedSessions = prevSessions.map(session =>
          session.id === currentSessionId
            ? { ...session, messages: [...messages], updatedAt: new Date() }
            : session
        );

        localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
        return updatedSessions;
      });
    }

    // Load selected session
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      setCurrentSessionId(sessionId);
      setMessages([...session.messages]);
      setAttachments([]);
      setDuplicateFiles({});

      // Notify server of session change
      if (socketRef.current) {
        socketRef.current.emit('change-session', { sessionId });
      }
    }
  };

  const handleFileUpload = (files: File[]) => {
    // Process files
    Array.from(files).forEach(async file => {
      // For text files, read content
      if (file.type.startsWith('text/') ||
        file.type === 'application/json' ||
        file.type === 'application/xml' ||
        file.name.toLowerCase().endsWith('.csv') ||
        file.name.toLowerCase().endsWith('.html') ||
        file.name.toLowerCase().endsWith('.htm') ||
        file.name.toLowerCase().endsWith('.md') ||
        file.name.toLowerCase().endsWith('.txt') ||
        file.name.toLowerCase().endsWith('.js') ||
        file.name.toLowerCase().endsWith('.jsx') ||
        file.name.toLowerCase().endsWith('.ts') ||
        file.name.toLowerCase().endsWith('.tsx') ||
        file.name.toLowerCase().endsWith('.json')) {
        
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          
          // Determine file type based on extension if not provided
          let fileType = file.type;
          if (!fileType || fileType === 'application/octet-stream') {
            const ext = file.name.split('.').pop()?.toLowerCase();
            if (ext === 'csv') fileType = 'text/csv';
            else if (ext === 'html' || ext === 'htm') fileType = 'text/html';
            else if (ext === 'json') fileType = 'application/json';
            else if (ext === 'md') fileType = 'text/markdown';
            else if (ext === 'js' || ext === 'jsx') fileType = 'application/javascript';
            else if (ext === 'ts' || ext === 'tsx') fileType = 'application/typescript';
            else fileType = 'text/plain';
          }
          
          setAttachments(prev => [
            ...prev,
            {
              id: uuidv4(),
              name: file.name,
              type: fileType,
              size: file.size,
              content
            }
          ]);
        };
        reader.readAsText(file);
      } else {
        // For binary files, just store metadata
        setAttachments(prev => [
          ...prev,
          {
            id: uuidv4(),
            name: file.name,
            type: file.type,
            size: file.size
          }
        ]);
      }
    });
  };

  const removeAttachment = (id: string) => {
    const fileToRemove = attachments.find(att => att.id === id);
    
    // Remove the attachment
    setAttachments(prevAttachments => prevAttachments.filter(file => file.id !== id));
    
    // Also remove any duplicate file notifications for this attachment
    if (fileToRemove) {
      setDuplicateFiles(prev => {
        // Create a new object with explicit typing
        const newState: {[fileName: string]: string} = {};
        
        // Copy all entries except the one to remove
        Object.keys(prev).forEach(key => {
          if (key !== fileToRemove.name) {
            newState[key] = prev[key];
          }
        });
        
        return newState;
      });
    }
  };

  const deleteChat = (sessionId: string) => {
    // Delete session from list
    setSessions(prevSessions => {
      // Check if we're trying to delete the last chat
      if (prevSessions.length <= 1) {
        // Create a new one before deleting
        const newSessionId = uuidv4();
        const newSession: ChatSession = {
          id: newSessionId,
          title: 'New chat',
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // If deleting current session, switch to new one
        if (sessionId === currentSessionId) {
          setCurrentSessionId(newSessionId);
          setMessages([]);
          setAttachments([]);
          setDuplicateFiles({});

          // Notify server of session change
          if (socketRef.current) {
            socketRef.current.emit('change-session', { sessionId: newSessionId });
          }
        }

        // Return new array with new session, without deleted one
        return [newSession, ...prevSessions.filter(session => session.id !== sessionId)];
      }

      // If not the last chat, just delete
      const filteredSessions = prevSessions.filter(session => session.id !== sessionId);

      // If deleting current session, switch to first available
      if (sessionId === currentSessionId && filteredSessions.length > 0) {
        const newCurrentSession = filteredSessions[0];
        setCurrentSessionId(newCurrentSession.id);
        setMessages([...newCurrentSession.messages]);
        setAttachments([]);
        setDuplicateFiles({});

        // Notify server of session change
        if (socketRef.current) {
          socketRef.current.emit('change-session', { sessionId: newCurrentSession.id });
        }
      }

      return filteredSessions;
    });
  };
  
  // Change selected model
  const changeModel = (modelId: string) => {
    setSelectedModel(modelId);
    console.log(`Model changed to ${modelId}`);
  };
  
  // Refresh knowledge base
  const refreshKnowledgeBase = () => {
    loadKnowledgeBaseDocuments();
  };

  return {
    messages,
    isLoading,
    error,
    currentSessionId,
    sessions,
    attachments,
    models,
    selectedModel,
    duplicateFiles,
    knowledgeBaseDocuments,
    knowledgeBaseStats,
    isKnowledgeBaseLoading,
    sendMessage,
    startNewChat,
    loadSession,
    handleFileUpload,
    removeAttachment,
    deleteChat,
    stopGeneration,
    changeModel,
    loadKnowledgeBaseDocuments: refreshKnowledgeBase,
    deleteKnowledgeBaseDocument,
    messagesEndRef
  };
};

export default useChat;