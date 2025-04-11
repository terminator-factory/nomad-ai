// src/components/Chat.tsx
import React, { useState, useEffect } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { PaperAirplaneIcon, PlusIcon } from '@heroicons/react/24/solid';
import ChatMessage from './ChatMessage';
import FileUpload from './FileUpload';
import ModelSelector from './ModelSelector';
import useChat from '../hooks/useChat';
import { FileAttachment } from '../types';

const models = [
  {
    id: 'gemma3:4b',
    name: 'Gemma 3 4B',
    description: 'Быстрая модель для общих задач'
  },
  // Другие модели можно добавить здесь
];

const Chat: React.FC = () => {
  const {
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
  } = useChat();
  
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(models[0].id);
  const [showSidebar, setShowSidebar] = useState(window.innerWidth >= 768);
  
  useEffect(() => {
    const handleResize = () => {
      setShowSidebar(window.innerWidth >= 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() || attachments.length > 0) {
      sendMessage(input);
      setInput('');
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };
  
  const removeAttachment = (id: string) => {
    // Предполагается, что setAttachments доступна через useChat
    // Или ее нужно определить в компоненте
    const newAttachments = attachments.filter(file => file.id !== id);
    // Здесь нужно обновить attachments в useChat
  };
  
  // Функция для задания имени чата из первого сообщения пользователя
  const getChatTitle = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return 'New chat';
    
    const firstUserMessage = session.messages.find(m => m.role === 'user');
    if (!firstUserMessage) return 'New chat';
    
    const title = firstUserMessage.content.slice(0, 30);
    return title.length < firstUserMessage.content.length 
      ? title + '...' 
      : title;
  };
  
  return (
    <div className="flex h-screen bg-chat-bg text-white">
      {/* Sidebar */}
      {showSidebar && (
        <div className="w-64 bg-gray-900 flex flex-col">
          <div className="p-4">
            <button
              onClick={startNewChat}
              className="w-full flex items-center justify-center gap-2 border border-gray-700 rounded-md py-2 hover:bg-gray-800"
            >
              <PlusIcon className="h-4 w-4" />
              <span>New chat</span>
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2">
            <div className="space-y-2">
              {sessions.slice().reverse().map((session) => (
                <button
                  key={session.id}
                  onClick={() => loadSession(session.id)}
                  className={`w-full text-left p-2 rounded-md hover:bg-gray-800 ${
                    session.id === currentSessionId ? 'bg-gray-800' : ''
                  }`}
                >
                  <div className="truncate text-sm">{getChatTitle(session.id)}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Chat header */}
        <div className="h-14 border-b border-gray-700 flex items-center px-4">
          {!showSidebar && (
            <button
              onClick={() => setShowSidebar(true)}
              className="mr-4 text-gray-400 hover:text-white"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          )}
          
          <div className="font-medium">
            {currentSessionId ? getChatTitle(currentSessionId) : 'New chat'}
          </div>
        </div>
        
        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md">
                <h2 className="text-2xl font-bold mb-2">Как я могу помочь вам сегодня?</h2>
                <p className="text-gray-400">
                  Задайте мне вопрос или попросите рассказать о чем-нибудь интересном.
                </p>
              </div>
            </div>
          )}
          
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          
          {isLoading && (
            <div className="py-4 px-4 flex justify-center">
              <div className="dot-typing"></div>
            </div>
          )}
          
          {error && (
            <div className="py-4 px-4">
              <div className="bg-red-900/50 border border-red-700 rounded-md p-3 text-sm">
                {error}
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef}></div>
        </div>
        
        {/* Input area */}
        <div className="border-t border-gray-700 p-4">
          {/* Model selector */}
          <div className="mb-3">
            <ModelSelector
              models={models}
              selectedModel={selectedModel}
              onModelSelect={setSelectedModel}
            />
          </div>
          
          {/* File upload */}
          <div className="mb-3">
            <FileUpload
              attachments={attachments}
              onFileUpload={handleFileUpload}
              onRemoveAttachment={removeAttachment}
            />
          </div>
          
          <form onSubmit={handleSubmit} className="relative">
            <TextareaAutosize
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Напишите сообщение..."
              className="w-full rounded-md bg-input-bg border border-gray-700 focus:border-button-primary focus:ring-1 focus:ring-button-primary py-3 pl-4 pr-12 text-white resize-none focus:outline-none"
              maxRows={5}
              minRows={1}
            />
            <button
              type="submit"
              className="absolute right-2 bottom-2.5 rounded-md p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
              disabled={isLoading || (!input.trim() && attachments.length === 0)}
            >
              <PaperAirplaneIcon className="h-5 w-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Chat;