from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.websockets import WebSocket, WebSocketDisconnect
import os
import logging
from typing import List, Dict, Any, Optional
import uuid
import asyncio
import json
import time
import traceback

from app.api.routes import chat, documents, models, ws, health
from app.core.events import startup_event, shutdown_event
from app.core.config import settings
from app.db.base import init_db
from app.services.connection_manager import ConnectionManager

# Настройка логирования
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Информация о версии приложения
__version__ = "1.0.0"

# Создание FastAPI приложения
app = FastAPI(
    title=f"{settings.APP_NAME} API",
    description="API для работы с LLM и RAG через бэкенд Python/FastAPI",
    version=__version__,
)

# Добавление middleware для CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Обработчики запуска и остановки приложения
app.add_event_handler("startup", startup_event)
app.add_event_handler("shutdown", shutdown_event)

# Добавление роутеров
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(documents.router, prefix="/api/kb", tags=["knowledge_base"])
app.include_router(models.router, prefix="/api", tags=["models"])
app.include_router(health.router, prefix="/api", tags=["health"])

# Менеджер WebSocket соединений
connection_manager = ConnectionManager()

# Регистрация WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws.handle_websocket(websocket, connection_manager)

# Добавление middleware для логирования запросов
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    
    # Логируем только если включен режим отладки
    if settings.DEBUG:
        logger.debug(f"Request: {request.method} {request.url.path}")
    
    try:
        response = await call_next(request)
        
        # Логируем время выполнения для всех запросов
        process_time = round((time.time() - start_time) * 1000, 2)
        response.headers["X-Process-Time"] = f"{process_time} ms"
        
        # Логируем только если включен режим отладки или запрос выполнялся долго
        if settings.DEBUG or process_time > 1000:
            logger.info(f"Response: {request.method} {request.url.path} - Status: {response.status_code} - Time: {process_time} ms")
        
        return response
    except Exception as e:
        # Логируем ошибки
        logger.error(f"Error processing request: {request.method} {request.url.path} - {str(e)}")
        raise

# Обработка ошибок
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )

# Обработка общих ошибок
@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    # Подробное логирование с трассировкой стека
    error_trace = traceback.format_exc()
    logger.error(f"Необработанное исключение: {exc}", exc_info=True)
    logger.error(f"Стек ошибки:\n{error_trace}")
    
    # В режиме отладки возвращаем полный стек ошибки
    if settings.DEBUG:
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Внутренняя ошибка сервера",
                "error": str(exc),
                "traceback": error_trace.split("\n")
            },
        )
    else:
        # В продакшн режиме скрываем детали ошибки
        return JSONResponse(
            status_code=500,
            content={"detail": "Внутренняя ошибка сервера"},
        )

# Маршрут для проверки работоспособности сервера
@app.get("/", tags=["root"])
async def root():
    """
    Корневой маршрут для информации о сервисе
    """
    return {
        "application": settings.APP_NAME,
        "version": __version__,
        "status": "running",
        "docs": "/docs",
        "health": "/api/health"
    }

# Монтирование статических файлов для загруженных документов
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# Для запуска с помощью uvicorn напрямую
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )