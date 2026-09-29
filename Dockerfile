# =====================================================================
# Dockerfile para el backend EdukControl en Render.
# ---------------------------------------------------------------------
# Render lo autodetecta si está en la raíz del repo. Build context se
# toma del servicio web (no hace falta context path).
#
# Por qué este Dockerfile en vez del build por defecto de Render:
#   - puppeteer-core necesita Chromium/Chrome instalado a nivel de SO.
#     Render NO lo trae por defecto en su imagen Node.
#   - Con este Dockerfile instalamos los paquetes del SO necesarios para
#     que puppeteer-core ejecute Chrome headless correctamente.
# =====================================================================

FROM node:20.18.0-bookworm-slim

# Paquetes del SO requeridos por Chromium headless.
# La lista sale de la doc oficial de puppeteer (DEPENDENCIES_OF_PUPPETEER)
# más el flag --no-sandbox que ya pasamos en el código. Mantenemos el
# conjunto mínimo — agregar más rompe por bloating de imagen.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc-s1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    chromium \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 \
    CHROME_PATH=/usr/bin/chromium

WORKDIR /app

# Copiamos solo manifests para cachear la capa de deps si no cambian.
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production

EXPOSE 5050

CMD ["node", "server.js"]
