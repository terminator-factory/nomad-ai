FROM node:23-alpine

WORKDIR /app

# Copy package.json from project root
COPY package*.json ./

# Install dependencies
RUN npm install

# Add curl for healthchecks
RUN apk add --no-cache curl

# Copy server code
COPY server ./server

# Create uploads directory
RUN mkdir -p server/uploads

# Add a healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD curl -f http://localhost:3001/api/health || exit 1

# Export port and start server
EXPOSE 3001
CMD ["node", "server/src/index.js"]