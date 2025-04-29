from fastapi import APIRouter, HTTPException, Depends, File, UploadFile, Form, Body, Path, Query
from fastapi.responses import JSONResponse
from typing import List, Dict, Any, Optional
import logging
import os
import uuid
from datetime import datetime
import asyncio

from app.models.document import (
    DocumentResponse,
    DocumentListResponse,
    DocumentUploadResponse,
    DocumentStatsResponse
)
from app.services.documents import (
    get_knowledge_base_documents,
    process_document,
    delete_document,
    get_vector_store_stats
)
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/documents", response_model=DocumentListResponse)
async def list_documents():
    """
    Получает список всех документов из базы знаний
    """
    try:
        documents = await get_knowledge_base_documents()
        return DocumentListResponse(documents=documents)
    
    except Exception as e:
        logger.exception(f"Ошибка при получении списка документов: {e}")
        raise HTTPException(status_code=500, detail="Не удалось получить список документов")


@router.get("/documents/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: str = Path(...)):
    """
    Получает информацию о документе по ID
    """
    from app.services.documents import get_file_meta, get_file_content
    
    try:
        # Получаем метаданные документа
        document = await get_file_meta(document_id)
        
        if not document:
            raise HTTPException(status_code=404, detail="Документ не найден")
        
        # Получаем содержимое документа
        content = await get_file_content(document_id)
        
        # Ограничиваем размер содержимого для API
        content_preview = content[:5000] if content else ""
        if content and len(content) > 5000:
            content_preview += "... (content truncated)"
        
        # Добавляем превью содержимого к документу
        document["contentPreview"] = content_preview
        
        return DocumentResponse(document=document)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Ошибка при получении документа {document_id}: {e}")
        raise HTTPException(status_code=500, detail="Не удалось получить документ")


@router.delete("/documents/{document_id}", response_model=Dict[str, bool])
async def remove_document(document_id: str = Path(...)):
    """
    Удаляет документ из базы знаний
    """
    try:
        success = await delete_document(document_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="Документ не найден или не может быть удален")
        
        return {"success": True}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Ошибка при удалении документа {document_id}: {e}")
        raise HTTPException(status_code=500, detail="Не удалось удалить документ")


@router.post("/upload", response_model=DocumentUploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    force: bool = Form(False)
):
    """
    Загружает и обрабатывает документ для добавления в базу знаний
    """
    try:
        # Проверяем размер файла
        file_size = 0
        contents = await file.read()
        file_size = len(contents)
        
        if file_size > settings.MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=400, 
                detail=f"Файл слишком большой. Максимальный размер: {settings.MAX_UPLOAD_SIZE/1024/1024} MB"
            )
        
        # Перемещаем указатель в начало файла
        await file.seek(0)
        
        # Определяем тип файла
        file_type = file.content_type or "text/plain"
        
        # Читаем содержимое файла
        contents = await file.read()
        
        # Пытаемся декодировать как текст
        try:
            text_content = contents.decode("utf-8")
        except UnicodeDecodeError:
            # Пробуем другие кодировки
            try:
                text_content = contents.decode("latin-1")
            except:
                raise HTTPException(
                    status_code=400,
                    detail="Не удалось декодировать содержимое файла. Поддерживаются только текстовые файлы."
                )
        
        # Создаем объект документа для обработки
        document = {
            "name": file.filename,
            "type": file_type,
            "size": file_size,
            "content": text_content
        }
        
        # Обрабатываем документ
        result = await process_document(document, force)
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("message", "Не удалось обработать документ"))
        
        return DocumentUploadResponse(
            success=True,
            documentId=result.get("documentId"),
            fileName=file.filename,
            isDuplicate=result.get("isDuplicate", False),
            message=result.get("message", "")
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Ошибка при загрузке документа: {e}")
        raise HTTPException(status_code=500, detail=f"Не удалось загрузить документ: {str(e)}")


@router.get("/stats", response_model=DocumentStatsResponse)
async def get_kb_stats():
    """
    Получает статистику базы знаний
    """
    try:
        # Получаем статистику векторного хранилища
        vector_stats = await get_vector_store_stats()
        
        # Получаем список документов для подсчета
        documents = await get_knowledge_base_documents()
        
        return DocumentStatsResponse(
            knowledgeBase={
                "vectorStats": vector_stats,
                "documentCount": len(documents),
                "lastUpdated": datetime.now().isoformat()
            }
        )
    
    except Exception as e:
        logger.exception(f"Ошибка при получении статистики базы знаний: {e}")
        raise HTTPException(status_code=500, detail="Не удалось получить статистику базы знаний")