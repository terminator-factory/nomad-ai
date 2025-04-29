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

from app.api.routes import chat, documents, models, ws
from app.core.events import startup_event, shutdown_event
from app.core.config import settings
from app.db.base import init_db
from app.services.connection_manager import ConnectionManager

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Создание FastAPI приложения
app = FastAPI(
    title="NoMadAI API",
    description="API для работы с LLM и RAG через Langchain",
    version="1.0.0",
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

# Менеджер WebSocket соединений
connection_manager = ConnectionManager()

# Регистрация WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws.handle_websocket(websocket, connection_manager)

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
    logger.error(f"Необработанное исключение: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Внутренняя ошибка сервера"},
    )

# Маршрут для проверки работоспособности сервера
@app.get("/api/health", tags=["health"])
async def health_check():
    return {"status": "ok"}

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