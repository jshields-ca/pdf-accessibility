# ─────────────────────────────────────────────────────────────────────────────
# PDF Accessibility Tool — Docker image
# Includes Node.js 20 + Python 3.11 for the full analysis pipeline.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-slim

# Install Python 3, pip, and build dependencies for native Node modules
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-dev \
        build-essential \
        gcc \
        libffi-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Make python3 the default 'python' command
RUN ln -s /usr/bin/python3 /usr/local/bin/python

WORKDIR /app

# Install Python dependencies first (layer cache)
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Install Node dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Create runtime directories (volumes should be mounted here in production)
RUN mkdir -p uploads output reports data logs

# Drop privileges — run as non-root user
RUN groupadd --gid 1001 appgroup && \
    useradd --uid 1001 --gid appgroup --no-create-home appuser && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

ENV NODE_ENV=production \
    PYTHON_PATH=python3 \
    PORT=3000

CMD ["node", "server.js"]
