from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime
import uuid

class FileAttachment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    type: str
    size: int
    content: Optional[str] = None
    url: Optional[str] = None

class ChatMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    role: str  # "user", "assistant" или "system"
    content: str
    timestamp: str = Field(default_factory=lambda: datetime.now().isoformat())

class ChatSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    messages: List[ChatMessage] = []
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())

class ChatMessageRequest(BaseModel):
    session_id: str
    messages: List[ChatMessage]
    attachments: Optional[List[FileAttachment]] = None
    model: Optional[str] = None
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = None
    stream: Optional[bool] = False

class ChatMessageResponse(BaseModel):
    message: ChatMessage
    session_id: str
    
    class Config:
        schema_extra = {
            "example": {
                "message": {
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "session_id": "550e8400-e29b-41d4-a716-446655440001",
                    "role": "assistant",
                    "content": "Привет! Чем я могу помочь?",
                    "timestamp": "2023-08-24T12:34:56.789123"
                },
                "session_id": "550e8400-e29b-41d4-a716-446655440001"
            }
        }

class WebSocketMessage(BaseModel):
    type: str
    session_id: Optional[str] = None
    content: Optional[Any] = None
    
    class Config:
        schema_extra = {
            "example": {
                "type": "chat-message",
                "session_id": "550e8400-e29b-41d4-a716-446655440001",
                "content": {
                    "messages": [
                        {
                            "role": "user",
                            "content": "Привет!"
                        }
                    ],
                    "model": "gemma3:4b"
                }
            }
        }