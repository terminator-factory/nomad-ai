from fastapi import WebSocket, WebSocketDisconnect, HTTPException
import logging
import json
import uuid
from typing import Dict, Any, Optional, List
import asyncio
import traceback

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
                    await connection_manager.send_error(connection_id, "Неверный формат сообщения: отсутствует поле 'type'")
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
                    
                elif message_type == "ping":
                    # Добавляем обработку ping для проверки соединения
                    await connection_manager.send_message(connection_id, {"type": "pong", "timestamp": data.get("timestamp")})
                    
                else:
                    logger.warning(f"Получен неизвестный тип сообщения: {message_type}")
                    await connection_manager.send_error(
                        connection_id, f"Неизвестный тип сообщения: {message_type}"
                    )
                    
            except json.JSONDecodeError as e:
                logger.error(f"Получено некорректное JSON-сообщение: {raw_data[:100]}...")
                await connection_manager.send_error(connection_id, "Некорректный формат JSON")
                
            except Exception as e:
                error_trace = traceback.format_exc()
                logger.exception(f"Ошибка при обработке сообщения: {e}")
                await connection_manager.send_error(
                    connection_id, 
                    f"Ошибка при обработке сообщения: {str(e)}"
                )
                # Логируем полный стек ошибки для отладки
                logger.error(f"Полный стек ошибки:\n{error_trace}")
    
    except WebSocketDisconnect:
        logger.info(f"Клиент отключился: {connection_id}")
        # Остановка генерации, если была активна
        if connection_manager.get_generation_status(connection_id)["is_generating"]:
            connection_manager.mark_stop_requested(connection_id)
        connection_manager.disconnect(connection_id)
    
    except Exception as e:
        error_trace = traceback.format_exc()
        logger.exception(f"Необработанная ошибка в WebSocket: {e}")
        try:
            # Пытаемся отправить сообщение об ошибке клиенту перед отключением
            await connection_manager.send_error(
                connection_id, 
                "Произошла внутренняя ошибка сервера. Пожалуйста, обновите страницу."
            )
        except:
            pass
        logger.error(f"Полный стек ошибки:\n{error_trace}")
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
        
        if not session_id:
            await connection_manager.send_error(connection_id, "Необходимо указать sessionId")
            return
            
        if not messages:
            await connection_manager.send_error(connection_id, "Необходимо указать хотя бы одно сообщение")
            return
        
        # Проверка структуры сообщений
        for msg in messages:
            if not isinstance(msg, dict) or "role" not in msg or "content" not in msg:
                await connection_manager.send_error(connection_id, "Неверный формат сообщений")
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
        
        # Проверка и обработка вложений, если есть
        processed_attachments = []
        if attachments and len(attachments) > 0:
            logger.info(f"Обработка {len(attachments)} вложений")
            
            # Проверяем структуру вложений
            for att in attachments:
                if not isinstance(att, dict) or "name" not in att or "type" not in att:
                    await connection_manager.send_error(
                        connection_id, 
                        "Неверный формат вложений. Требуются поля 'name' и 'type'"
                    )
                    connection_manager.set_generation_status(connection_id, False)
                    return
            
            # Обрабатываем вложения
            try:
                processed_attachments = await process_attachments(attachments)
            except Exception as e:
                logger.exception(f"Ошибка при обработке вложений: {e}")
                await connection_manager.send_error(
                    connection_id, 
                    f"Ошибка при обработке вложений: {str(e)}"
                )
                connection_manager.set_generation_status(connection_id, False)
                return
        
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
        error_trace = traceback.format_exc()
        logger.exception(f"Ошибка при обработке сообщения чата: {e}")
        await connection_manager.send_error(
            connection_id, 
            f"Ошибка при обработке сообщения: {str(e)}"
        )
        logger.error(f"Полный стек ошибки:\n{error_trace}")
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
        # Уведомление о начале генерации
        await connection_manager.send_message(connection_id, {
            "type": "generation-start",
            "model": model_id
        })
        
        # Генерируем ответ с колбэками для отправки чанков
        async def on_chunk(chunk: str):
            if not connection_manager.is_stop_requested(connection_id):
                await connection_manager.send_message_chunk(connection_id, chunk)
            else:
                # Если запрошена остановка, возвращаем False чтобы прервать генерацию
                logger.info(f"Остановка генерации по запросу для {connection_id}")
                return False
            return True
        
        try:
            await generate_stream_response(
                messages=messages,
                attachments=attachments,
                model=model_id,
                on_chunk=on_chunk
            )
        except Exception as e:
            logger.exception(f"Ошибка во время генерации ответа LLM: {e}")
            await connection_manager.send_error(
                connection_id, 
                f"Ошибка при генерации ответа: {str(e)}"
            )
            # Отправляем сигнал, что генерация завершена с ошибкой
            await connection_manager.send_message(connection_id, {
                "type": "generation-error",
                "error": str(e)
            })
        
        # Отправляем сигнал о завершении
        if not connection_manager.is_stop_requested(connection_id):
            await connection_manager.send_message_complete(connection_id)
        else:
            # Если была запрошена остановка, отправляем сообщение о завершении и очищаем статус
            connection_manager.clear_stop_request(connection_id)
            await connection_manager.send_message(connection_id, {
                "type": "generation-stopped",
                "message": "Генерация ответа была остановлена по запросу пользователя"
            })
            await connection_manager.send_message_complete(connection_id)
        
        # Сбрасываем статус генерации
        connection_manager.set_generation_status(connection_id, False)
    
    except Exception as e:
        error_trace = traceback.format_exc()
        logger.exception(f"Ошибка при генерации ответа: {e}")
        await connection_manager.send_error(
            connection_id, 
            f"Ошибка при генерации ответа: {str(e)}"
        )
        logger.error(f"Полный стек ошибки:\n{error_trace}")
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
            
            # Отправляем подтверждение остановки
            await connection_manager.send_message(connection_id, {
                "type": "stop-confirmed",
                "sessionId": session_id
            })
        else:
            # Сессии не совпадают
            logger.warning(f"Несоответствие сессии: запрос {session_id}, текущая {current_session}")
            await connection_manager.send_error(
                connection_id, 
                "Несоответствие ID сессии. Возможно, сессия уже изменена."
            )
    
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
        
        # Отправляем подтверждение смены сессии
        await connection_manager.send_message(connection_id, {
            "type": "session-changed",
            "sessionId": session_id
        })
    
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
            
            # Отправляем подтверждение удаления
            await connection_manager.send_message(connection_id, {
                "type": "kb-document-deleted-confirmed",
                "documentId": document_id,
                "success": True
            })
        else:
            await connection_manager.send_error(
                connection_id,
                f"Не удалось удалить документ с ID: {document_id}. Документ не найден или защищен от удаления."
            )
    
    except Exception as e:
        logger.exception(f"Ошибка при удалении документа: {e}")
        await connection_manager.send_error(connection_id, f"Ошибка: {str(e)}")