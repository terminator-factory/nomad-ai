import logging
import os
import json
import shutil
import uuid
import hashlib
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
import asyncio
from pathlib import Path

from app.core.config import settings
from app.services.vector_store import (
    create_vector_store,
    add_chunks_to_vector_store,
    similarity_search,
    delete_document_from_vector_store,
    get_vector_store_stats
)
from app.services.embeddings import generate_embedding

logger = logging.getLogger(__name__)

# Путь к файлу индекса хэшей
HASH_INDEX_PATH = settings.DATA_DIR / "hash_index.json"

# Хранение метаданных файлов и хеш-индекс
file_metadata = {}
hash_index = {}  # Отображение хэша содержимого на ID файла


def load_hash_index():
    """
    Загружает индекс хешей с диска
    """
    global hash_index
    try:
        if HASH_INDEX_PATH.exists():
            with open(HASH_INDEX_PATH, "r", encoding="utf-8") as f:
                hash_index = json.load(f)
            logger.info(f"Загружен индекс хешей с {len(hash_index)} записями")
        else:
            hash_index = {}
            save_hash_index()
    except Exception as e:
        logger.error(f"Ошибка при загрузке индекса хешей: {e}")
        hash_index = {}
        save_hash_index()


def save_hash_index():
    """
    Сохраняет индекс хешей на диск
    """
    try:
        with open(HASH_INDEX_PATH, "w", encoding="utf-8") as f:
            json.dump(hash_index, f, ensure_ascii=False, indent=2)
        logger.info(f"Сохранен индекс хешей с {len(hash_index)} записями")
    except Exception as e:
        logger.error(f"Ошибка при сохранении индекса хешей: {e}")


def load_file_metadata():
    """
    Загружает метаданные файлов из директории
    """
    global file_metadata
    try:
        metadata_dir = settings.METADATA_DIR
        if metadata_dir.exists():
            metadata_files = list(metadata_dir.glob("*.json"))
            logger.info(f"Найдено {len(metadata_files)} файлов метаданных для загрузки")
            
            for file_path in metadata_files:
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        metadata = json.load(f)
                    
                    if metadata and "id" in metadata:
                        file_metadata[metadata["id"]] = metadata
                except Exception as e:
                    logger.error(f"Ошибка при чтении файла метаданных {file_path}: {e}")
            
            logger.info(f"Загружены метаданные для {len(file_metadata)} файлов")
        else:
            file_metadata = {}
    except Exception as e:
        logger.error(f"Ошибка при загрузке метаданных файлов: {e}")
        file_metadata = {}


def calculate_content_hash(content: str) -> str:
    """
    Вычисляет MD5-хеш содержимого файла
    """
    if not content or not isinstance(content, str):
        logger.warning("Недопустимое содержимое для хеширования")
        return ""
    
    return hashlib.md5(content.encode("utf-8")).hexdigest()


async def get_file_content(file_id: str) -> Optional[str]:
    """
    Получает содержимое файла по ID
    """
    try:
        content_path = settings.CONTENT_DIR / f"{file_id}.txt"
        
        if not content_path.exists():
            logger.warning(f"Содержимое файла не найдено: {file_id}")
            return None
        
        with open(content_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        logger.error(f"Ошибка при получении содержимого файла {file_id}: {e}")
        return None


async def delete_document(file_id: str) -> bool:
    """
    Удаляет документ по ID
    """
    try:
        metadata = file_metadata.get(file_id)
        if not metadata:
            logger.warning(f"Файл не найден для удаления: {file_id}")
            return False
        
        # Удаляем из хеш-индекса
        if "contentHash" in metadata and hash_index.get(metadata["contentHash"]) == file_id:
            del hash_index[metadata["contentHash"]]
            save_hash_index()
        
        # Удаляем файл метаданных
        meta_path = settings.METADATA_DIR / f"{file_id}.json"
        if meta_path.exists():
            os.remove(meta_path)
        
        # Удаляем файл содержимого
        content_path = settings.CONTENT_DIR / f"{file_id}.txt"
        if content_path.exists():
            os.remove(content_path)
        
        # Удаляем из индекса в памяти
        if file_id in file_metadata:
            del file_metadata[file_id]
        
        # Удаляем из векторного хранилища
        await delete_document_from_vector_store(file_id)
        
        logger.info(f"Файл успешно удален: {file_id}")
        return True
    except Exception as e:
        logger.error(f"Ошибка при удалении файла {file_id}: {e}")
        return False


async def get_knowledge_base_documents() -> List[Dict[str, Any]]:
    """
    Получает все метаданные файлов
    """
    return list(file_metadata.values())


def split_into_chunks(text: str, chunk_size: int = None, chunk_overlap: int = None) -> List[str]:
    """
    Разделяет текст на чанки с заданным размером и перекрытием
    """
    if not text or not isinstance(text, str):
        logger.warning("Неверный текст для разделения на чанки")
        return []
    
    # Используем значения из настроек, если не указаны
    chunk_size = chunk_size or settings.CHUNK_SIZE
    chunk_overlap = chunk_overlap or settings.CHUNK_OVERLAP
    
    chunks = []
    i = 0
    
    # Обработка коротких текстов
    if len(text) <= chunk_size:
        return [text]
    
    while i < len(text):
        # Вычисляем конечную позицию с учетом возможного перекрытия
        end = min(i + chunk_size, len(text))
        chunks.append(text[i:end])
        
        # Переходим к следующей позиции с учетом перекрытия
        i += chunk_size - chunk_overlap
        
        # Если мы приближаемся к концу, избегаем создания маленьких чанков
        if i + chunk_size - chunk_overlap >= len(text):
            break
    
    # Проверяем, что у нас есть хотя бы один чанк
    if not chunks and text:
        chunks.append(text)
    
    return chunks


def split_csv_into_chunks(csv_text: str, chunk_size: int = None, chunk_overlap: int = None) -> List[str]:
    """
    Разделяет CSV на чанки, сохраняя заголовки
    """
    try:
        # Разделяем на строки
        lines = csv_text.split('\n')
        lines = [line for line in lines if line.strip()]
        
        if len(lines) <= 1:
            # Только заголовок или пустой файл
            return [csv_text]
        
        headers = lines[0]
        data_rows = lines[1:]
        
        # Используем значения из настроек, если не указаны
        chunk_size = chunk_size or settings.CHUNK_SIZE
        chunk_overlap = chunk_overlap or settings.CHUNK_OVERLAP
        
        # Оцениваем количество строк в чанке исходя из размера чанка
        avg_row_length = sum(len(row) for row in data_rows) / len(data_rows) if data_rows else 0
        rows_per_chunk = max(1, int(chunk_size / (avg_row_length or 1)))
        rows_overlap = max(1, int(chunk_overlap / (avg_row_length or 1)))
        
        chunks = []
        i = 0
        
        while i < len(data_rows):
            # Вычисляем конечную позицию
            end = min(i + rows_per_chunk, len(data_rows))
            
            # Создаем чанк с заголовками + выбранные строки
            chunk_rows = [headers] + data_rows[i:end]
            chunks.append('\n'.join(chunk_rows))
            
            # Переходим к следующей позиции с учетом перекрытия
            i += rows_per_chunk - rows_overlap
            
            # Если мы приближаемся к концу, избегаем создания маленьких чанков
            if i + rows_per_chunk - rows_overlap >= len(data_rows):
                break
        
        return chunks
    except Exception as e:
        logger.error(f"Ошибка при разделении CSV на чанки: {e}")
        
        # В случае ошибки используем стандартный метод разделения
        return split_into_chunks(csv_text, chunk_size, chunk_overlap)


def split_into_chunks_by_file_type(text: str, file_type: str, 
                                   chunk_size: int = None, 
                                   chunk_overlap: int = None) -> List[str]:
    """
    Разделяет текст на чанки с учетом типа файла
    """
    if not text or not isinstance(text, str):
        logger.warning("Недопустимый текст для разделения на чанки")
        return []
    
    # Для CSV файлов используем специальную стратегию
    if file_type and (file_type.lower().startswith('text/csv') or file_type.lower().endswith('.csv')):
        return split_csv_into_chunks(text, chunk_size, chunk_overlap)
    
    # Для других типов файлов используем стандартный метод
    return split_into_chunks(text, chunk_size, chunk_overlap)


async def process_document(file: Dict[str, Any], force_process: bool = False) -> Dict[str, Any]:
    """
    Обрабатывает документ и сохраняет в базе знаний
    """
    try:
        logger.info(f"Обработка документа: {file.get('name', 'Unnamed')} ({file.get('size', 0)} байт)")
        
        # Проверка валидности и дублирования
        if not file or 'name' not in file:
            return {
                "success": False,
                "error": "Недопустимый объект файла",
                "message": "Объект файла не содержит обязательных свойств."
            }
        
        if not file.get('content') or not isinstance(file.get('content'), str):
            logger.error(f"Не указано содержимое для файла: {file.get('name')}")
            return {
                "success": False,
                "error": "Не указано содержимое",
                "message": "Документ не содержит содержимого для обработки."
            }
        
        # Генерируем хеш содержимого
        content_hash = calculate_content_hash(file['content'])
        
        # Проверяем, обрабатывали ли мы этот файл ранее
        existing_file = await find_file_by_hash(content_hash)
        if existing_file and not force_process:
            logger.info(f"Документ с таким же содержимым уже существует: {existing_file.get('fileName')}")
            return {
                "success": True,
                "isDuplicate": True,
                "existingFile": existing_file,
                "message": "Документ с идентичным содержимым уже существует."
            }
        
        # Определяем тип файла по имени если не указан
        file_type = file.get('type', '')
        if not file_type and 'name' in file:
            ext = file['name'].split('.')[-1].lower() if '.' in file['name'] else ''
            if ext == 'csv':
                file_type = 'text/csv'
            elif ext in ['html', 'htm']:
                file_type = 'text/html'
            elif ext in ['md', 'markdown']:
                file_type = 'text/markdown'
            elif ext == 'json':
                file_type = 'application/json'
            elif ext in ['js', 'jsx']:
                file_type = 'application/javascript'
            elif ext in ['ts', 'tsx']:
                file_type = 'application/typescript'
            else:
                file_type = 'text/plain'
        
        # Генерируем метаданные документа
        doc_id = str(uuid.uuid4())
        metadata = {
            "id": doc_id,
            "fileName": file.get('name', 'untitled.txt'),
            "fileType": file_type or 'text/plain',
            "fileSize": file.get('size', len(file.get('content', ''))),
            "contentHash": content_hash,
            "createdAt": datetime.now().isoformat(),
            "chunkCount": 0,
            "isCSV": file_type == 'text/csv' or file.get('name', '').lower().endswith('.csv')
        }
        
        # Добавляем информацию о CSV, если это CSV-файл
        if metadata["isCSV"] and 'csvInfo' in file:
            metadata["csvInfo"] = {
                "rowCount": file['csvInfo'].get('rowCount', 0),
                "columnCount": file['csvInfo'].get('columnCount', 0),
                "headers": ','.join(file['csvInfo'].get('headers', []))
            }
        
        logger.info(f"Создаем метаданные для документа: {doc_id} ({file.get('name')})")
        
        # Разделяем содержимое на чанки с учетом типа файла
        chunks = split_into_chunks_by_file_type(file['content'], file_type)
        logger.info(f"Документ разделен на {len(chunks)} чанков")
        
        # Обрабатываем каждый чанк и генерируем эмбеддинги
        processed_chunks = []
        for i, chunk in enumerate(chunks):
            chunk_id = f"{doc_id}-chunk-{i}"
            
            try:
                # Генерируем эмбеддинг для чанка
                embedding = await generate_embedding(chunk)
                
                if not embedding or not isinstance(embedding, list):
                    logger.error(f"Не удалось сгенерировать эмбеддинг для чанка {i} документа {doc_id}")
                    continue
                
                chunk_metadata = {
                    **metadata,
                    "chunkId": chunk_id,
                    "chunkIndex": i,
                    "chunkSize": len(chunk),
                    "chunkTotal": len(chunks)
                }
                
                processed_chunks.append({
                    "id": chunk_id,
                    "text": chunk,
                    "embedding": embedding,
                    "metadata": chunk_metadata
                })
                
                logger.info(f"Обработан чанк {i+1}/{len(chunks)} для {doc_id}")
            
            except Exception as e:
                logger.error(f"Ошибка при обработке чанка {i} документа {doc_id}: {e}")
        
        # Сохраняем метаданные документа
        metadata["chunkCount"] = len(processed_chunks)
        save_result = await save_file_meta(metadata, file['content'])
        
        if not save_result:
            logger.error(f"Не удалось сохранить метаданные для {doc_id}")
            return {
                "success": False,
                "error": "Не удалось сохранить метаданные документа",
                "message": "Не удалось сохранить метаданные документа на диск."
            }
        
        logger.info(f"Сохранены метаданные для {doc_id} с {len(processed_chunks)} чанками")
        
        # Сохраняем все чанки в векторное хранилище
        saved_chunks = await add_chunks_to_vector_store(processed_chunks)
        logger.info(f"Добавлено {saved_chunks}/{len(processed_chunks)} чанков в векторное хранилище для {doc_id}")
        
        # Проверяем статистику векторного хранилища после сохранения
        stats = await get_vector_store_stats()
        logger.info(f"Статистика векторного хранилища после сохранения: {stats}")
        
        return {
            "success": True,
            "isDuplicate": False,
            "documentId": doc_id,
            "metadata": metadata,
            "chunks": len(processed_chunks),
            "message": f"Документ успешно обработан. Создано {len(processed_chunks)} чанков."
        }
        
    except Exception as e:
        logger.exception(f"Ошибка при обработке документа: {e}")
        return {
            "success": False,
            "error": str(e),
            "message": "Не удалось обработать документ."
        }


async def process_attachments(attachments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Обрабатывает вложения и сохраняет их в базе знаний
    """
    if not attachments or len(attachments) == 0:
        return []
    
    logger.info(f"Обработка {len(attachments)} вложений для RAG")
    
    results = []
    
    for file in attachments:
        if not file.get('content') or not isinstance(file.get('content'), str):
            logger.warning(f"Файл {file.get('name', 'Unnamed')} не содержит содержимого или содержимое неверного типа")
            results.append({
                "fileName": file.get('name', 'Unnamed'),
                "success": False,
                "message": "Не указано содержимое файла"
            })
            continue
        
        logger.info(f"Обработка файла: {file.get('name', 'Unnamed')} ({file.get('size', 0)} байт)")
        
        try:
            # Обрабатываем документ для RAG
            process_result = await process_document(file)
            
            results.append({
                "fileName": file.get('name', 'Unnamed'),
                "success": process_result["success"],
                "isDuplicate": process_result.get("isDuplicate", False),
                "documentId": process_result.get("documentId"),
                "message": process_result.get("message")
            })
            
            if process_result["success"]:
                if process_result.get("isDuplicate"):
                    logger.info(f"Файл {file.get('name')} является дубликатом существующего документа")
                else:
                    logger.info(f"Файл {file.get('name')} успешно обработан, создано {process_result.get('chunks', 0)} чанков")
            else:
                logger.error(f"Не удалось обработать файл {file.get('name')}: {process_result.get('error')}")
                
        except Exception as e:
            logger.exception(f"Ошибка при обработке вложения {file.get('name')}: {e}")
            results.append({
                "fileName": file.get('name', 'Unnamed'),
                "success": False,
                "error": str(e),
                "message": "Ошибка при обработке файла"
            })
    
    return results


async def search_relevant_chunks(query: str, chat_history: str = "", limit: int = 5) -> Dict[str, Any]:
    """
    Поиск релевантных чанков для запроса
    """
    try:
        logger.info(f'Поиск чанков, релевантных запросу: "{query}"')
        
        if not query or not isinstance(query, str) or query.strip() == '':
            logger.warning('Пустой или неверный поисковый запрос')
            return {
                "hasContext": False,
                "contextText": "",
                "sources": []
            }
        
        # Генерируем эмбеддинг для запроса
        query_embedding = await generate_embedding(query)
        
        if not query_embedding or not isinstance(query_embedding, list):
            logger.error('Не удалось сгенерировать эмбеддинг для запроса')
            return {
                "hasContext": False,
                "contextText": "",
                "sources": []
            }
        
        # Ищем похожие чанки в векторном хранилище
        results = await similarity_search(query_embedding, limit)
        
        logger.info(f'Найдено {len(results)} релевантных чанков для запроса')
        
        # Для отладки показываем оценки похожести
        if results:
            logger.info(f'Оценка похожести лучшего результата: {results[0].get("score", 0)}')
        
        if not results:
            return {
                "hasContext": False,
                "contextText": "",
                "sources": []
            }
        
        # Форматируем полученные чанки
        context_text = '### Релевантная информация из базы знаний ###\n\n'
        sources = []
        
        # Отслеживаем включенные ID документов, чтобы избежать повторения информации об источниках
        included_doc_ids = set()
        
        for result in results:
            # Пропускаем, если нет текста или метаданных
            if not result.get('text') or not result.get('metadata'):
                continue
            
            # Добавляем текст чанка (обрезаем по количеству токенов при необходимости)
            context_text += f"{result['text']}\n\n"
            
            # Добавляем информацию об источнике, если она еще не включена
            doc_id = result['metadata'].get('id')
            if doc_id and doc_id not in included_doc_ids:
                included_doc_ids.add(doc_id)
                
                sources.append({
                    "id": doc_id,
                    "fileName": result['metadata'].get('fileName', 'Неизвестный файл'),
                    "similarity": f"{result.get('score', 0) * 100:.1f}%" if 'score' in result else 'Неизвестно'
                })
        
        # Если у нас есть мало контекста из чанков, пытаемся добавить 
        # прямое содержимое файла для контекста
        if included_doc_ids and len(results) < 3:
            for doc_id in included_doc_ids:
                content = await get_file_content(doc_id)
                metadata = await get_file_meta(doc_id)
                
                if content and metadata:
                    context_text += f"\nДополнительное содержимое из файла {metadata.get('fileName')}:\n"
                    
                    # Для CSV файлов показываем более структурированное содержимое
                    if metadata.get('fileType', '').startswith('text/csv') or metadata.get('fileName', '').lower().endswith('.csv'):
                        lines = content.split('\n')
                        headers = lines[0] if lines else ""
                        
                        context_text += f"Заголовки: {headers}\n"
                        context_text += f"Пример содержимого (первые 15 строк):\n"
                        
                        for i in range(min(15, len(lines))):
                            if i < len(lines):
                                context_text += f"{lines[i]}\n"
                    else:
                        # Для других текстовых файлов
                        context_text += f"Содержимое (фрагмент):\n{content[:2000]}"
                        if len(content) > 2000:
                            context_text += "\n... (содержимое обрезано)"
                    
                    context_text += '\n\n'
        
        # Добавляем сводку источников в конце
        if sources:
            context_text += '### Источники ###\n'
            for i, source in enumerate(sources):
                context_text += f"[{i+1}] {source['fileName']} (Релевантность: {source['similarity']})\n"
        
        return {
            "hasContext": True,
            "contextText": context_text,
            "sources": sources
        }
        
    except Exception as e:
        logger.exception(f'Ошибка при поиске релевантных чанков: {e}')
        return {
            "hasContext": False,
            "contextText": "",
            "sources": [],
            "error": str(e)
        }


# Инициализация при загрузке модуля
def initialize():
    """
    Инициализирует сервис документов
    """
    # Создаем необходимые директории
    settings.setup_directories()
    
    # Загружаем индекс хешей
    load_hash_index()
    
    # Загружаем метаданные файлов
    load_file_metadata()
    
    # Инициализируем векторное хранилище
    create_vector_store()
    
    logger.info("Сервис документов инициализирован")


# Инициализируем при импорте модуля
initialize() 


def find_file_by_hash(content_hash: str) -> Optional[Dict[str, Any]]:
    # Находит файл по хешу содержимого
    file_id = hash_index.get(content_hash)
    if not file_id:
        return None
    
    metadata = file_metadata.get(file_id)
    return metadata


async def save_file_meta(metadata: Dict[str, Any], content: str) -> bool:
    """
    Сохраняет метаданные и содержимое файла
    """
    try:
        # Создаем директории если нужно
        settings.setup_directories()
        
        # Убеждаемся, что у нас есть ID
        if "id" not in metadata:
            metadata["id"] = str(uuid.uuid4())
        
        # Добавляем временную метку если отсутствует
        if "createdAt" not in metadata:
            metadata["createdAt"] = datetime.now().isoformat()
        
        # Сохраняем метаданные
        meta_path = settings.METADATA_DIR / f"{metadata['id']}.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
        
        # Сохраняем содержимое
        content_path = settings.CONTENT_DIR / f"{metadata['id']}.txt"
        with open(content_path, "w", encoding="utf-8") as f:
            f.write(content)
        
        # Обновляем индекс в памяти
        file_metadata[metadata["id"]] = metadata
        
        # Обновляем хеш-индекс если у нас есть хеш содержимого
        if "contentHash" in metadata:
            hash_index[metadata["contentHash"]] = metadata["id"]
            save_hash_index()
        
        logger.info(f"Файл успешно сохранен: {metadata.get('fileName', 'Unnamed')} ({metadata['id']})")
        return True
    except Exception as e:
        logger.error(f"Ошибка при сохранении метаданных файла: {e}")
        return False


async def get_file_meta(file_id: str) -> Optional[Dict[str, Any]]:
    """
    Получает метаданные файла по ID
    """
    return file_metadata.get(file_id)


async def find_file_by_hash(content_hash: str) -> Optional[Dict[str, Any]]:
    """
    Находит файл по хешу содержимого
    """
    file_id = hash_index.get(content_hash)
    if not file_id:
        return None
    
    metadata = file_metadata.get(file_id)
    return metadata