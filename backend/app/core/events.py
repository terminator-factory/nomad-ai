import logging
import asyncio
from app.core.config import settings
from app.services.embeddings import start_background_tasks as embedding_tasks
from app.services.documents import initialize as init_documents
from app.services.vector_store import check_and_repair_vector_store
from app.db.base import init_db, close_db

logger = logging.getLogger(__name__)

async def startup_event():
    """
    Инициализация приложения при запуске
    """
    logger.info("Запуск приложения...")
    
    # Создание необходимых директорий
    settings.setup_directories()
    
    # Инициализация базы данных (если используется)
    await init_db()
    
    # Проверка и восстановление векторного хранилища
    check_and_repair_vector_store()
    
    # Запуск фоновых задач
    await embedding_tasks()
    
    logger.info("Приложение успешно запущено")


async def shutdown_event():
    """
    Действия при выключении приложения
    """
    logger.info("Выключение приложения...")
    
    # Закрытие соединений с базой данных
    await close_db()
    
    # Другие действия при выключении
    # ...
    
    logger.info("Приложение успешно выключено")