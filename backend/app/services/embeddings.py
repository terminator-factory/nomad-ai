import logging
import os
import json
import hashlib
import asyncio
import httpx
import numpy as np
from typing import List, Dict, Any, Optional, Union
from pathlib import Path
from datetime import datetime

from app.core.config import settings

logger = logging.getLogger(__name__)

# Размер локальных эмбеддингов
LOCAL_EMBEDDING_SIZE = 384

# Путь к файлу кэша эмбеддингов
CACHE_FILE_PATH = settings.DATA_DIR / "embedding_cache.json"

# Кэш для эмбеддингов 
embedding_cache = {}


def ensure_cache_directory_exists():
    """
    Создает директорию для кэша, если она не существует
    """
    cache_dir = CACHE_FILE_PATH.parent
    if not cache_dir.exists():
        cache_dir.mkdir(parents=True, exist_ok=True)


def load_embedding_cache():
    """
    Загружает кэш эмбеддингов с диска
    """
    global embedding_cache
    
    ensure_cache_directory_exists()
    
    try:
        if CACHE_FILE_PATH.exists():
            with open(CACHE_FILE_PATH, 'r', encoding='utf-8') as f:
                embedding_cache = json.load(f)
            
            logger.info(f"Загружено {len(embedding_cache)} эмбеддингов из кэша")
        else:
            embedding_cache = {}
            save_embedding_cache()
    except Exception as e:
        logger.error(f"Ошибка при загрузке кэша эмбеддингов: {e}")
        embedding_cache = {}


def save_embedding_cache():
    """
    Сохраняет кэш эмбеддингов на диск
    """
    ensure_cache_directory_exists()
    
    try:
        # Ограничиваем размер кэша при необходимости
        if len(embedding_cache) > 10000:
            # Оставляем только последние 5000 записей
            keys = list(embedding_cache.keys())
            for key in keys[:-5000]:
                del embedding_cache[key]
        
        with open(CACHE_FILE_PATH, 'w', encoding='utf-8') as f:
            json.dump(embedding_cache, f, ensure_ascii=False)
            
        logger.info(f"Сохранено {len(embedding_cache)} эмбеддингов в кэш")
    except Exception as e:
        logger.error(f"Ошибка при сохранении кэша эмбеддингов: {e}")


def simple_tokenize(text: str) -> List[str]:
    """
    Простая токенизация для генерации локальных эмбеддингов
    """
    if not text or not isinstance(text, str):
        return []
    
    # Простая токенизация по словам и знакам препинания
    tokens = text.lower() \
        .replace("([.,!?;:()])", " $1 ") \
        .replace("\\s+", " ") \
        .strip() \
        .split(" ")
        
    return [token for token in tokens if token]


def generate_local_embedding(text: str) -> List[float]:
    """
    Генерирует детерминированный эмбеддинг на основе содержимого текста
    Это наивная реализация для случаев, когда внешние API недоступны
    """
    # Используем простую токенизацию
    tokens = simple_tokenize(text)
    
    # Создаем хеш из текста для использования в качестве сида
    hash_obj = hashlib.md5(text.encode('utf-8'))
    hash_hex = hash_obj.hexdigest()
    hash_num = int(hash_hex[:8], 16)
    
    # Инициализируем вектор эмбеддинга значениями, полученными из хеша
    embedding = [0.0] * LOCAL_EMBEDDING_SIZE
    
    # Заполняем вектор эмбеддинга на основе токенов и хеша
    for i, token in enumerate(tokens):
        position = i % LOCAL_EMBEDDING_SIZE
        
        # Генерируем хеш токена
        token_hash = hashlib.md5(token.encode('utf-8')).hexdigest()
        token_value = int(token_hash[:8], 16) / 0xffffffff
        
        # Смешиваем значение токена в эмбеддинг в этой позиции
        embedding[position] = (embedding[position] + token_value) % 1
        
        # Используем hash_num для добавления некоторой случайности, но детерминированно
        hash_num = (hash_num * 48271) % 0x7fffffff
        hash_value = hash_num / 0x7fffffff
        
        # Смешиваем значение хеша
        mix_position = (position + 7) % LOCAL_EMBEDDING_SIZE
        embedding[mix_position] = (embedding[mix_position] + hash_value * 0.5) % 1
    
    # Нормализуем эмбеддинг до единичной длины
    magnitude = np.sqrt(sum(val * val for val in embedding))
    if magnitude > 0:
        return [val / magnitude for val in embedding]
    
    # Если пустой или все нули, создаем случайный, но детерминированный эмбеддинг
    seed_random = []
    for i in range(LOCAL_EMBEDDING_SIZE):
        h = hashlib.md5(f"{text}_{i}".encode('utf-8')).hexdigest()
        seed_random.append(int(h[:8], 16) / 0xffffffff)
    
    seed_magnitude = np.sqrt(sum(val * val for val in seed_random))
    return [val / seed_magnitude for val in seed_random]


async def get_external_embedding(text: str) -> Optional[List[float]]:
    """
    Пытается получить эмбеддинги от внешнего API (например, Ollama)
    """
    try:
        # Используем текущий LLM URL для запроса эмбеддингов
        # Если Ollama не поддерживает эмбеддинги, просто вернем None
        llm_api_url = settings.LLM_API_URL
        ollama_base_url = llm_api_url
        
        # Пробуем извлечь базовый URL из API URL
        if "/api/generate" in ollama_base_url:
            ollama_base_url = ollama_base_url.replace("/api/generate", "")
        
        # Убеждаемся, что URL заканчивается правильно
        embedding_url = f"{ollama_base_url.rstrip('/')}/api/embeddings"
        
        logger.info(f"Получение эмбеддинга от: {embedding_url}")
        
        # Уменьшаем таймаут до 5 секунд для оперативности
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                embedding_url, 
                json={
                    "model": settings.EMBEDDING_MODEL,
                    "prompt": text
                }
            )
            
            # Обрабатываем разные форматы ответа API
            data = response.json()
            
            if "embedding" in data and isinstance(data["embedding"], list):
                return data["embedding"]
            elif "embeddings" in data and isinstance(data["embeddings"], list):
                return data["embeddings"][0] if data["embeddings"] else None
            else:
                logger.warning(f"Неожиданный формат ответа API эмбеддингов: {data}")
                return None
                
    except httpx.HTTPStatusError as e:
        # Если ошибка 404, значит API не поддерживает эмбеддинги
        if e.response.status_code == 404:
            logger.info("API эмбеддингов недоступен (404), используем локальные эмбеддинги")
        else:
            logger.warning(f"Ошибка HTTP при получении эмбеддинга: {e}")
        return None
        
    except Exception as e:
        logger.warning(f"Ошибка при получении внешнего эмбеддинга: {e}")
        return None


async def generate_embedding(text: str) -> List[float]:
    """
    Генерирует эмбеддинг для текста
    """
    if not text or not isinstance(text, str):
        logger.warning("Пустой или недопустимый текст для эмбеддинга, используем эмбеддинг по умолчанию")
        # Возвращаем эмбеддинг по умолчанию
        return [1 / np.sqrt(LOCAL_EMBEDDING_SIZE)] * LOCAL_EMBEDDING_SIZE
    
    # Нормализуем текст для кэширования
    normalized_text = text.strip().lower()
    
    # Создаем хеш текста для кэширования
    text_hash = hashlib.md5(normalized_text.encode('utf-8')).hexdigest()
    
    # Сначала проверяем кэш
    if text_hash in embedding_cache:
        return embedding_cache[text_hash]
    
    # Пробуем сначала внешний API, но всегда используем локальный, если он недоступен
    embedding = None
    
    # Если текст очень длинный (более 10000 символов), сразу используем локальные эмбеддинги
    if len(normalized_text) <= 10000:
        embedding = await get_external_embedding(normalized_text)
    
    # Если не получили эмбеддинги из API, генерируем локально
    if embedding is None:
        embedding = generate_local_embedding(normalized_text)
    
    # Кэшируем результат
    embedding_cache[text_hash] = embedding
    
    # Сохраняем в кэш периодически (не каждый раз для уменьшения I/O)
    if np.random.random() < 0.1:  # 10% вероятность сохранения
        save_embedding_cache()
    
    return embedding


def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """
    Вычисляет косинусное сходство между двумя векторами
    """
    if not isinstance(vec1, list) or not isinstance(vec2, list):
        logger.error("Недопустимые векторы для вычисления сходства")
        return 0
    
    # Обрабатываем разные размерности векторов, используя меньшую размерность
    length = min(len(vec1), len(vec2))
    
    if length == 0:
        return 0
    
    dot_product = 0
    mag1 = 0
    mag2 = 0
    
    for i in range(length):
        v1 = vec1[i] if i < len(vec1) else 0
        v2 = vec2[i] if i < len(vec2) else 0
        
        dot_product += v1 * v2
        mag1 += v1 * v1
        mag2 += v2 * v2
    
    mag1 = np.sqrt(mag1)
    mag2 = np.sqrt(mag2)
    
    if mag1 == 0 or mag2 == 0:
        return 0
    
    return dot_product / (mag1 * mag2)


# Инициализация при загрузке модуля
load_embedding_cache()

# Настраиваем периодическое сохранение кэша (каждые 5 минут)
async def periodic_save_cache():
    while True:
        await asyncio.sleep(5 * 60)  # 5 минут
        save_embedding_cache()

# Это будет запущено из основного события запуска приложения
async def start_background_tasks():
    asyncio.create_task(periodic_save_cache())