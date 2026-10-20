# Use Node.js LTS version. No browser needed: every scraper uses plain HTTP.
FROM --platform=linux/amd64 node:20-bookworm-slim

# Playwright is only a dev dependency (old debug scripts); never fetch browsers
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY src ./src

# Migrations are read at runtime (applied on startup), not compiled
COPY migrations ./migrations

# Build TypeScript
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --omit=dev

# Create logs directory
RUN mkdir -p logs

# Expose the API port
EXPOSE 3000

# Start the API server
CMD ["node", "dist/index.js"]
