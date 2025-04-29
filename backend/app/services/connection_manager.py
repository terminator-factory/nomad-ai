from fastapi.websockets import WebSocket
from typing import Dict, List, Optional, Any, Set
import json
import logging
import asyncio
from datetime import datetime
import uuid

logger = logging.getLogger(__name__)

class ConnectionManager:
    """
    Менеджер WebSocket-соединений для обработки и отслеживания клиентских подключений
    """
    
    def __init__(self):
        # Активные соединения: {connection_id: websocket}
        self.active_connections: Dict[str, WebSocket] = {}
        
        # Соответствие соединений сессиям: {connection_id: session_id}
        self.connection_sessions: Dict[str, str] = {}
        
        # Информация о генерации: {connection_id: {is_generating: bool, model: str}}
        self.generation_status: Dict[str, Dict[str, Any]] = {}
        
        # Задания по остановке генерации
        self.stop_requests: Set[str] = set()
        
    async def connect(self, websocket: WebSocket) -> str:
        """
        Устанавливает соединение WebSocket и возвращает ID соединения
        """
        connection_id = str(uuid.uuid4())
        await websocket.accept()
        self.active_connections[connection_id] = websocket
        self.generation_status[connection_id] = {"is_generating": False, "model": None}
        logger.info(f"Установлено новое соединение: {connection_id}")
        return connection_id
    
    def disconnect(self, connection_id: str):
        """
        Закрывает соединение WebSocket и удаляет его из отслеживаемых
        """
        if connection_id in self.active_connections:
            del self.active_connections[connection_id]
        
        if connection_id in self.connection_sessions:
            del self.connection_sessions[connection_id]
            
        if connection_id in self.generation_status:
            del self.generation_status[connection_id]
            
        if connection_id in self.stop_requests:
            self.stop_requests.remove(connection_id)
            
        logger.info(f"Соединение закрыто: {connection_id}")
    
    async def send_message(self, connection_id: str, message: Any):
        """
        Отправляет сообщение клиенту через WebSocket
        """
        if connection_id in self.active_connections:
            try:
                websocket = self.active_connections[connection_id]
                if isinstance(message, dict) or isinstance(message, list):
                    await websocket.send_json(message)
                else:
                    await websocket.send_text(str(message))
            except Exception as e:
                logger.error(f"Ошибка при отправке сообщения: {e}")
                # При ошибке отправки, отключаем клиента
                self.disconnect(connection_id)
    
    async def send_message_chunk(self, connection_id: str, chunk: str):
        """
        Отправляет чанк сообщения для потоковой генерации
        """
        message = {"type": "message-chunk", "content": chunk}
        await self.send_message(connection_id, message)
    
    async def send_message_complete(self, connection_id: str):
        """
        Отправляет сигнал о завершении генерации сообщения
        """
        message = {"type": "message-complete"}
        await self.send_message(connection_id, message)
        
        # Сбросить статус генерации
        if connection_id in self.generation_status:
            self.generation_status[connection_id]["is_generating"] = False
    
    async def send_error(self, connection_id: str, error: str):
        """
        Отправляет сообщение об ошибке клиенту
        """
        message = {"type": "error", "error": error}
        await self.send_message(connection_id, message)
    
    def set_session(self, connection_id: str, session_id: str):
        """
        Устанавливает сессию для соединения
        """
        self.connection_sessions[connection_id] = session_id
        logger.info(f"Установлена сессия {session_id} для соединения {connection_id}")
    
    def get_session(self, connection_id: str) -> Optional[str]:
        """
        Возвращает ID сессии для соединения
        """
        return self.connection_sessions.get(connection_id)
    
    def set_generation_status(self, connection_id: str, is_generating: bool, model: Optional[str] = None):
        """
        Устанавливает статус генерации для соединения
        """
        if connection_id in self.generation_status:
            self.generation_status[connection_id]["is_generating"] = is_generating
            if model:
                self.generation_status[connection_id]["model"] = model
                
        logger.info(f"Статус генерации для {connection_id}: {is_generating}, модель: {model}")
    
    def get_generation_status(self, connection_id: str) -> Dict[str, Any]:
        """
        Возвращает статус генерации для соединения
        """
        return self.generation_status.get(connection_id, {"is_generating": False, "model": None})
    
    def mark_stop_requested(self, connection_id: str):
        """
        Отмечает запрос на остановку генерации
        """
        self.stop_requests.add(connection_id)
        logger.info(f"Запрошена остановка генерации для {connection_id}")
    
    def is_stop_requested(self, connection_id: str) -> bool:
        """
        Проверяет, был ли запрос на остановку генерации
        """
        return connection_id in self.stop_requests
    
    def clear_stop_request(self, connection_id: str):
        """
        Очищает запрос на остановку генерации
        """
        if connection_id in self.stop_requests:
            self.stop_requests.remove(connection_id)
            logger.info(f"Запрос на остановку очищен для {connection_id}")
    
    async def broadcast_to_session(self, session_id: str, message: Any):
        """
        Отправляет сообщение всем клиентам, связанным с определенной сессией
        """
        for conn_id, sess_id in self.connection_sessions.items():
            if sess_id == session_id:
                await self.send_message(conn_id, message)
    
    async def send_kb_update(self, connection_id: str, documents: List[Dict[str, Any]]):
        """
        Отправляет обновление базы знаний клиенту
        """
        message = {"type": "kb-documents", "documents": documents}
        await self.send_message(connection_id, message)
    
    async def send_kb_document_deleted(self, document_id: str):
        """
        Рассылает всем клиентам уведомление об удалении документа из базы знаний
        """
        message = {"type": "kb-document-deleted", "documentId": document_id}
        for connection_id in self.active_connections:
            await self.send_message(connection_id, message)