FROM node:18-alpine

WORKDIR /app

# Копируем package.json из корня проекта
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем серверную часть проекта (без .env)
COPY server ./server

# Экспортируем порт и запускаем сервер
EXPOSE 3001
CMD ["node", "server/src/index.js"]