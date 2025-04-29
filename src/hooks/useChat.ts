// frontend/hooks/useChat.ts
import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
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

// Настраиваем WebSocket URL с учетом возможной необходимости HTTP-прокси
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3001';
const WS_URL = SOCKET_URL.replace(/^http/, 'ws');

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
  const [duplicateFiles, setDuplicateFiles] = useState<{ [fileName: string]: string }>({});

  const webSocketRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const isConnectingRef = useRef<boolean>(false);

  // Обработчик сообщений WebSocket
  const handleWebsocketMessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      const messageType = data.type;

      switch (messageType) {
        case 'connection-established':
          console.log('WebSocket соединение установлено:', data.connectionId);
          break;

        case 'message-chunk':
          // Обрабатываем чанк сообщения
          setMessages(prevMessages => {
            const newMessages = [...prevMessages];
            const lastMessage = newMessages[newMessages.length - 1];

            if (lastMessage && lastMessage.role === 'assistant') {
              // Дополняем существующее сообщение
              const updatedMessage: Message = {
                ...lastMessage,
                content: lastMessage.content + data.content
              };
              newMessages[newMessages.length - 1] = updatedMessage;

              // Обновляем сессию
              updateSessionWithMessage(updatedMessage);
              return newMessages;
            } else {
              // Создаем новое сообщение
              const newAssistantMessage: Message = {
                id: uuidv4(),
                role: 'assistant',
                content: data.content,
                timestamp: new Date()
              };
              newMessages.push(newAssistantMessage);

              // Обновляем сессию
              updateSessionWithMessage(newAssistantMessage);
              return newMessages;
            }
          });
          break;

        case 'message-complete':
          // Завершаем генерацию
          setIsLoading(false);
          break;

        case 'error':
          // Обрабатываем ошибку
          setError(data.error);
          setIsLoading(false);
          break;

        case 'kb-documents':
          // Обновляем список документов в базе знаний
          setKnowledgeBaseDocuments(data.documents || []);
          setIsKnowledgeBaseLoading(false);
          break;

        case 'kb-document-deleted':
          // Удаляем документ из списка
          setKnowledgeBaseDocuments(prev =>
            prev.filter(doc => doc.id !== data.documentId)
          );
          break;

        case 'pong':
          // Получен ответ на ping, соединение активно
          console.log('Получен pong от сервера, соединение активно');
          break;

        default:
          console.log(`Получен тип сообщения: ${messageType}`, data);
      }
    } catch (error) {
      console.error('Ошибка при обработке сообщения WebSocket:', error);
      setError('Ошибка при обработке ответа от сервера');
    }
  };

  // Функция для подключения WebSocket
  const connectWebSocket = () => {
    if (isConnectingRef.current) return;
    
    isConnectingRef.current = true;
    console.log('Подключение к WebSocket серверу:', `${WS_URL}/ws`);
    
    try {
      const ws = new WebSocket(`${WS_URL}/ws`);
      webSocketRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket соединение установлено');
        isConnectingRef.current = false;
        
        // Очищаем таймер переподключения
        if (reconnectTimerRef.current) {
          window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        
        // После подключения запрашиваем модели и документы базы знаний
        loadModels();
        loadKnowledgeBaseDocuments();
        
        // Запускаем ping для поддержания соединения
        startPingInterval();
      };

      ws.onmessage = handleWebsocketMessage;

      ws.onerror = (error) => {
        console.error('Ошибка WebSocket:', error);
        isConnectingRef.current = false;
        setError('Ошибка соединения с сервером. Автоматическое переподключение...');
        
        // Пробуем переподключиться через RESTful API
        loadModels();
      };

      ws.onclose = (event) => {
        console.log(`WebSocket соединение закрыто. Код: ${event.code}, Причина: ${event.reason}`);
        isConnectingRef.current = false;
        
        // Пробуем переподключиться через 3 секунды, если это не было явное закрытие
        if (event.code !== 1000) {
          reconnectTimerRef.current = window.setTimeout(() => {
            if (webSocketRef.current === ws) {
              console.log('Попытка переподключения к WebSocket...');
              connectWebSocket();
            }
          }, 3000);
        }
      };
    } catch (error) {
      console.error('Ошибка при создании WebSocket соединения:', error);
      isConnectingRef.current = false;
      setError('Не удалось подключиться к серверу. Повторная попытка через 5 секунд...');
      
      // Повторная попытка через 5 секунд
      reconnectTimerRef.current = window.setTimeout(() => {
        connectWebSocket();
      }, 5000);
    }
  };
  
  // Функция для отправки ping
  const startPingInterval = () => {
    const pingInterval = setInterval(() => {
      if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
        try {
          webSocketRef.current.send(JSON.stringify({
            type: 'ping',
            timestamp: new Date().getTime()
          }));
        } catch (error) {
          console.error('Ошибка при отправке ping:', error);
          clearInterval(pingInterval);
        }
      } else {
        // Если соединение закрыто, останавливаем интервал
        clearInterval(pingInterval);
      }
    }, 30000); // Каждые 30 секунд
    
    // Очищаем интервал при размонтировании
    return () => clearInterval(pingInterval);
  };

  useEffect(() => {
    // Инициализация WebSocket при монтировании компонента
    connectWebSocket();

    // Загружаем сессии из локального хранилища
    const savedSessions = localStorage.getItem('chatSessions');
    if (savedSessions) {
      try {
        setSessions(JSON.parse(savedSessions));
      } catch (e) {
        console.error('Ошибка при разборе сохраненных сессий:', e);
        localStorage.removeItem('chatSessions');
      }
    }

    return () => {
      // Закрываем соединение при размонтировании
      if (webSocketRef.current) {
        webSocketRef.current.close();
      }
      
      // Очищаем таймер переподключения
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Save sessions to local storage
  useEffect(() => {
    if (sessions.length > 0) {
      try {
        localStorage.setItem('chatSessions', JSON.stringify(sessions));
      } catch (e) {
        console.error('Ошибка при сохранении сессий в localStorage:', e);
      }
    }
  }, [sessions]);

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
      try {
        localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
      } catch (e) {
        console.error('Ошибка при сохранении сессий в localStorage:', e);
      }
      
      return updatedSessions;
    });
  };

  // Загрузка доступных моделей
  const loadModels = async () => {
    try {
      const response = await axios.get(`${SOCKET_URL}/api/models`);
      if (response.data && Array.isArray(response.data.models)) {
        setModels(response.data.models);
        
        // Устанавливаем модель по умолчанию, если доступна
        if (response.data.models.length > 0) {
          setSelectedModel(response.data.models[0].id);
        }
      }
    } catch (error) {
      console.error('Ошибка при загрузке моделей:', error);
      // Устанавливаем модели по умолчанию в случае ошибки
      setModels([
        { id: 'gemma3:4b', name: 'Жека', description: 'Модель по умолчанию' }
      ]);
    }
  };

  // Загрузка документов базы знаний
  const loadKnowledgeBaseDocuments = async () => {
    setIsKnowledgeBaseLoading(true);

    try {
      // Пробуем получить документы через WebSocket
      if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
        webSocketRef.current.send(JSON.stringify({ type: 'kb-get-documents' }));
      } else {
        // Запасной вариант через REST API
        const response = await axios.get(`${SOCKET_URL}/api/kb/documents`);
        setKnowledgeBaseDocuments(response.data.documents || []);
        setIsKnowledgeBaseLoading(false);
      }

      // Также загружаем статистику
      try {
        const statsResponse = await axios.get(`${SOCKET_URL}/api/kb/stats`);
        setKnowledgeBaseStats(statsResponse.data.knowledgeBase.vectorStats);
      } catch (error) {
        console.error('Ошибка при загрузке статистики базы знаний:', error);
      }
    } catch (error) {
      console.error('Ошибка при загрузке документов базы знаний:', error);
      setError('Не удалось загрузить документы базы знаний');
      setIsKnowledgeBaseLoading(false);
    }
  };

  // Удаление документа из базы знаний
  const deleteKnowledgeBaseDocument = async (documentId: string) => {
    try {
      // Пробуем удалить через WebSocket
      if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
        webSocketRef.current.send(JSON.stringify({ 
          type: 'kb-delete-document', 
          documentId 
        }));
      } else {
        // Запасной вариант через REST API
        await axios.delete(`${SOCKET_URL}/api/kb/documents/${documentId}`);
        setKnowledgeBaseDocuments(prev =>
          prev.filter(doc => doc.id !== documentId)
        );
      }
    } catch (error) {
      console.error('Ошибка при удалении документа:', error);
      setError('Не удалось удалить документ');
    }
  };

  // Отправка сообщения
  const sendMessage = async (content: string) => {
    if ((!content.trim() && attachments.length === 0)) {
      console.log('Пустое сообщение или нет WebSocket соединения');
      return;
    }
    
    // Проверяем состояние WebSocket
    if (!webSocketRef.current || webSocketRef.current.readyState !== WebSocket.OPEN) {
      console.log('WebSocket соединение не установлено, попытка переподключения...');
      setError('Соединение с сервером потеряно. Переподключение...');
      
      // Попытка переподключения
      connectWebSocket();
      
      // Выходим из метода, пользователь должен повторить попытку
      return;
    }

    // Если уже идет генерация, останавливаем
    if (isLoading) {
      stopGeneration();
      // Даем время серверу обработать запрос остановки
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
      // Проверяем, есть ли уже пустое сообщение ассистента в конце
      const lastMessage = prev[prev.length - 1];
      if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content === '') {
        // Заменяем его новой парой сообщений
        return [...prev.slice(0, -1), userMessage, emptyAssistantMessage];
      }
      // Иначе просто добавляем новые сообщения
      return [...prev, userMessage, emptyAssistantMessage];
    });

    setIsLoading(true);
    setError(null);

    try {
      // Подготовка истории сообщений для API
      const messageHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Добавляем новое сообщение пользователя
      messageHistory.push({
        role: 'user',
        content
      });

      // Сбрасываем информацию о дубликатах файлов
      setDuplicateFiles({});

      // Отправляем сообщение через WebSocket
      const messageData = {
        type: 'chat-message',
        sessionId: currentSessionId,
        messages: messageHistory,
        attachments,
        model: selectedModel
      };

      webSocketRef.current.send(JSON.stringify(messageData));

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
                    // Удаляем пустые сообщения ассистента перед добавлением новых
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

      // Сохраняем сессии в localStorage
      setTimeout(() => {
        try {
          localStorage.setItem('chatSessions', JSON.stringify(sessions));
        } catch (e) {
          console.error('Ошибка при сохранении сессий в localStorage:', e);
        }
      }, 100);

    } catch (err) {
      console.error('Ошибка при отправке сообщения:', err);
      setError('Не удалось отправить сообщение. Проверьте соединение и попробуйте снова.');
      setIsLoading(false);

      // Удаляем пустое сообщение ассистента при ошибке
      setMessages(prev => prev.filter(msg =>
        !(msg.id === emptyAssistantMessage.id && msg.content === '')
      ));
    }
  };

  // Остановка генерации
  const stopGeneration = () => {
    if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
      console.log("Отправляем запрос на остановку генерации");
      
      // Отправляем запрос на остановку
      webSocketRef.current.send(JSON.stringify({
        type: 'stop-generation',
        sessionId: currentSessionId,
        timestamp: new Date().getTime()
      }));
      
      // Добавляем примечание к последнему сообщению
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          const updatedMessage = {
            ...lastMessage,
            content: lastMessage.content + "\n\n*Генерация была остановлена пользователем*"
          };
          
          // Обновляем сессию
          updateSessionWithMessage(updatedMessage);
          
          return [...prev.slice(0, -1), updatedMessage];
        }
        return prev;
      });
      
      // Сбрасываем состояние загрузки
      setIsLoading(false);
    }
  };

  // Начало нового чата
  const startNewChat = () => {
    // Если идет генерация, останавливаем
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

        try {
          localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
        } catch (e) {
          console.error('Ошибка при сохранении сессий в localStorage:', e);
        }
        
        return updatedSessions;
      });
    }

    // Устанавливаем новую сессию
    setCurrentSessionId(newSessionId);
    setMessages([]);
    setAttachments([]);
    setDuplicateFiles({});

    // Создаем новую сессию
    const newSession: ChatSession = {
      id: newSessionId,
      title: 'Новый чат',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    setSessions(prev => [...prev, newSession]);

    // Уведомляем сервер о смене сессии
    if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
      webSocketRef.current.send(JSON.stringify({
        type: 'change-session',
        sessionId: newSessionId
      }));
    }
  };

  // Загрузка сессии
  const loadSession = (sessionId: string) => {
    // Если идет генерация, останавливаем
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

        try {
          localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
        } catch (e) {
          console.error('Ошибка при сохранении сессий в localStorage:', e);
        }
        
        return updatedSessions;
      });
    }

    // Загружаем выбранную сессию
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      setCurrentSessionId(sessionId);
      setMessages([...session.messages]);
      setAttachments([]);
      setDuplicateFiles({});

      // Уведомляем сервер о смене сессии
      if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
        webSocketRef.current.send(JSON.stringify({
          type: 'change-session',
          sessionId
        }));
      }
    }
  };

  // Обработка загрузки файлов
  const handleFileUpload = (files: File[]) => {
    // Обработка файлов
    Array.from(files).forEach(async file => {
      // Для текстовых файлов читаем содержимое
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

          // Определяем тип файла по расширению, если не указан
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
        
        reader.onerror = () => {
          console.error(`Ошибка при чтении файла: ${file.name}`);
          setError(`Не удалось прочитать файл: ${file.name}`);
        };
        
        reader.readAsText(file);
      } else {
        // Для бинарных файлов сохраняем только метаданные
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

  // Удаление вложения
  const removeAttachment = (id: string) => {
    const fileToRemove = attachments.find(att => att.id === id);

    // Удаляем вложение
    setAttachments(prevAttachments => prevAttachments.filter(file => file.id !== id));

    // Удаляем информацию о дубликатах для этого вложения
    if (fileToRemove) {
      setDuplicateFiles(prev => {
        const newState: { [fileName: string]: string } = {};
        
        // Копируем все записи, кроме удаляемой
        Object.keys(prev).forEach(key => {
          if (key !== fileToRemove.name) {
            newState[key] = prev[key];
          }
        });
        
        return newState;
      });
    }
  };

  // Удаление чата
  const deleteChat = (sessionId: string) => {
    // Удаление сессии из списка
    setSessions(prevSessions => {
      // Проверяем, пытаемся ли удалить последний чат
      if (prevSessions.length <= 1) {
        // Создаем новый перед удалением
        const newSessionId = uuidv4();
        const newSession: ChatSession = {
          id: newSessionId,
          title: 'Новый чат',
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Если удаляем текущую сессию, переключаемся на новую
        if (sessionId === currentSessionId) {
          setCurrentSessionId(newSessionId);
          setMessages([]);
          setAttachments([]);
          setDuplicateFiles({});

          // Уведомляем сервер о смене сессии
          if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
            webSocketRef.current.send(JSON.stringify({
              type: 'change-session',
              sessionId: newSessionId
            }));
          }
        }

        // Возвращаем новый массив с новой сессией, без удаленной
        return [newSession, ...prevSessions.filter(session => session.id !== sessionId)];
      }

      // Если не последний чат, просто удаляем
      const filteredSessions = prevSessions.filter(session => session.id !== sessionId);

      // Если удаляем текущую сессию, переключаемся на первую доступную
      if (sessionId === currentSessionId && filteredSessions.length > 0) {
        const newCurrentSession = filteredSessions[0];
        setCurrentSessionId(newCurrentSession.id);
        setMessages([...newCurrentSession.messages]);
        setAttachments([]);
        setDuplicateFiles({});

        // Уведомляем сервер о смене сессии
        if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
          webSocketRef.current.send(JSON.stringify({
            type: 'change-session',
            sessionId: newCurrentSession.id
          }));
        }
      }

      return filteredSessions;
    });
  };

  // Смена выбранной модели
  const changeModel = (modelId: string) => {
    setSelectedModel(modelId);
    console.log(`Модель изменена на ${modelId}`);
  };

  // Обновление базы знаний
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