import React from 'react';
import ReactMarkdown from 'react-markdown';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';
import remarkGfm from 'remark-gfm';
import { Message } from '../types';

interface ChatMessageProps {
  message: Message;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';
  
  // Код для подсветки синтаксиса при монтировании компонента
  React.useEffect(() => {
    document.querySelectorAll('pre code').forEach((el) => {
      hljs.highlightElement(el as HTMLElement);
    });
  }, [message.content]);
  
  return (
    <div className={`py-5 ${isUser ? 'bg-user-message' : 'bg-bot-message'}`}>
      <div className="max-w-3xl mx-auto px-4 flex">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isUser ? 'bg-blue-500' : 'bg-green-500'}`}>
          {isUser ? 'Вы' : 'ИИ'}
        </div>
        
        <div className="ml-4 flex-1">
          <div className="font-medium text-white">
            {isUser ? 'Вы' : 'БОТаник'}
          </div>
          
          <div className="mt-1 prose prose-invert">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;