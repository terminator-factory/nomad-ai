from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime
import uuid

class DocumentMetadata(BaseModel):
    id: str
    fileName: str
    fileType: str
    fileSize: int
    contentHash: str
    createdAt: str
    chunkCount: int
    isCSV: Optional[bool] = False
    csvInfo: Optional[Dict[str, Any]] = None

class DocumentResponse(BaseModel):
    document: Dict[str, Any]

class DocumentListResponse(BaseModel):
    documents: List[Dict[str, Any]]
    
    class Config:
        schema_extra = {
            "example": {
                "documents": [
                    {
                        "id": "550e8400-e29b-41d4-a716-446655440000",
                        "fileName": "example.txt",
                        "fileType": "text/plain",
                        "fileSize": 1024,
                        "contentHash": "abc123",
                        "createdAt": "2023-08-24T12:34:56.789123",
                        "chunkCount": 3
                    }
                ]
            }
        }

class DocumentUploadResponse(BaseModel):
    success: bool
    documentId: Optional[str] = None
    fileName: str
    isDuplicate: bool = False
    message: str

class VectorStoreStats(BaseModel):
    totalVectors: int
    totalDocuments: int
    averageChunksPerDocument: float
    faissIndexSize: Optional[int] = None

class KnowledgeBaseStats(BaseModel):
    vectorStats: VectorStoreStats
    documentCount: int
    lastUpdated: str

class DocumentStatsResponse(BaseModel):
    knowledgeBase: KnowledgeBaseStats
    
    class Config:
        schema_extra = {
            "example": {
                "knowledgeBase": {
                    "vectorStats": {
                        "totalVectors": 100,
                        "totalDocuments": 10,
                        "averageChunksPerDocument": 10.0,
                        "faissIndexSize": 100
                    },
                    "documentCount": 10,
                    "lastUpdated": "2023-08-24T12:34:56.789123"
                }
            }
        }

class SearchRequest(BaseModel):
    query: str
    limit: Optional[int] = 5
    
    class Config:
        schema_extra = {
            "example": {
                "query": "Что такое искусственный интеллект?",
                "limit": 5
            }
        }

class SearchResult(BaseModel):
    id: str
    text: str
    score: float
    metadata: Dict[str, Any]

class SearchResponse(BaseModel):
    results: List[SearchResult]
    query: str

class DocumentDeleteResponse(BaseModel):
    success: bool
    message: Optional[str] = None