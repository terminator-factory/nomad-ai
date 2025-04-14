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

    // Load sessions from local storage
    const savedSessions = localStorage.getItem('chatSessions');
    if (savedSessions) {
      setSessions(JSON.parse(savedSessions));
    }

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  // Helper function to update session with message
  const updateSessionWithMessage = (message: Message) => {
    setSessions(prevSessions => {
      const updatedSessions = prevSessions.map(session => {
        if (session.id === currentSessionId) {
          // Найдем сообщение в сессии по его id
          const messageIndex = session.messages.findIndex(msg => msg.id === message.id);

          if (messageIndex !== -1) {
            // Если сообщение существует, обновим его
            const updatedMessages = [...session.messages];
            updatedMessages[messageIndex] = message;

            return {
              ...session,
              messages: updatedMessages,
              updatedAt: new Date()
            };
          } else {
            // Если сообщения нет, добавим его
            return {
              ...session,
              messages: [...session.messages, message],
              updatedAt: new Date()
            };
          }
        }
        return session;
      });

      // Сохраняем обновленные сессии в localStorage
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

  // В функции sendMessage добавим проверку на isLoading
  const sendMessage = async (content: string) => {
    if (!content.trim() && attachments.length === 0) return;
    
    // Если уже идет генерация, сначала останавливаем ее
    if (isLoading) {
      stopGeneration();
      
      // Небольшая задержка, чтобы сервер успел обработать остановку
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Создаем сообщение пользователя
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: new Date()
    };
    
    // Создаем пустое сообщение ассистента
    const emptyAssistantMessage: Message = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: new Date()
    };
    
    // Обновляем локальный массив сообщений
    setMessages(prev => {
      // Проверяем, есть ли в конце пустое сообщение ассистента
      const lastMessage = prev[prev.length - 1];
      if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content === '') {
        // Если есть, заменяем его на новую пару сообщений
        return [...prev.slice(0, -1), userMessage, emptyAssistantMessage];
      }
      // Иначе просто добавляем новые сообщения
      return [...prev, userMessage, emptyAssistantMessage];
    });
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Подготавливаем историю сообщений для API
      const messageHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      
      // Добавляем новое сообщение пользователя
      messageHistory.push({
        role: 'user',
        content
      });
      
      // Отправляем сообщение через Socket.IO
      socketRef.current?.emit('chat-message', {
        sessionId: currentSessionId,
        messages: messageHistory,
        attachments
      });
      
      // Очищаем вложения после отправки
      setAttachments([]);
      
      // Обновляем или создаем сессию
      const sessionExists = sessions.some(session => session.id === currentSessionId);
      if (sessionExists) {
        setSessions(prevSessions => 
          prevSessions.map(session => 
            session.id === currentSessionId 
              ? { 
                  ...session, 
                  messages: [...session.messages.filter(msg => 
                    // Удаляем все пустые сообщения ассистента перед добавлением новых
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
      
      // Сохраняем сессии в localStorage после обновления
      setTimeout(() => {
        localStorage.setItem('chatSessions', JSON.stringify(sessions));
      }, 100);
      
    } catch (err) {
      setError('Failed to send message. Please try again.');
      setIsLoading(false);
      
      // Удаляем пустое сообщение ассистента при ошибке
      setMessages(prev => prev.filter(msg => 
        !(msg.id === emptyAssistantMessage.id && msg.content === '')
      ));
    }
  };

  // Остановка генерации ответа
  const stopGeneration = () => {
    if (socketRef.current && isLoading) {
      // Отправляем событие остановки генерации на сервер
      socketRef.current.emit('stop-generation', { sessionId: currentSessionId });

      // Добавляем примечание к последнему сообщению
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          const updatedMessage = {
            ...lastMessage,
            content: lastMessage.content + "\n\n*Генерация была остановлена*"
          };

          // Обновляем сессию с этим сообщением
          updateSessionWithMessage(updatedMessage);

          return [...prev.slice(0, -1), updatedMessage];
        }
        return prev;
      });
    }
  };

  const startNewChat = () => {
    // Если идет генерация, остановим ее
    if (isLoading) {
      stopGeneration();
    }

    const newSessionId = uuidv4();

    // Сохраняем текущую сессию перед созданием новой
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

    // Устанавливаем новую сессию
    setCurrentSessionId(newSessionId);
    setMessages([]);
    setAttachments([]);

    // Создаем новую сессию
    const newSession: ChatSession = {
      id: newSessionId,
      title: 'New chat',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    setSessions(prev => [...prev, newSession]);

    // Уведомляем сервер о смене сессии
    if (socketRef.current) {
      socketRef.current.emit('change-session', { sessionId: newSessionId });
    }
  };

  const loadSession = (sessionId: string) => {
    // Если идет генерация, остановим ее
    if (isLoading) {
      stopGeneration();
    }

    // Сохраняем текущую сессию перед переключением
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

    // Загружаем выбранную сессию
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      setCurrentSessionId(sessionId);
      setMessages([...session.messages]);

      // Уведомляем сервер о смене сессии
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

          // Уведомляем сервер о смене сессии
          if (socketRef.current) {
            socketRef.current.emit('change-session', { sessionId: newSessionId });
          }
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

        // Уведомляем сервер о смене сессии
        if (socketRef.current) {
          socketRef.current.emit('change-session', { sessionId: newCurrentSession.id });
        }
      }

      return filteredSessions;
    });
  };

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
    deleteChat,
    stopGeneration,
    messagesEndRef
  };
};

export default useChat;