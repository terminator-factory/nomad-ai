import logging
import json
import asyncio
from typing import List, Dict, Any, Optional, Union
import numpy as np
import os
from pathlib import Path
import faiss
import pickle

from app.core.config import settings
from app.services.embeddings import cosine_similarity

logger = logging.getLogger(__name__)

# Пути к файлам векторного хранилища
VECTOR_STORE_PATH = settings.DATA_DIR / "vector_store.json"
VECTOR_INDEX_PATH = settings.DATA_DIR / "vector_index.json"
FAISS_INDEX_PATH = settings.VECTORS_DIR / "faiss_index.bin"

# Хранилище векторов и их метаданных в памяти
vector_store = []
vector_index = {}  # Отображение от ID документа к позициям в векторном хранилище

# FAISS индекс для быстрого поиска по векторам
faiss_index = None


def ensure_directories_exist():
    """Создает необходимые директории для хранения векторов"""
    for directory in [
        settings.DATA_DIR,
        settings.VECTORS_DIR
    ]:
        directory.mkdir(parents=True, exist_ok=True)


def save_vector_store():
    """Сохраняет векторное хранилище на диск"""
    ensure_directories_exist()
    try:
        # Создаем копию хранилища без эмбеддингов для сохранения в JSON
        # (эмбеддинги сохраняются в FAISS индексе)
        serializable_store = []
        for item in vector_store:
            item_copy = item.copy()
            # Удаляем эмбеддинг из копии, чтобы уменьшить размер JSON
            if 'embedding' in item_copy:
                del item_copy['embedding']
            serializable_store.append(item_copy)
        
        with open(VECTOR_STORE_PATH, 'w', encoding='utf-8') as f:
            json.dump(serializable_store, f, ensure_ascii=False)
        
        logger.info(f"Сохранено {len(vector_store)} векторов в хранилище")
    except Exception as e:
        logger.error(f"Ошибка при сохранении векторного хранилища: {e}")


def save_vector_index():
    """Сохраняет индекс векторного хранилища на диск"""
    ensure_directories_exist()
    try:
        with open(VECTOR_INDEX_PATH, 'w', encoding='utf-8') as f:
            json.dump(vector_index, f, ensure_ascii=False)
        
        logger.info(f"Сохранен индекс векторного хранилища с {len(vector_index)} записями")
    except Exception as e:
        logger.error(f"Ошибка при сохранении индекса векторного хранилища: {e}")


async def save_all():
    """Сохраняет все данные векторного хранилища"""
    try:
        ensure_directories_exist()
        
        # Сохраняем базовое хранилище
        save_vector_store()
        
        # Сохраняем индекс
        save_vector_index()
        
        # Сохраняем FAISS индекс, если он существует
        if faiss_index is not None:
            faiss.write_index(faiss_index, str(FAISS_INDEX_PATH))
            logger.info(f"Сохранен FAISS индекс")
        
        return True
    except Exception as e:
        logger.error(f"Ошибка при сохранении векторного хранилища: {e}")
        return False


def load_vector_store():
    """Загружает векторное хранилище с диска"""
    global vector_store
    try:
        if VECTOR_STORE_PATH.exists():
            with open(VECTOR_STORE_PATH, 'r', encoding='utf-8') as f:
                vector_store = json.load(f)
            
            logger.info(f"Загружено {len(vector_store)} векторов из хранилища")
        else:
            vector_store = []
            save_vector_store()
    except Exception as e:
        logger.error(f"Ошибка при загрузке векторного хранилища: {e}")
        vector_store = []
        save_vector_store()


def load_vector_index():
    """Загружает индекс векторного хранилища с диска"""
    global vector_index
    try:
        if VECTOR_INDEX_PATH.exists():
            with open(VECTOR_INDEX_PATH, 'r', encoding='utf-8') as f:
                vector_index = json.load(f)
            
            logger.info(f"Загружен индекс векторного хранилища с {len(vector_index)} записями")
        else:
            vector_index = {}
            save_vector_index()
    except Exception as e:
        logger.error(f"Ошибка при загрузке индекса векторного хранилища: {e}")
        vector_index = {}
        save_vector_index()


def rebuild_faiss_index():
    """Перестраивает FAISS индекс из текущих данных в vector_store"""
    global faiss_index
    
    try:
        # Если vector_store пуст, создаем пустой индекс
        if not vector_store:
            # Используем размерность по умолчанию для пустого индекса
            dimension = 384  # Стандартная размерность для наших эмбеддингов
            faiss_index = faiss.IndexFlatIP(dimension)  # Индекс с косинусным сходством
            logger.info(f"Создан пустой FAISS индекс с размерностью {dimension}")
            return
        
        # Извлекаем все эмбеддинги из vector_store
        embeddings = []
        valid_indices = []
        
        for i, item in enumerate(vector_store):
            if 'embedding' in item and isinstance(item['embedding'], list):
                embeddings.append(item['embedding'])
                valid_indices.append(i)
        
        if not embeddings:
            # Если нет валидных эмбеддингов, создаем пустой индекс
            dimension = 384
            faiss_index = faiss.IndexFlatIP(dimension)
            logger.warning("Нет валидных эмбеддингов для построения FAISS индекса")
            return
        
        # Преобразуем в numpy массив
        embeddings_array = np.array(embeddings).astype('float32')
        
        # Создаем новый индекс
        dimension = embeddings_array.shape[1]
        new_index = faiss.IndexFlatIP(dimension)
        
        # Добавляем векторы в индекс
        new_index.add(embeddings_array)
        
        # Заменяем существующий индекс
        faiss_index = new_index
        
        # Сохраняем индекс на диск
        faiss.write_index(faiss_index, str(FAISS_INDEX_PATH))
        
        logger.info(f"Перестроен FAISS индекс с {len(embeddings)} векторами размерности {dimension}")
    
    except Exception as e:
        logger.error(f"Ошибка при перестройке FAISS индекса: {e}")


def load_faiss_index():
    """Загружает FAISS индекс с диска или создает новый"""
    global faiss_index
    
    try:
        if FAISS_INDEX_PATH.exists():
            faiss_index = faiss.read_index(str(FAISS_INDEX_PATH))
            logger.info(f"Загружен FAISS индекс с {faiss_index.ntotal} векторами")
        else:
            # Если файла индекса нет, перестраиваем его
            rebuild_faiss_index()
    except Exception as e:
        logger.error(f"Ошибка при загрузке FAISS индекса: {e}, перестраиваем")
        rebuild_faiss_index()


def restore_embeddings():
    """
    Восстанавливает эмбеддинги в vector_store из FAISS индекса
    Это необходимо, так как мы не сохраняем эмбеддинги в JSON для экономии места
    """
    global vector_store
    
    if not faiss_index or faiss_index.ntotal == 0 or not vector_store:
        return
    
    try:
        # Извлекаем все векторы из FAISS индекса
        all_embeddings = faiss_index.reconstruct_n(0, faiss_index.ntotal)
        
        # Восстанавливаем эмбеддинги в vector_store
        for i, embedding in enumerate(all_embeddings):
            if i < len(vector_store):
                vector_store[i]['embedding'] = embedding.tolist()
        
        logger.info(f"Восстановлены эмбеддинги для {len(all_embeddings)} векторов")
    
    except Exception as e:
        logger.error(f"Ошибка при восстановлении эмбеддингов: {e}")


def create_vector_store():
    """Инициализирует векторное хранилище"""
    ensure_directories_exist()
    
    # Загружаем данные с диска
    load_vector_store()
    load_vector_index()
    load_faiss_index()
    
    # Проверяем и восстанавливаем эмбеддинги, если необходимо
    restore_embeddings()
    
    logger.info(f"Векторное хранилище инициализировано: {len(vector_store)} векторов, {len(vector_index)} документов")


async def add_chunks_to_vector_store(chunks: List[Dict[str, Any]]) -> int:
    """
    Добавляет чанки в векторное хранилище
    
    Args:
        chunks: Список чанков с текстом, эмбеддингами и метаданными
        
    Returns:
        Количество успешно добавленных чанков
    """
    global vector_store, vector_index, faiss_index
    
    if not chunks:
        return 0
    
    try:
        # Проверяем, что у нас есть FAISS индекс
        if faiss_index is None:
            rebuild_faiss_index()
        
        saved_chunks = 0
        new_embeddings = []
        new_indices = []
        
        # Обрабатываем каждый чанк
        for chunk in chunks:
            # Проверяем наличие обязательных полей
            if not chunk or 'id' not in chunk or 'text' not in chunk or 'embedding' not in chunk or 'metadata' not in chunk:
                logger.error(f"Недопустимые данные чанка: {chunk}")
                continue
            
            # Проверяем, существует ли этот чанк уже
            existing_index = next((i for i, v in enumerate(vector_store) if v.get('id') == chunk['id']), -1)
            
            if existing_index != -1:
                # Обновляем существующий чанк
                vector_store[existing_index] = chunk
                if faiss_index and existing_index < faiss_index.ntotal:
                    # Также обновляем эмбеддинг в FAISS индексе
                    embedding_array = np.array([chunk['embedding']]).astype('float32')
                    faiss_index.remove_ids(np.array([existing_index]))
                    faiss_index.add(embedding_array)
            else:
                # Добавляем новый чанк
                vector_store.append(chunk)
                
                # Собираем эмбеддинги для пакетного добавления в FAISS
                new_embeddings.append(chunk['embedding'])
                new_indices.append(len(vector_store) - 1)
            
            # Обновляем индекс документов
            if 'metadata' in chunk and 'id' in chunk['metadata']:
                doc_id = chunk['metadata']['id']
                
                if doc_id not in vector_index:
                    vector_index[doc_id] = []
                
                # Добавляем позицию этого чанка в индекс документа
                chunk_position = existing_index if existing_index != -1 else (len(vector_store) - 1)
                if chunk_position not in vector_index[doc_id]:
                    vector_index[doc_id].append(chunk_position)
            
            saved_chunks += 1
        
        # Добавляем новые эмбеддинги в FAISS индекс одним пакетом
        if new_embeddings:
            embeddings_array = np.array(new_embeddings).astype('float32')
            if faiss_index is None:
                # Если индекс еще не создан, создаем его
                dimension = embeddings_array.shape[1]
                faiss_index = faiss.IndexFlatIP(dimension)
            
            faiss_index.add(embeddings_array)
        
        # Сохраняем изменения на диск
        await save_all()
        
        return saved_chunks
    
    except Exception as e:
        logger.exception(f"Ошибка при добавлении чанков в векторное хранилище: {e}")
        return 0


async def get_document_chunks(document_id: str) -> List[Dict[str, Any]]:
    """
    Получает все чанки документа
    
    Args:
        document_id: ID документа
        
    Returns:
        Список чанков документа
    """
    if document_id not in vector_index:
        return []
    
    chunks = []
    
    for position in vector_index[document_id]:
        if 0 <= position < len(vector_store):
            chunks.append(vector_store[position])
    
    return chunks


async def delete_document_from_vector_store(document_id: str) -> bool:
    """
    Удаляет документ из векторного хранилища
    
    Args:
        document_id: ID документа
        
    Returns:
        True, если документ успешно удален
    """
    global vector_store, vector_index, faiss_index
    
    try:
        if document_id not in vector_index:
            return True  # Документ не существует, ничего делать не нужно
        
        # Получаем позиции чанков документа
        chunk_positions = vector_index[document_id]
        
        # Создаем массив для удаления из FAISS
        if faiss_index and chunk_positions:
            ids_to_remove = np.array(chunk_positions)
            # Проверяем диапазон индексов перед удалением
            valid_ids = ids_to_remove[ids_to_remove < faiss_index.ntotal]
            if len(valid_ids) > 0:
                faiss_index.remove_ids(valid_ids)
        
        # Удаляем чанки документа из vector_store
        vector_store = [chunk for i, chunk in enumerate(vector_store) 
                        if i not in chunk_positions]
        
        # Удаляем документ из индекса
        del vector_index[document_id]
        
        # Перестраиваем индекс, так как позиции изменились
        rebuild_vector_index()
        
        # Сохраняем изменения
        await save_all()
        
        return True
    
    except Exception as e:
        logger.exception(f"Ошибка при удалении документа из векторного хранилища: {e}")
        return False


def rebuild_vector_index():
    """
    Перестраивает индекс векторного хранилища после изменений
    """
    global vector_index
    
    # Очищаем индекс
    vector_index = {}
    
    # Перестраиваем индекс
    for i, chunk in enumerate(vector_store):
        if 'metadata' in chunk and 'id' in chunk['metadata']:
            doc_id = chunk['metadata']['id']
            
            if doc_id not in vector_index:
                vector_index[doc_id] = []
            
            vector_index[doc_id].append(i)


async def similarity_search(query_embedding: List[float], limit: int = 5, threshold: float = 0.4) -> List[Dict[str, Any]]:
    """
    Поиск похожих чанков
    
    Args:
        query_embedding: Эмбеддинг запроса
        limit: Максимальное количество результатов
        threshold: Минимальное значение сходства (0-1)
        
    Returns:
        Похожие чанки с оценками
    """
    try:
        if not vector_store:
            logger.info("Векторное хранилище пусто")
            return []
        
        if not query_embedding or not isinstance(query_embedding, list):
            logger.error("Недопустимый эмбеддинг запроса")
            return []
        
        results = []
        
        # Используем FAISS для быстрого поиска, если доступен
        if faiss_index and faiss_index.ntotal > 0:
            # Преобразуем запрос в нужный формат
            query_np = np.array([query_embedding]).astype('float32')
            
            # Выполняем поиск с большим limit для компенсации возможных фильтров
            search_limit = min(limit * 3, faiss_index.ntotal)
            scores, indices = faiss_index.search(query_np, search_limit)
            
            # Получаем результаты
            for i, (score, idx) in enumerate(zip(scores[0], indices[0])):
                if idx < 0 or idx >= len(vector_store):
                    continue
                
                if score < threshold:
                    continue
                
                chunk = vector_store[idx]
                results.append({
                    **chunk,
                    "score": float(score)
                })
            
            # Сортируем по оценке
            results.sort(key=lambda x: x["score"], reverse=True)
            
            # Ограничиваем количество результатов
            results = results[:limit]
        
        else:
            # Fallback на вычисление косинусного сходства для всех векторов
            logger.warning("FAISS индекс недоступен, используем прямое вычисление сходства")
            
            for chunk in vector_store:
                if 'embedding' not in chunk or not isinstance(chunk['embedding'], list):
                    continue
                
                try:
                    score = cosine_similarity(query_embedding, chunk['embedding'])
                    
                    if score >= threshold:
                        results.append({
                            **chunk,
                            "score": score
                        })
                except Exception as e:
                    logger.error(f"Ошибка при вычислении сходства для чанка {chunk.get('id')}: {e}")
            
            # Сортируем по оценке и ограничиваем количество результатов
            results.sort(key=lambda x: x["score"], reverse=True)
            results = results[:limit]
        
        return results
    
    except Exception as e:
        logger.exception(f"Ошибка при поиске похожих чанков: {e}")
        return []


async def get_vector_store_stats() -> Dict[str, Any]:
    """
    Получает статистику о векторном хранилище
    
    Returns:
        Статистика о векторном хранилище
    """
    doc_count = len(vector_index)
    
    return {
        "totalVectors": len(vector_store),
        "totalDocuments": doc_count,
        "averageChunksPerDocument": len(vector_store) / doc_count if doc_count else 0,
        "faissIndexSize": faiss_index.ntotal if faiss_index else 0
    }


# Функция проверки целостности и восстановления векторного хранилища
def check_and_repair_vector_store():
    """
    Проверяет целостность векторного хранилища и восстанавливает при необходимости
    """
    global vector_store, vector_index, faiss_index
    
    logger.info("Проверка целостности векторного хранилища...")
    
    # Проверяем, что vector_store является списком
    if not isinstance(vector_store, list):
        logger.error("Векторное хранилище не является списком, сбрасываем")
        vector_store = []
    
    # Проверяем, что vector_index является словарем
    if not isinstance(vector_index, dict):
        logger.error("Индекс векторного хранилища не является словарем, сбрасываем")
        vector_index = {}
    
    # Проверяем наличие валидных чанков и эмбеддингов
    invalid_chunks = 0
    
    for i in range(len(vector_store) - 1, -1, -1):
        chunk = vector_store[i]
        
        # Проверяем, что чанк валиден
        if (not chunk or 'id' not in chunk or 'text' not in chunk or 
                ('embedding' in chunk and not isinstance(chunk['embedding'], list))):
            vector_store.pop(i)
            invalid_chunks += 1
    
    if invalid_chunks > 0:
        logger.warning(f"Удалено {invalid_chunks} недопустимых чанков из векторного хранилища")
        rebuild_vector_index()
        rebuild_faiss_index()
        asyncio.create_task(save_all())
    
    logger.info("Проверка целостности векторного хранилища завершена")