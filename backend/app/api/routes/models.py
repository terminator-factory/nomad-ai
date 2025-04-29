from fastapi import APIRouter, HTTPException, Depends
from typing import List, Dict, Any
import logging

from app.models.models import ModelResponse, ModelInfo
from app.services.llm import get_available_models
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/models", response_model=ModelResponse)
async def list_models():
    """
    Получает список доступных моделей.
    """
    try:
        models = await get_available_models()
        
        # Преобразуем в формат ответа
        model_infos = [
            ModelInfo(
                id=model["id"],
                name=model["name"],
                description=model.get("description", "")
            )
            for model in models
        ]
        
        return ModelResponse(models=model_infos)
    
    except Exception as e:
        logger.exception(f"Ошибка при получении списка моделей: {e}")
        
        # Возвращаем модели по умолчанию в случае ошибки
        default_models = [
            ModelInfo(
                id="gemma3:4b",
                name="Жека", 
                description="Модель по умолчанию"
            )
        ]
        
        return ModelResponse(models=default_models)


@router.get("/models/default", response_model=ModelInfo)
async def get_default_model():
    """
    Получает модель по умолчанию
    """
    default_model_id = settings.DEFAULT_MODEL
    
    try:
        models = await get_available_models()
        
        # Ищем модель по умолчанию
        default_model = next(
            (model for model in models if model["id"] == default_model_id),
            None
        )
        
        if default_model:
            return ModelInfo(
                id=default_model["id"],
                name=default_model["name"],
                description=default_model.get("description", "")
            )
        
        # Если не найдена, возвращаем первую доступную
        if models:
            return ModelInfo(
                id=models[0]["id"],
                name=models[0]["name"],
                description=models[0].get("description", "")
            )
        
        # Если нет моделей, возвращаем модель по умолчанию
        return ModelInfo(
            id=default_model_id,
            name="Модель по умолчанию",
            description="Gemma 3 4B - быстрая и надежная модель для большинства задач"
        )
    
    except Exception as e:
        logger.exception(f"Ошибка при получении модели по умолчанию: {e}")
        return ModelInfo(
            id=default_model_id,
            name="Модель по умолчанию",
            description="Gemma 3 4B - быстрая и надежная модель для большинства задач"
        )