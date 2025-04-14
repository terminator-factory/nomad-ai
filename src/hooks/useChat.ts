// src/hooks/useChat.ts
import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import io, { Socket } from 'socket.io-client';
import { Message, FileAttachment, ChatSession } from '../types';

interface UseChatProps {
  initialMessages?: Message[];
  sessionId?: string;
}

const useChat = ({ initialMessages = [], sessionId = uuidv4() }: UseChatProps = {}) => {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string>(sessionId);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Connect to Socket.IO server
    socketRef.current = io('http://localhost:3001');
    
    // Handle incoming message streams
    socketRef.current.on('message-chunk', (chunk: string) => {
      setMessages(prevMessages => {
        const newMessages = [...prevMessages];
        const lastMessage = newMessages[newMessages.length - 1];
        
        if (lastMessage && lastMessage.role === 'assistant') {
          // Обновляем существующее сообщение
          const updatedMessage: Message = {
            ...lastMessage,
            content: lastMessage.content + chunk
          };
          newMessages[newMessages.length - 1] = updatedMessage;
          
          // Ключевой момент: обновляем сессию с каждым чанком
          // Это обеспечит, что текст ответа ИИ будет сохранен в localStorage
          const storedSessions = JSON.parse(localStorage.getItem('chatSessions') || '[]');
          const updatedSessions = storedSessions.map((session: ChatSession) => {
            if (session.id === currentSessionId) {
              // Находим то же сообщение в сессии по ID
              const sessionMessages = [...session.messages];
              const messageIndex = sessionMessages.findIndex(msg => msg.id === lastMessage.id);
              
              // Если сообщение найдено, обновляем его
              if (messageIndex !== -1) {
                sessionMessages[messageIndex] = updatedMessage;
              } else {
                // Если сообщение не найдено, добавляем его
                sessionMessages.push(updatedMessage);
              }
              
              return {
                ...session,
                messages: sessionMessages,
                updatedAt: new Date()
              };
            }
            return session;
          });
          
          // Сохраняем обновленные сессии в localStorage
          localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
          // Также обновляем состояние сессий в компоненте
          setSessions(updatedSessions);
        }
        
        return newMessages;
      });
    });
    
    
    // Обработчик message-complete
    socketRef.current.on('message-complete', () => {
      setIsLoading(false);
      // Больше ничего тут не делаем, так как обновление сессии происходит в message-chunk
    });
    
    socketRef.current.on('error', (errorMsg: string) => {
      setError(errorMsg);
      setIsLoading(false);
    });
    
    // Load sessions from local storage
    const savedSessions = localStorage.getItem('chatSessions');
    if (savedSessions) {
      setSessions(JSON.parse(savedSessions));
    }
    
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);
  
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
  
  const sendMessage = async (content: string) => {
    if (!content.trim() && attachments.length === 0) return;
    
    // Add user message to state
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: new Date()
    };
    
    // Создаем пустое сообщение ассистента сразу
    const emptyAssistantMessage: Message = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: new Date()
    };
    
    // Добавляем оба сообщения в локальное состояние
    setMessages(prev => [...prev, userMessage, emptyAssistantMessage]);
    setIsLoading(true);
    setError(null);
    
    try {
      // Prepare history for the API
      const messageHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      
      // Add new user message to history
      messageHistory.push({
        role: 'user',
        content
      });
      
      // Send message via Socket.IO
      socketRef.current?.emit('chat-message', {
        sessionId: currentSessionId,
        messages: messageHistory,
        attachments
      });
      
      // Clear attachments after sending
      setAttachments([]);
      
      // Update or create session - ВАЖНОЕ ИЗМЕНЕНИЕ ЗДЕСЬ
      const sessionExists = sessions.some(session => session.id === currentSessionId);
      if (sessionExists) {
        setSessions(prevSessions => 
          prevSessions.map(session => 
            session.id === currentSessionId 
              ? { 
                  ...session, 
                  // Добавляем ОБОИХ сообщений - пользователя и пустое сообщение ассистента
                  messages: [...session.messages, userMessage, emptyAssistantMessage], 
                  updatedAt: new Date(),
                  // Обновляем заголовок сессии
                  title: content.slice(0, 30) + (content.length > 30 ? '...' : '')
                }
              : session
          )
        );
      } else {
        const newSession: ChatSession = {
          id: currentSessionId,
          title: content.slice(0, 30) + (content.length > 30 ? '...' : ''),
          // Включаем оба сообщения в новую сессию
          messages: [userMessage, emptyAssistantMessage],
          createdAt: new Date(),
          updatedAt: new Date()
        };
        setSessions(prev => [...prev, newSession]);
      }
    } catch (err) {
      setError('Failed to send message. Please try again.');
      setIsLoading(false);
    }
  };
  
  const startNewChat = () => {
    // Создаем новый ID сессии
    const newSessionId = uuidv4();
    
    // Сохраняем все текущие сообщения в текущую сессию перед переключением
    if (currentSessionId && messages.length > 0) {
      setSessions(prevSessions => 
        prevSessions.map(session => 
          session.id === currentSessionId 
            ? { ...session, messages: [...messages], updatedAt: new Date() }
            : session
        )
      );
    }
    
    // Очищаем сообщения и вложения
    setMessages([]);
    setAttachments([]);
    
    // Устанавливаем новый ID сессии
    setCurrentSessionId(newSessionId);
    
    // Создаем новую пустую сессию
    const newSession: ChatSession = {
      id: newSessionId,
      title: 'New chat',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Добавляем новую сессию
    setSessions(prev => [...prev, newSession]);
  };
  
  const loadSession = (sessionId: string) => {
    // Сохраняем текущую сессию перед переключением
    if (currentSessionId && messages.length > 0) {
      setSessions(prevSessions => {
        const updatedSessions = prevSessions.map(session => 
          session.id === currentSessionId 
            ? { ...session, messages: [...messages], updatedAt: new Date() }
            : session
        );
        
        // Обновляем localStorage
        localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
        
        return updatedSessions;
      });
    }
    
    // Теперь загружаем сессию напрямую из localStorage для надежности
    const storedSessions = JSON.parse(localStorage.getItem('chatSessions') || '[]');
    const sessionToLoad = storedSessions.find((s: ChatSession) => s.id === sessionId);
    
    if (sessionToLoad) {
      setCurrentSessionId(sessionId);
      setMessages([...sessionToLoad.messages]); // Используем spread для создания новой копии
    }
  };
  
  const handleFileUpload = (files: File[]) => {
    // Process files
    Array.from(files).forEach(async file => {
      // For text files, read content
      if (file.type.startsWith('text/') || 
          file.type === 'application/json' || 
          file.type === 'application/xml') {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          setAttachments(prev => [
            ...prev,
            {
              id: uuidv4(),
              name: file.name,
              type: file.type,
              size: file.size,
              content
            }
          ]);
        };
        reader.readAsText(file);
      } else {
        // For other files, just store metadata
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
    setAttachments(prevAttachments => prevAttachments.filter(file => file.id !== id));
  };

  const deleteChat = (sessionId: string) => {
    // Удаляем сессию из списка сессий
    setSessions(prevSessions => {
      // Проверяем, не пытаемся ли удалить последний чат
      if (prevSessions.length <= 1) {
        // Если это последний чат, создаем новый перед удалением
        const newSessionId = uuidv4();
        const newSession: ChatSession = {
          id: newSessionId,
          title: 'New chat',
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        // Если удаляем текущую сессию, переключаемся на новую
        if (sessionId === currentSessionId) {
          setCurrentSessionId(newSessionId);
          setMessages([]);
        }
        
        // Возвращаем новый массив с новой сессией, без удаляемой
        return [newSession, ...prevSessions.filter(session => session.id !== sessionId)];
      }
      
      // Если не последний чат, просто удаляем
      const filteredSessions = prevSessions.filter(session => session.id !== sessionId);
      
      // Если удаляем текущую сессию, переключаемся на первую доступную
      if (sessionId === currentSessionId && filteredSessions.length > 0) {
        const newCurrentSession = filteredSessions[0];
        setCurrentSessionId(newCurrentSession.id);
        setMessages([...newCurrentSession.messages]);
      }
      
      return filteredSessions;
    });
  };
  
  
  // Убедитесь, что эта функция всегда возвращается из хука
  return {
    messages,
    isLoading,
    error,
    currentSessionId,
    sessions,
    attachments,
    sendMessage,
    startNewChat,
    loadSession,
    handleFileUpload,
    removeAttachment,
    deleteChat, // Новая функция
    messagesEndRef
  };
};

export default useChat;