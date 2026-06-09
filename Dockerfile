# Stage 1: Build the frontend
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Setup the production runtime
FROM node:20-alpine
WORKDIR /app

# Copy frontend static build assets
COPY --from=builder /app/dist ./dist

# Copy backend server files
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --only=production
COPY server/ ./

# Expose default port
EXPOSE 3000

# Set environment defaults for production container
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/database.sqlite
ENV UPLOAD_DIR=/app/data/uploads

# Create persistent data volume mount point
RUN mkdir -p /app/data

# Run the unified server
CMD ["node", "server.js"]
