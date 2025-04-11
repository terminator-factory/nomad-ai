export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
  }
  
  export interface ChatSession {
    id: string;
    title: string;
    messages: Message[];
    createdAt: Date;
    updatedAt: Date;
  }
  
  export interface FileAttachment {
    id: string;
    name: string;
    type: string;
    size: number;
    content?: string; // Для простоты используем строковое содержимое
    url?: string;
  }
  
  export interface ChatOptions {
    model: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
  }