from fastapi.websockets import WebSocket
from typing import Dict, List, Optional, Any, Set
import json
import logging
import asyncio
from datetime import datetime
import uuid
import traceback

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
        
        # Информация о генерации: {connection_id: {is_generating: bool, model: str, start_time: datetime}}
        self.generation_status: Dict[str, Dict[str, Any]] = {}
        
        # Задания по остановке генерации
        self.stop_requests: Set[str] = set()
        
        # Последнее время активности соединений
        self.last_activity: Dict[str, datetime] = {}
        
        # Запуск фоновой задачи для очистки неактивных соединений
        asyncio.create_task(self._cleanup_inactive_connections())
        
    async def connect(self, websocket: WebSocket) -> str:
        """
        Устанавливает соединение WebSocket и возвращает ID соединения
        """
        connection_id = str(uuid.uuid4())
        await websocket.accept()
        self.active_connections[connection_id] = websocket
        self.generation_status[connection_id] = {
            "is_generating": False, 
            "model": None,
            "start_time": None
        }
        self.last_activity[connection_id] = datetime.now()
        logger.info(f"Установлено новое соединение: {connection_id}")
        
        # Отправляем подтверждение соединения клиенту
        try:
            await websocket.send_json({
                "type": "connection-established",
                "connectionId": connection_id,
                "timestamp": datetime.now().isoformat()
            })
        except Exception as e:
            logger.error(f"Ошибка при отправке подтверждения соединения: {e}")
        
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
            
        if connection_id in self.last_activity:
            del self.last_activity[connection_id]
            
        logger.info(f"Соединение закрыто: {connection_id}")
    
    async def _cleanup_inactive_connections(self):
        """
        Фоновая задача для очистки неактивных соединений
        """
        # Интервал проверки (в секундах)
        check_interval = 60
        # Тайм-аут неактивности (в секундах)
        inactivity_timeout = 1800  # 30 минут
        
        while True:
            try:
                await asyncio.sleep(check_interval)
                
                # Получаем текущее время
                now = datetime.now()
                
                # Находим неактивные соединения
                inactive_connections = []
                for conn_id, last_active in self.last_activity.items():
                    # Проверяем, прошло ли достаточно времени с момента последней активности
                    inactive_seconds = (now - last_active).total_seconds()
                    if inactive_seconds > inactivity_timeout:
                        inactive_connections.append(conn_id)
                
                # Закрываем неактивные соединения
                for conn_id in inactive_connections:
                    logger.info(f"Закрытие неактивного соединения: {conn_id}")
                    # Если идет генерация, останавливаем ее
                    if conn_id in self.generation_status and self.generation_status[conn_id]["is_generating"]:
                        self.mark_stop_requested(conn_id)
                    
                    # Пытаемся отправить уведомление о закрытии соединения
                    try:
                        if conn_id in self.active_connections:
                            await self.active_connections[conn_id].send_json({
                                "type": "connection-timeout",
                                "message": "Соединение закрыто из-за неактивности"
                            })
                    except:
                        pass
                    
                    # Отключаем соединение
                    self.disconnect(conn_id)
                
                # Также проверяем застрявшие генерации
                stuck_generations = []
                for conn_id, status in self.generation_status.items():
                    if status["is_generating"] and status["start_time"]:
                        generation_time = (now - status["start_time"]).total_seconds()
                        # Если генерация идет более 5 минут, считаем ее застрявшей
                        if generation_time > 300:  # 5 минут
                            stuck_generations.append(conn_id)
                
                # Останавливаем застрявшие генерации
                for conn_id in stuck_generations:
                    logger.warning(f"Остановка застрявшей генерации для {conn_id}")
                    self.mark_stop_requested(conn_id)
                    self.set_generation_status(conn_id, False)
                    
                    # Пытаемся отправить уведомление о принудительной остановке
                    try:
                        if conn_id in self.active_connections:
                            await self.send_error(
                                conn_id, 
                                "Генерация была остановлена сервером из-за превышения времени ожидания"
                            )
                            await self.send_message_complete(conn_id)
                    except:
                        pass
                
            except Exception as e:
                logger.error(f"Ошибка в фоновой задаче очистки соединений: {e}")
    
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
                
                # Обновляем время последней активности
                self.last_activity[connection_id] = datetime.now()
                
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
            self.generation_status[connection_id]["start_time"] = None
    
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
        # Обновляем время последней активности
        self.last_activity[connection_id] = datetime.now()
        logger.info(f"Установлена сессия {session_id} для соединения {connection_id}")
    
    def get_session(self, connection_id: str) -> Optional[str]:
        """
        Возвращает ID сессии для соединения
        """
        # Обновляем время последней активности
        if connection_id in self.last_activity:
            self.last_activity[connection_id] = datetime.now()
        return self.connection_sessions.get(connection_id)
    
    def set_generation_status(self, connection_id: str, is_generating: bool, model: Optional[str] = None):
        """
        Устанавливает статус генерации для соединения
        """
        if connection_id in self.generation_status:
            self.generation_status[connection_id]["is_generating"] = is_generating
            
            if is_generating:
                # Устанавливаем время начала генерации
                self.generation_status[connection_id]["start_time"] = datetime.now()
            else:
                # Сбрасываем время начала генерации
                self.generation_status[connection_id]["start_time"] = None
                
            if model:
                self.generation_status[connection_id]["model"] = model
            
            # Обновляем время последней активности
            self.last_activity[connection_id] = datetime.now()
                
        logger.info(f"Статус генерации для {connection_id}: {is_generating}, модель: {model}")
    
    def get_generation_status(self, connection_id: str) -> Dict[str, Any]:
        """
        Возвращает статус генерации для соединения
        """
        # Обновляем время последней активности
        if connection_id in self.last_activity:
            self.last_activity[connection_id] = datetime.now()
            
        return self.generation_status.get(
            connection_id, 
            {"is_generating": False, "model": None, "start_time": None}
        )
    
    def mark_stop_requested(self, connection_id: str):
        """
        Отмечает запрос на остановку генерации
        """
        self.stop_requests.add(connection_id)
        # Обновляем время последней активности
        if connection_id in self.last_activity:
            self.last_activity[connection_id] = datetime.now()
        logger.info(f"Запрошена остановка генерации для {connection_id}")
    
    def is_stop_requested(self, connection_id: str) -> bool:
        """
        Проверяет, был ли запрос на остановку генерации
        """
        # Обновляем время последней активности
        if connection_id in self.last_activity:
            self.last_activity[connection_id] = datetime.now()
        return connection_id in self.stop_requests
    
    def clear_stop_request(self, connection_id: str):
        """
        Очищает запрос на остановку генерации
        """
        if connection_id in self.stop_requests:
            self.stop_requests.remove(connection_id)
            # Обновляем время последней активности
            if connection_id in self.last_activity:
                self.last_activity[connection_id] = datetime.now()
            logger.info(f"Запрос на остановку очищен для {connection_id}")
    
    async def broadcast_to_session(self, session_id: str, message: Any):
        """
        Отправляет сообщение всем клиентам, связанным с определенной сессией
        """
        for conn_id, sess_id in self.connection_sessions.items():
            if sess_id == session_id:
                await self.send_message(conn_id, message)
    
    async def broadcast_to_all(self, message: Any):
        """
        Отправляет сообщение всем подключенным клиентам
        """
        for conn_id in list(self.active_connections.keys()):
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
        for connection_id in list(self.active_connections.keys()):
            await self.send_message(connection_id, message)
            
    def get_active_connections_count(self) -> int:
        """
        Возвращает количество активных соединений
        """
        return len(self.active_connections)
    
    def get_active_generations_count(self) -> int:
        """
        Возвращает количество активных генераций
        """
        return sum(
            1 for status in self.generation_status.values() 
            if status.get("is_generating", False)
        )
        
    async def get_status(self) -> Dict[str, Any]:
        """
        Возвращает статус менеджера соединений
        """
        return {
            "active_connections": self.get_active_connections_count(),
            "active_generations": self.get_active_generations_count(),
            "timestamp": datetime.now().isoformat()
        }