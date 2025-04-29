from fastapi import APIRouter, HTTPException, Depends, Body, Query, Path
from typing import List, Dict, Any, Optional
import logging
import uuid
from datetime import datetime

from app.models.chat import (
    ChatMessageRequest,
    ChatMessageResponse,
    ChatSession,
    ChatMessage
)
from app.services.llm import generate_stream_response
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

# Этот эндпоинт используется только как запасной вариант,
# основное взаимодействие происходит через WebSocket
@router.post("/chat", response_model=ChatMessageResponse)
async def create_chat_message(
    request: ChatMessageRequest = Body(...)
):
    """
    Создает сообщение чата и генерирует ответ
    Этот эндпоинт не потоковый и ждет полного ответа
    """
    try:
        # Валидация запроса
        if not request.messages or not request.session_id:
            raise HTTPException(status_code=400, detail="Требуется указать messages и session_id")
        
        # Ищем последнее сообщение пользователя
        user_messages = [msg for msg in request.messages if msg.role == "user"]
        if not user_messages:
            raise HTTPException(status_code=400, detail="Не найдено сообщение пользователя")
        
        last_user_message = user_messages[-1]
        
        # Преобразуем сообщения в формат для LLM
        messages_for_llm = [
            {"role": msg.role, "content": msg.content} 
            for msg in request.messages
        ]
        
        # Преобразуем вложения в формат для LLM
        attachments_for_llm = []
        if request.attachments:
            attachments_for_llm = [
                {
                    "name": att.name,
                    "type": att.type,
                    "size": att.size,
                    "content": att.content
                }
                for att in request.attachments
            ]
        
        # Собираем полный текст ответа
        full_response = ""
        model_id = request.model or settings.DEFAULT_MODEL
        
        # Настройка обработчика для сбора потоковых чанков
        async def chunk_collector(chunk: str):
            nonlocal full_response
            full_response += chunk
            return True
        
        # Генерируем ответ
        await generate_stream_response(
            messages=messages_for_llm,
            attachments=attachments_for_llm,
            model=model_id,
            on_chunk=chunk_collector
        )
        
        # Создаем сообщение ответа
        response_message = ChatMessage(
            id=str(uuid.uuid4()),
            session_id=request.session_id,
            role="assistant",
            content=full_response,
            timestamp=datetime.now().isoformat()
        )
        
        return ChatMessageResponse(
            message=response_message,
            session_id=request.session_id
        )
    
    except Exception as e:
        logger.exception(f"Ошибка при обработке сообщения чата: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка обработки: {str(e)}")


@router.get("/health", response_model=Dict[str, str])
async def chat_health():
    """
    Проверка работоспособности сервиса чата
    """
    return {"status": "ok", "service": "chat"}