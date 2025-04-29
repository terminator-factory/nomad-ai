from fastapi import WebSocket, WebSocketDisconnect
import logging
import json
import uuid
from typing import Dict, Any, Optional, List
import asyncio

from app.services.connection_manager import ConnectionManager
from app.services.llm import generate_stream_response
from app.services.documents import process_attachments, get_knowledge_base_documents
from app.core.config import settings

logger = logging.getLogger(__name__)

async def handle_websocket(websocket: WebSocket, connection_manager: ConnectionManager):
    """
    Обработчик WebSocket соединений
    """
    connection_id = await connection_manager.connect(websocket)
    
    try:
        while True:
            # Ожидаем сообщение от клиента
            raw_data = await websocket.receive_text()
            
            try:
                data = json.loads(raw_data)
                
                # Разбор типа сообщения
                if not isinstance(data, dict) or "type" not in data:
                    await connection_manager.send_error(connection_id, "Неверный формат сообщения")
                    continue
                
                message_type = data.get("type")
                
                # Обработка различных типов сообщений
                if message_type == "chat-message":
                    await handle_chat_message(connection_id, data, connection_manager)
                    
                elif message_type == "stop-generation":
                    await handle_stop_generation(connection_id, data, connection_manager)
                    
                elif message_type == "change-session":
                    await handle_change_session(connection_id, data, connection_manager)
                    
                elif message_type == "kb-get-documents":
                    await handle_kb_get_documents(connection_id, connection_manager)
                    
                elif message_type == "kb-delete-document":
                    await handle_kb_delete_document(connection_id, data, connection_manager)
                    
                else:
                    logger.warning(f"Получен неизвестный тип сообщения: {message_type}")
                    await connection_manager.send_error(
                        connection_id, f"Неизвестный тип сообщения: {message_type}"
                    )
                    
            except json.JSONDecodeError:
                logger.error(f"Получено некорректное JSON-сообщение")
                await connection_manager.send_error(connection_id, "Некорректный формат JSON")
                
            except Exception as e:
                logger.exception(f"Ошибка при обработке сообщения: {e}")
                await connection_manager.send_error(connection_id, f"Ошибка при обработке сообщения: {str(e)}")
    
    except WebSocketDisconnect:
        logger.info(f"Клиент отключился: {connection_id}")
        connection_manager.disconnect(connection_id)
    
    except Exception as e:
        logger.exception(f"Необработанная ошибка в WebSocket: {e}")
        connection_manager.disconnect(connection_id)


async def handle_chat_message(connection_id: str, data: Dict[str, Any], connection_manager: ConnectionManager):
    """
    Обработка сообщения чата
    """
    try:
        # Проверка обязательных полей
        session_id = data.get("sessionId")
        messages = data.get("messages", [])
        attachments = data.get("attachments", [])
        model_id = data.get("model", settings.DEFAULT_MODEL)
        
        if not session_id or not messages:
            await connection_manager.send_error(connection_id, "Необходимо указать sessionId и messages")
            return
        
        # Установка сессии и проверка активной генерации
        connection_manager.set_session(connection_id, session_id)
        generation_status = connection_manager.get_generation_status(connection_id)
        
        if generation_status["is_generating"]:
            # Если уже идет генерация, останавливаем ее
            connection_manager.mark_stop_requested(connection_id)
            await asyncio.sleep(0.2)  # Небольшая задержка для обработки остановки
        
        # Устанавливаем статус генерации
        connection_manager.set_generation_status(connection_id, True, model_id)
        connection_manager.clear_stop_request(connection_id)
        
        # Обрабатываем вложения если есть
        processed_attachments = []
        if attachments and len(attachments) > 0:
            logger.info(f"Обработка {len(attachments)} вложений")
            processed_attachments = await process_attachments(attachments)
        
        # Асинхронно генерируем ответ
        asyncio.create_task(
            stream_llm_response(
                connection_id=connection_id,
                session_id=session_id,
                messages=messages,
                attachments=processed_attachments,
                model_id=model_id,
                connection_manager=connection_manager
            )
        )
        
    except Exception as e:
        logger.exception(f"Ошибка при обработке сообщения чата: {e}")
        await connection_manager.send_error(connection_id, f"Ошибка при обработке сообщения: {str(e)}")
        connection_manager.set_generation_status(connection_id, False)


async def stream_llm_response(
    connection_id: str,
    session_id: str,
    messages: List[Dict[str, Any]],
    attachments: List[Dict[str, Any]],
    model_id: str,
    connection_manager: ConnectionManager
):
    """
    Асинхронная задача для потоковой генерации ответа LLM
    """
    try:
        # Генерируем ответ с колбэками для отправки чанков
        async def on_chunk(chunk: str):
            if not connection_manager.is_stop_requested(connection_id):
                await connection_manager.send_message_chunk(connection_id, chunk)
            else:
                # Если запрошена остановка, возвращаем False чтобы прервать генерацию
                return False
            return True
        
        await generate_stream_response(
            messages=messages,
            attachments=attachments,
            model=model_id,
            on_chunk=on_chunk
        )
        
        # Отправляем сигнал о завершении
        if not connection_manager.is_stop_requested(connection_id):
            await connection_manager.send_message_complete(connection_id)
        else:
            # Если была запрошена остановка, отправляем сообщение о завершении и очищаем статус
            connection_manager.clear_stop_request(connection_id)
            await connection_manager.send_message_complete(connection_id)
        
        # Сбрасываем статус генерации
        connection_manager.set_generation_status(connection_id, False)
    
    except Exception as e:
        logger.exception(f"Ошибка при генерации ответа: {e}")
        await connection_manager.send_error(connection_id, f"Ошибка при генерации ответа: {str(e)}")
        connection_manager.set_generation_status(connection_id, False)
        await connection_manager.send_message_complete(connection_id)


async def handle_stop_generation(connection_id: str, data: Dict[str, Any], connection_manager: ConnectionManager):
    """
    Обработка запроса на остановку генерации
    """
    try:
        session_id = data.get("sessionId")
        current_session = connection_manager.get_session(connection_id)
        
        if session_id and current_session and session_id == current_session:
            # Отмечаем запрос на остановку
            connection_manager.mark_stop_requested(connection_id)
            logger.info(f"Остановка генерации запрошена для соединения {connection_id}, сессия {session_id}")
        else:
            logger.warning(f"Несоответствие сессии: запрос {session_id}, текущая {current_session}")
    
    except Exception as e:
        logger.exception(f"Ошибка при обработке запроса на остановку: {e}")
        await connection_manager.send_error(connection_id, f"Ошибка: {str(e)}")


async def handle_change_session(connection_id: str, data: Dict[str, Any], connection_manager: ConnectionManager):
    """
    Обработка смены сессии
    """
    try:
        session_id = data.get("sessionId")
        
        if not session_id:
            await connection_manager.send_error(connection_id, "Не указан sessionId")
            return
        
        # Если идет генерация, останавливаем
        generation_status = connection_manager.get_generation_status(connection_id)
        if generation_status["is_generating"]:
            connection_manager.mark_stop_requested(connection_id)
            await asyncio.sleep(0.2)  # Небольшая задержка для обработки остановки
        
        # Меняем сессию
        connection_manager.set_session(connection_id, session_id)
        logger.info(f"Сессия изменена для {connection_id} на {session_id}")
    
    except Exception as e:
        logger.exception(f"Ошибка при смене сессии: {e}")
        await connection_manager.send_error(connection_id, f"Ошибка: {str(e)}")


async def handle_kb_get_documents(connection_id: str, connection_manager: ConnectionManager):
    """
    Получение списка документов из базы знаний
    """
    try:
        documents = await get_knowledge_base_documents()
        await connection_manager.send_kb_update(connection_id, documents)
    
    except Exception as e:
        logger.exception(f"Ошибка при получении документов БЗ: {e}")
        await connection_manager.send_error(connection_id, f"Ошибка: {str(e)}")


async def handle_kb_delete_document(connection_id: str, data: Dict[str, Any], connection_manager: ConnectionManager):
    """
    Удаление документа из базы знаний
    """
    from app.services.documents import delete_document
    
    try:
        document_id = data.get("documentId")
        
        if not document_id:
            await connection_manager.send_error(connection_id, "Не указан documentId")
            return
        
        # Удаляем документ
        success = await delete_document(document_id)
        
        if success:
            # Уведомляем всех клиентов об удалении
            await connection_manager.send_kb_document_deleted(document_id)
            logger.info(f"Документ {document_id} удален")
        else:
            await connection_manager.send_error(connection_id, "Не удалось удалить документ")
    
    except Exception as e:
        logger.exception(f"Ошибка при удалении документа: {e}")
        await connection_manager.send_error(connection_id, f"Ошибка: {str(e)}")