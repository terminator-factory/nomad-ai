from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime
import uuid

class ModelInfo(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    
    class Config:
        schema_extra = {
            "example": {
                "id": "gemma3:4b",
                "name": "Жека",
                "description": "Сильный и умный. Отлично подходит для сложных запросов и высокоэффективных решений."
            }
        }

class ModelResponse(BaseModel):
    models: List[ModelInfo]
    
    class Config:
        schema_extra = {
            "example": {
                "models": [
                    {
                        "id": "llama3",
                        "name": "Ботагөз",
                        "description": "Мудрая и грациозная. Идеальна для глубоких аналитических задач."
                    },
                    {
                        "id": "gemma3:4b",
                        "name": "Жека",
                        "description": "Сильный и умный. Отлично подходит для сложных запросов."
                    },
                    {
                        "id": "gemma3:1b",
                        "name": "Жемic",
                        "description": "Лёгкая и быстрая. Подходит для повседневных задач и простых вопросов."
                    },
                    {
                        "id": "mistral",
                        "name": "Маке",
                        "description": "Мощный и вдумчивый. Отлично решает сложные задачи и генерирует глубокие ответы."
                    }
                ]
            }
        }