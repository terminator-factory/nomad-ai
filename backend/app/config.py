from pydantic_settings import BaseSettings
from typing import List, Optional, Dict, Any
import os
from pathlib import Path
from dotenv import load_dotenv

# Загрузка переменных окружения из .env файла
load_dotenv()

# Базовая директория проекта
BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # Основные настройки приложения
    APP_NAME: str = "NoMadAI"
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "3001"))
    
    # Настройки CORS
    ALLOWED_ORIGINS: List[str] = os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:9090"
    ).split(",")
    
    # Директории для хранения данных
    DATA_DIR: Path = BASE_DIR / "data"
    UPLOAD_DIR: Path = DATA_DIR / "uploads"
    CONTENT_DIR: Path = DATA_DIR / "content"
    METADATA_DIR: Path = DATA_DIR / "metadata"
    VECTORS_DIR: Path = DATA_DIR / "vectors"
    
    # Настройки базы данных
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR}/app.db")
    
    # Настройки LLM
    LLM_TYPE: str = os.getenv("LLM_TYPE", "ollama")  # ollama, openai, mistral
    LLM_API_URL: str = os.getenv("LLM_API_URL", "http://localhost:11434/api")
    LLM_API_KEY: Optional[str] = os.getenv("LLM_API_KEY")
    DEFAULT_MODEL: str = os.getenv("DEFAULT_MODEL", "gemma3:4b")
    
    # Настройки для работы с документами
    MAX_UPLOAD_SIZE: int = int(os.getenv("MAX_UPLOAD_SIZE", "20971520"))  # 20MB
    CHUNK_SIZE: int = int(os.getenv("CHUNK_SIZE", "1000"))
    CHUNK_OVERLAP: int = int(os.getenv("CHUNK_OVERLAP", "200"))
    
    # Настройки для векторного хранилища
    VECTOR_STORE_TYPE: str = os.getenv("VECTOR_STORE_TYPE", "faiss")  # faiss, chroma
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")  # или другая модель
    
    # Настройки WebSocket
    WS_PING_INTERVAL: int = int(os.getenv("WS_PING_INTERVAL", "30"))  # секунды
    
    # Режимы работы
    RAG_ENABLED: bool = os.getenv("RAG_ENABLED", "True").lower() == "true"
    
    # Настройки кэширования
    CACHE_ENABLED: bool = os.getenv("CACHE_ENABLED", "True").lower() == "true"
    REDIS_URL: Optional[str] = os.getenv("REDIS_URL")
    
    # Настройки логирования
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True

    def setup_directories(self):
        """Создание необходимых директорий при запуске приложения"""
        for directory in [
            self.DATA_DIR,
            self.UPLOAD_DIR,
            self.CONTENT_DIR,
            self.METADATA_DIR,
            self.VECTORS_DIR,
        ]:
            directory.mkdir(parents=True, exist_ok=True)


# Создание глобального экземпляра настроек
settings = Settings()