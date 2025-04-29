import logging
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
import asyncio

from app.core.config import settings

logger = logging.getLogger(__name__)

# Для SQLite используем асинхронный движок
if settings.DATABASE_URL.startswith('sqlite'):
    SQLALCHEMY_DATABASE_URL = settings.DATABASE_URL.replace(
        'sqlite://', 'sqlite+aiosqlite://'
    )
else:
    SQLALCHEMY_DATABASE_URL = settings.DATABASE_URL

# Создаем движок для асинхронной работы с БД
engine = create_async_engine(
    SQLALCHEMY_DATABASE_URL, 
    echo=settings.DEBUG,
    future=True,
)

# Создаем фабрику сессий
async_session = sessionmaker(
    engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

# Базовый класс для моделей SQLAlchemy
Base = declarative_base()

# Глобальное хранение для активных сессий
_db_sessions = []

async def init_db():
    """
    Инициализация базы данных
    """
    try:
        logger.info("Инициализация базы данных...")
        
        # Создаем таблицы (если они не существуют)
        async with engine.begin() as conn:
            # Для разработки - удаляем все таблицы и создаем заново
            # if settings.DEBUG:
            #     await conn.run_sync(Base.metadata.drop_all)
            
            await conn.run_sync(Base.metadata.create_all)
        
        logger.info("База данных инициализирована")
    except Exception as e:
        logger.error(f"Ошибка при инициализации базы данных: {e}")
        raise


async def get_session() -> AsyncSession:
    """
    Создает сессию базы данных для использования в зависимостях FastAPI
    """
    async with async_session() as session:
        _db_sessions.append(session)
        try:
            yield session
        finally:
            _db_sessions.remove(session)


async def close_db():
    """
    Закрытие всех активных сессий БД перед выключением
    """
    logger.info(f"Закрытие {len(_db_sessions)} активных сессий БД")
    
    for session in _db_sessions:
        if session:
            await session.close()
    
    # Очищаем список сессий
    _db_sessions.clear()
    
    # Закрываем движок
    if engine:
        await engine.dispose()
        logger.info("Соединения с БД закрыты")