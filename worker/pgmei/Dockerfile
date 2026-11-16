FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb x11vnc novnc websockify ca-certificates \
    libnss3 libxss1 libasound2 libatk-bridge2.0-0 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json ./
RUN npm install --omit=dev
COPY server.js start.sh ./
RUN chmod +x /app/start.sh && mkdir -p /app/results /app/chrome-profile

ENV PORT=3000
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV DISPLAY=:99
EXPOSE 3000 6080
CMD ["/app/start.sh"]
