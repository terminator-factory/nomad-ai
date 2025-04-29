from fastapi import APIRouter, Depends, Request
from typing import Dict, Any
import logging
import platform
import sys
import psutil
import time
from datetime import datetime, timezone

from app.core.config import settings
from app.services.connection_manager import ConnectionManager

router = APIRouter()
logger = logging.getLogger(__name__)

# Время запуска сервера
START_TIME = time.time()

def get_connection_manager() -> ConnectionManager:
    """
    Зависимость для получения экземпляра ConnectionManager
    """
    from app.main import connection_manager
    return connection_manager

@router.get("/health", response_model=Dict[str, Any])
async def health_check(request: Request, connection_manager: ConnectionManager = Depends(get_connection_manager)):
    """
    Проверка работоспособности сервера и получение базовой информации о состоянии
    """
    try:
        # Получаем базовую информацию о системе
        system_info = {
            "platform": platform.platform(),
            "python_version": sys.version,
            "uptime_seconds": int(time.time() - START_TIME),
            "process_memory_mb": round(psutil.Process().memory_info().rss / (1024 * 1024), 2),
            "cpu_percent": psutil.cpu_percent(interval=0.1),
            "memory_percent": psutil.virtual_memory().percent
        }
        
        # Получаем информацию о соединениях
        connections_info = {
            "active_connections": connection_manager.get_active_connections_count(),
            "active_generations": connection_manager.get_active_generations_count()
        }
        
        # Получаем информацию о настройках
        settings_info = {
            "app_name": settings.APP_NAME,
            "debug_mode": settings.DEBUG,
            "host": settings.HOST,
            "port": settings.PORT,
            "rag_enabled": settings.RAG_ENABLED,
            "llm_type": settings.LLM_TYPE,
            "default_model": settings.DEFAULT_MODEL,
            "max_upload_size_mb": settings.MAX_UPLOAD_SIZE / (1024 * 1024)
        }
        
        # Проверяем доступность LLM API
        llm_api_status = "unknown"
        llm_api_error = None
        
        try:
            import httpx
            async with httpx.AsyncClient(timeout=2.0) as client:
                response = await client.get(f"{settings.LLM_API_URL.rstrip('/generate')}")
                llm_api_status = "available" if response.status_code < 400 else "error"
        except Exception as e:
            llm_api_status = "unavailable"
            llm_api_error = str(e)
        
        # Собираем полный ответ
        return {
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "system": system_info,
            "connections": connections_info,
            "settings": settings_info,
            "llm_api": {
                "status": llm_api_status,
                "url": settings.LLM_API_URL,
                "error": llm_api_error
            }
        }
    except Exception as e:
        logger.exception(f"Ошибка при получении информации о состоянии: {e}")
        return {
            "status": "error",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

@router.get("/ready", response_model=Dict[str, Any])
async def readiness_probe():
    """
    Проверка готовности приложения к обработке запросов
    Используется для проверки готовности в Kubernetes и других оркестраторах
    """
    return {"status": "ready"}


@router.get("/live", response_model=Dict[str, Any])
async def liveness_probe():
    """
    Проверка жизнеспособности приложения
    Используется для проверки жизнеспособности в Kubernetes и других оркестраторах
    """
    return {"status": "alive"}