// src/components/Chat.tsx
import React, { useState, useEffect } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { PaperAirplaneIcon, PlusIcon, TrashIcon, StopIcon } from '@heroicons/react/24/solid';
import ChatMessage from './ChatMessage';
import FileUpload from './FileUpload';
import ModelSelector from './ModelSelector';
import useChat from '../hooks/useChat';
import { FileAttachment } from '../types';

const models = [
  {
    id: 'gemma3:4b',
    name: 'BCC-AI-Model',
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
    removeAttachment,
    deleteChat,
    stopGeneration,
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

    // Если идет загрузка, останавливаем генерацию
    if (isLoading) {
      stopGeneration();
      return;
    }

    // Иначе отправляем сообщение
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

  const handleRemoveAttachment = removeAttachment || ((id: string) => {
    const newAttachments = attachments.filter(file => file.id !== id);
    // Здесь можно логировать или показывать предупреждение, что функция в хуке не определена
    console.warn('removeAttachment is not defined in useChat hook');
  });

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
    <div className="flex h-full bg-chat-bg text-white">
      {/* Sidebar */}
      {showSidebar && (
        <div className="w-64 bg-brand-dark-green flex flex-col">
          <div className="p-4">
            <button
              onClick={startNewChat}
              className="w-full flex items-center justify-center gap-2 border border-white/30 rounded-md py-2 bg-green-700/50 hover:bg-green-700 text-white"
            >
              <PlusIcon className="h-4 w-4" />
              <span>New chat</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            <div className="space-y-2">
              {sessions.slice().reverse().map((session) => (
                <div
                  key={session.id}
                  className={`w-full flex items-center justify-between p-2 rounded-md hover:bg-green-700 ${session.id === currentSessionId ? 'bg-green-700' : ''
                    }`}
                >
                  <button
                    onClick={() => loadSession(session.id)}
                    className="flex-1 text-left truncate text-sm text-white"
                  >
                    {getChatTitle(session.id)}
                  </button>

                  {/* Кнопка удаления */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('Вы уверены, что хотите удалить этот чат?')) {
                        deleteChat(session.id);
                      }
                    }}
                    className="text-white/70 hover:text-red-300"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
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
              {/* Удаляем кнопку остановки отсюда */}
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
              onRemoveAttachment={handleRemoveAttachment}
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
              className={`absolute right-2 bottom-2.5 rounded-md p-1.5 transition-colors ${isLoading
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              title={isLoading ? "Остановить генерацию" : "Отправить сообщение"}
            >
              {isLoading ? (
                <StopIcon className="h-5 w-5" />
              ) : (
                <PaperAirplaneIcon className="h-5 w-5" />
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Chat;