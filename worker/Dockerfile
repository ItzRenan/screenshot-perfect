FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb libnss3 libxss1 libasound2 libatk-bridge2.0-0 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install
COPY src ./src
COPY test ./test

# The browser flow is driven by a caller that supplies an authorized browser page.
# Keep the image's default command safe and useful for CI.
CMD ["npm", "test"]
