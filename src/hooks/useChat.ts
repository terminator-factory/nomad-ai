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
          newMessages[newMessages.length - 1] = {
            ...lastMessage,
            content: lastMessage.content + chunk
          };
        } else {
          // Create new message
          newMessages.push({
            id: uuidv4(),
            role: 'assistant',
            content: chunk,
            timestamp: new Date()
          });
        }
        
        return newMessages;
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
    
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);
    
    try {
      // Prepare history for the API
      const messageHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      
      // Add new user message
      messageHistory.push({
        role: 'user',
        content
      });
      
      // Add empty assistant message that will be filled with streaming content
      setMessages(prev => [
        ...prev,
        {
          id: uuidv4(),
          role: 'assistant',
          content: '',
          timestamp: new Date()
        }
      ]);
      
      // Send message via Socket.IO
      socketRef.current?.emit('chat-message', {
        sessionId: currentSessionId,
        messages: messageHistory,
        attachments
      });
      
      // Clear attachments after sending
      setAttachments([]);
      
      // Update or create session
      const sessionExists = sessions.some(session => session.id === currentSessionId);
      if (sessionExists) {
        setSessions(prevSessions => 
          prevSessions.map(session => 
            session.id === currentSessionId 
              ? { ...session, messages: [...session.messages, userMessage], updatedAt: new Date() }
              : session
          )
        );
      } else {
        const newSession: ChatSession = {
          id: currentSessionId,
          title: content.slice(0, 30) + (content.length > 30 ? '...' : ''),
          messages: [userMessage],
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
    const newSessionId = uuidv4();
    setCurrentSessionId(newSessionId);
    setMessages([]);
    setAttachments([]);
  };
  
  const loadSession = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      setCurrentSessionId(sessionId);
      setMessages(session.messages);
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
    messagesEndRef
  };
};

export default useChat;