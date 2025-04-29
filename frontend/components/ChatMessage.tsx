import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import { Message } from '../types';

interface ChatMessageProps {
  message: Message;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';
  
  return (
    <div className={`py-5 ${isUser ? 'bg-user-message' : 'bg-bot-message'}`}>
      <div className="max-w-3xl mx-auto px-4 flex items-start">
        <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${isUser ? 'bg-blue-500' : 'bg-green-500'}`}>
          {isUser ? 'В' : 'ИИ'}
        </div>
        
        <div className="ml-4 flex-1">
          <div className="font-medium text-white">
            {isUser ? 'Вы' : 'ИИ'}
          </div>
          
          <div className="mt-1 prose prose-invert">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({node, inline, className, children, ...props}) {
                  const match = /language-(\w+)/.exec(className || '');
                  return !inline && match ? (
                    <div className="rounded-md my-2 overflow-hidden" style={{ background: '#2d2d3a' }}>
                      <SyntaxHighlighter
                        style={{
                          ...vscDarkPlus,
                          'pre[class*="language-"]': {
                            ...vscDarkPlus['pre[class*="language-"]'],
                            margin: 0,
                            background: '#2d2d3a'
                          }
                        }}
                        language={match[1]}
                        showLineNumbers={false}
                        wrapLines={true}
                        customStyle={{
                          background: '#2d2d3a',
                          padding: '1rem',
                          margin: 0,
                          border: 'none',
                          borderRadius: 0
                        }}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    </div>
                  ) : (
                    <code className="bg-gray-800 px-1 py-0.5 rounded" {...props}>
                      {children}
                    </code>
                  );
                }
              }}
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