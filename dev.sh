#!/bin/bash

# Проверка наличия Docker
if ! command -v docker &> /dev/null; then
    echo "Docker не найден. Пожалуйста, установите Docker."
    exit 1
fi

# Проверка наличия директории backend
if [ ! -d "backend" ]; then
    echo "Создание директории backend..."
    mkdir -p backend
    
    # Копирование файлов бэкенда
    echo "Настройка структуры бэкенда..."
    mkdir -p backend/app/api/routes
    mkdir -p backend/app/core
    mkdir -p backend/app/db
    mkdir -p backend/app/models
    mkdir -p backend/app/services
    mkdir -p backend/data
fi

# Проверка наличия Ollama
OLLAMA_RUNNING=false
if command -v ollama &> /dev/null; then
    echo "Ollama найден в системе."
    
    # Проверка запущен ли Ollama
    if curl -s http://localhost:11434/api/tags &> /dev/null; then
        echo "Ollama запущен и отвечает."
        OLLAMA_RUNNING=true
        
        # Проверка наличия нужных моделей
        if ollama list | grep -q "gemma"; then
            echo "Модель Gemma найдена."
        else
            echo "Модель Gemma не найдена. Рекомендуется установить:"
            echo "ollama pull gemma3:4b"
        fi
    else
        echo "Ollama не запущен. Запустите его командой:"
        echo "ollama serve"
    fi
else
    echo "Ollama не найден. Для работы RAG рекомендуется установить Ollama:"
    echo "- Windows: https://ollama.com/download/windows"
    echo "- Linux/Mac: curl -fsSL https://ollama.com/install.sh | sh"
fi

# Запуск приложения
MODE=${1:-dev}

if [ "$MODE" = "dev" ]; then
    echo "Запуск в режиме разработки..."
    
    # Запуск backend
    cd backend
    if [ -f ".env" ]; then
        echo "Используем существующий .env файл для бэкенда."
    else
        echo "Создаем .env из примера..."
        cp .env.example .env || echo "# Backend .env" > .env
    fi
    
    # Проверка окружения Python
    if [ ! -d "venv" ]; then
        echo "Создание виртуального окружения Python..."
        python -m venv venv
    fi
    
    # Активация venv и установка зависимостей
    source venv/bin/activate
    pip install -r requirements.txt
    
    # Запуск бэкенда в фоне
    uvicorn app.main:app --reload --host 0.0.0.0 --port 3001 &
    BACKEND_PID=$!
    cd ..
    
    # Запуск frontend
    echo "Запуск фронтенда..."
    npm start
    
    # Убиваем бэкенд при выходе
    kill $BACKEND_PID
    
elif [ "$MODE" = "docker" ]; then
    echo "Запуск в Docker..."
    
    # Запуск с Docker Compose
    docker-compose up --build
    
else
    echo "Неизвестный режим. Используйте 'dev' или 'docker'."
    exit 1
fi