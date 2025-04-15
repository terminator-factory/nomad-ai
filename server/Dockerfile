FROM node:18-alpine

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install

# Копируем исходный код
COPY . .

# Экспортируем порт и запускаем сервер
EXPOSE 3001
CMD ["node", "server/src/index.js"]