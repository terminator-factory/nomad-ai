import logging
import os
import json
import httpx
import asyncio
from typing import List, Dict, Any, Optional, Callable, Union, Awaitable
from langchain.llms import Ollama
from langchain.chat_models import ChatOllama
from langchain.schema import HumanMessage, AIMessage, SystemMessage
from langchain.callbacks.streaming_stdout import StreamingStdOutCallbackHandler
from langchain.callbacks.base import BaseCallbackHandler
from langchain.prompts import PromptTemplate
from langchain.prompts.chat import ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate
from langchain.chains import LLMChain
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.core.config import settings
from app.services.documents import search_relevant_chunks

logger = logging.getLogger(__name__)

# Модели, доступные для использования
AVAILABLE_MODELS = [
    {"id": "llama3", "name": "Ботагөз", "description": "Мудрая и грациозная. Идеальна для глубоких аналитических задач. \nЗнание русского: Базовое, но уверенно поддерживает общение."},
    {"id": "gemma3:4b", "name": "Жека", "description": "Сильный и умный. Отлично подходит для сложных запросов и высокоэффективных решений. \nЗнание русского: Хорошее, поддерживает точность и логику в ответах."},
    {"id": "gemma3:1b", "name": "Жемic", "description": "Лёгкая и быстрая. Подходит для повседневных задач и простых вопросов. \nЗнание русского: Базовое, для коротких и чётких ответов."},
    {"id": "mistral", "name": "Маке", "description": "Мощный и вдумчивый. Отлично решает сложные задачи и генерирует глубокие ответы. \nЗнание русского: Отличное, способен воспринимать и точно интерпретировать сложные запросы."}
]

# Максимальная длина контекста в токенах
MAX_CONTEXT_LENGTH = 6000


class StreamingCallbackHandler(BaseCallbackHandler):
    """
    CallbackHandler для потоковой обработки вывода LLM
    """
    def __init__(self, on_chunk: Callable[[str], Awaitable[bool]]):
        self.on_chunk = on_chunk
        self.stop_generation = False
        
    async def on_llm_new_token(self, token: str, **kwargs) -> None:
        """
        Вызывается для каждого нового токена от LLM
        Возвращает False если нужно остановить генерацию
        """
        if self.stop_generation:
            return
            
        if token:
            # Передаем токен в callback и проверяем, нужно ли остановить генерацию
            should_continue = await self.on_chunk(token)
            if should_continue is False:
                self.stop_generation = True
                return False
        
    async def on_llm_end(self, response: Any, **kwargs) -> None:
        """
        Вызывается когда LLM завершает генерацию
        """
        pass
        
    async def on_llm_error(self, error: Exception, **kwargs) -> None:
        """
        Вызывается при ошибке LLM
        """
        logger.error(f"Ошибка LLM: {error}")


async def get_available_models() -> List[Dict[str, str]]:
    """
    Получает список доступных моделей
    """
    try:
        # Если включен Ollama, пробуем получить список моделей из API
        if settings.LLM_TYPE == "ollama":
            ollamaBaseUrl = settings.LLM_API_URL
            if ollamaBaseUrl.endswith("/generate"):
                ollamaBaseUrl = ollamaBaseUrl.rsplit("/", 1)[0]
            
            if not ollamaBaseUrl.endswith("/api"):
                ollamaBaseUrl = ollamaBaseUrl.rstrip("/") + "/api"
            
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{ollamaBaseUrl}/tags")
                
                if response.status_code == 200:
                    data = response.json()
                    if "models" in data and isinstance(data["models"], list):
                        # Сопоставляем модели из Ollama с нашими предустановленными
                        available_models = []
                        
                        for default_model in AVAILABLE_MODELS:
                            # Ищем соответствие по ID
                            matching_model = next(
                                (m for m in data["models"] if 
                                m["name"].lower().startswith(default_model["id"].lower()) or
                                default_model["id"].lower() in m["name"].lower()),
                                None
                            )
                            
                            if matching_model:
                                # Добавляем модель из API, но с нашим именем и описанием
                                available_models.append({
                                    "id": matching_model["name"],
                                    "name": default_model["name"],
                                    "description": default_model["description"]
                                })
                                logger.info(f"Найдена модель: {matching_model['name']} -> {default_model['name']}")
                        
                        # Если ничего не найдено, возвращаем все предустановленные
                        if not available_models:
                            logger.info("Не найдено совпадений с предустановленными моделями")
                            return AVAILABLE_MODELS
                        
                        return available_models
        
        # Для всех остальных случаев возвращаем предустановленные модели
        return AVAILABLE_MODELS
        
    except Exception as e:
        logger.error(f"Ошибка при получении списка моделей: {e}")
        return AVAILABLE_MODELS


def format_chat_history(messages: List[Dict[str, str]]) -> str:
    """
    Форматирует историю сообщений в текстовый формат для контекста
    """
    formatted_history = []
    
    for msg in messages:
        role = msg.get("role", "").lower()
        content = msg.get("content", "")
        
        if role == "user":
            formatted_history.append(f"Пользователь: {content}")
        elif role == "assistant":
            formatted_history.append(f"Ассистент: {content}")
        elif role == "system":
            formatted_history.append(f"Системное сообщение: {content}")
    
    return "\n\n".join(formatted_history)


async def format_prompt(messages: List[Dict[str, str]], attachments: List[Dict[str, Any]] = None) -> str:
    """
    Форматирует промпт для LLM с учётом RAG и вложений
    """
    # Базовые системные инструкции
    system_prompt = """Ты дружелюбный и полезный ассистент. Ты можешь анализировать содержимое файлов и отвечать на вопросы пользователя.

У тебя есть доступ к базе знаний документов, которые были загружены пользователями. Когда отвечаешь на вопросы, используй информацию из этой базы знаний, если она релевантна вопросу.

ИНСТРУКЦИИ: Внимательно анализируй содержимое файлов и отвечай на вопросы пользователя, используя полученную информацию. Старайся давать полные и информативные ответы, основываясь на данных из файлов.
"""

    # Получение последнего сообщения пользователя для RAG поиска
    last_user_message = next((msg for msg in reversed(messages) if msg.get("role") == "user"), None)
    last_user_content = last_user_message.get("content", "") if last_user_message else ""

    # Если включен RAG и есть последнее сообщение, ищем релевантные чанки
    rag_context = ""
    file_info = ""
    
    if settings.RAG_ENABLED and last_user_content:
        try:
            # Получаем релевантные чанки из базы знаний
            chat_history = format_chat_history(messages[-5:] if len(messages) > 5 else messages)
            search_results = await search_relevant_chunks(last_user_content, chat_history)
            
            if search_results["hasContext"]:
                rag_context = search_results["contextText"]
                
                # Добавляем инструкцию по использованию контекста
                rag_context += "\n\nВАЖНО: Используй информацию выше для ответа на вопрос пользователя. Если информация релевантна, ссылайся на источники в своем ответе, используя номера в квадратных скобках, например [1].\n\n"
        
        except Exception as e:
            logger.error(f"Ошибка при поиске релевантного контекста: {e}")
    
    # Обработка вложений (если есть)
    if attachments and len(attachments) > 0:
        file_info = "### ЗАГРУЖЕННЫЕ ФАЙЛЫ ###\n"
        
        for file in attachments:
            file_name = file.get("name", "Unnamed file")
            file_type = file.get("type", "unknown type")
            file_size = file.get("size", 0)
            
            # Форматируем размер файла
            if file_size < 1024:
                size_str = f"{file_size} B"
            elif file_size < 1048576:
                size_str = f"{file_size / 1024:.1f} KB"
            else:
                size_str = f"{file_size / 1048576:.1f} MB"
            
            file_info += f"Файл: {file_name} ({file_type}, {size_str})\n"
            
            # Особая обработка CSV-файлов
            if (file_type == "text/csv" or file_name.lower().endswith('.csv')) and "content" in file:
                try:
                    content = file.get("content", "")
                    lines = content.split("\n")
                    line_count = len(lines)
                    first_line = lines[0] if lines else ""
                    column_count = len(first_line.split(","))
                    
                    file_info += f"CSV файл: {line_count} строк, {column_count} столбцов\n"
                    file_info += f"Заголовки: {first_line}\n\n"
                    
                    # Включаем первые 20 строк или все, если меньше 20
                    file_info += "Содержимое CSV файла (первые строки):\n"
                    lines_to_show = min(20, line_count)
                    
                    for i in range(lines_to_show):
                        if i < len(lines):
                            file_info += f"{lines[i]}\n"
                    
                    if line_count > lines_to_show:
                        file_info += f"... (и еще {line_count - lines_to_show} строк)\n"
                    
                    file_info += "\n"
                
                except Exception as e:
                    logger.error(f"Ошибка при обработке CSV файла: {e}")
            
            # Включаем содержимое текстовых файлов если не слишком большие
            elif "content" in file and len(file.get("content", "")) < 5000:
                file_info += "Содержимое файла:\n"
                content = file.get("content", "")
                if len(content) > 3000:
                    file_info += content[:3000] + "\n... (содержимое обрезано для краткости)\n"
                else:
                    file_info += content + "\n"
                file_info += "\n"
        
        file_info += "### КОНЕЦ СПИСКА ФАЙЛОВ ###\n\n"
    
    # Собираем полный промпт
    full_prompt = system_prompt + "\n\n"
    
    if rag_context:
        full_prompt += rag_context + "\n\n"
    
    if file_info:
        full_prompt += file_info + "\n\n"
    
    # Добавляем историю сообщений
    full_prompt += format_chat_history(messages) + "\n\n"
    
    # Напоминание для LLM
    full_prompt += "НАПОМИНАНИЕ: Дай информативный и точный ответ на вопрос пользователя, опираясь на содержимое загруженных файлов. НИКОГДА не придумывай данные, которых нет в файлах.\n\n"
    
    # Повторяем последний вопрос пользователя для ясности
    if last_user_message:
        full_prompt += f'Вопрос пользователя: "{last_user_content}"\n\n'
    
    # Префикс для ответа LLM
    full_prompt += "Ассистент: "
    
    return full_prompt


async def generate_stream_response(
    messages: List[Dict[str, str]],
    attachments: List[Dict[str, Any]] = None,
    model: str = None,
    on_chunk: Callable[[str], Awaitable[bool]] = None
) -> None:
    """
    Генерирует ответ LLM в потоковом режиме с отправкой чанков через callback
    """
    logger.info(f"Генерация ответа для модели: {model or settings.DEFAULT_MODEL}")
    
    # Определение модели, если не указана
    model_id = model or settings.DEFAULT_MODEL
    
    try:
        # Форматируем промпт с учетом RAG и вложений
        prompt = await format_prompt(messages, attachments)
        
        # Создаем callback handler для потоковой передачи ответа
        callback_handler = StreamingCallbackHandler(on_chunk)
        
        # Используем Ollama API напрямую для лучшего контроля потока
        if settings.LLM_TYPE == "ollama":
            # URL для Ollama API
            ollama_url = settings.LLM_API_URL
            if not ollama_url.endswith("/generate"):
                ollama_url = ollama_url.rstrip("/") + "/generate"
            
            # Параметры запроса
            data = {
                "model": model_id,
                "prompt": prompt,
                "stream": True
            }
            
            # Отправляем запрос и обрабатываем поток ответа
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", ollama_url, json=data) as response:
                    buffer = ""
                    
                    async for chunk in response.aiter_text():
                        buffer += chunk
                        
                        # Обрабатываем буфер построчно
                        while "\n" in buffer:
                            line_end = buffer.index("\n")
                            line = buffer[:line_end]
                            buffer = buffer[line_end + 1:]
                            
                            if line.strip():
                                try:
                                    line_data = json.loads(line)
                                    
                                    # Проверяем наличие текста в ответе
                                    if "response" in line_data:
                                        response_text = line_data["response"]
                                        if response_text:
                                            # Отправляем через callback и проверяем, нужно ли продолжать
                                            should_continue = await on_chunk(response_text)
                                            if should_continue is False:
                                                # Остановка генерации
                                                return
                                    
                                    # Если генерация завершена, выходим
                                    if line_data.get("done", False):
                                        return
                                
                                except json.JSONDecodeError:
                                    logger.warning(f"Неверный формат JSON в ответе: {line}")
                    
                    # Обрабатываем остаток буфера
                    if buffer.strip():
                        try:
                            buffer_data = json.loads(buffer)
                            if "response" in buffer_data:
                                await on_chunk(buffer_data["response"])
                        except json.JSONDecodeError:
                            logger.warning(f"Неверный формат JSON в остатке буфера")
        
        else:
            # Fallback к LangChain, если Ollama API недоступен
            logger.warning("Ollama API недоступен, используем LangChain")
            
            # Создаем экземпляр LLM с потоковым выводом
            llm = Ollama(
                model=model_id,
                base_url=settings.LLM_API_URL.rstrip("/api/generate"),
                callbacks=[callback_handler]
            )
            
            # Генерируем ответ
            _ = await llm.agenerate(prompts=[prompt])
    
    except Exception as e:
        logger.exception(f"Ошибка при генерации ответа: {e}")
        raise