FROM node:18-alpine AS build

WORKDIR /app

# Создаем директорию для frontend
COPY package*.json ./
COPY tsconfig.json ./
COPY postcss.config.js ./
COPY tailwind.config.js ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код
COPY public ./public
COPY frontend ./src

# Исправляем неверные пути
RUN cp -r ./src/components ./src/types ./src/hooks ./ || true

# Собираем фронтенд
RUN npm run build

# Настройка Nginx
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Добавляем проверку работоспособности
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:80 || exit 1

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]