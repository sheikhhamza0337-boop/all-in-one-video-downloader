FROM node:20-slim

# System deps: python3/pip for yt-dlp, ffmpeg for trimming/merging
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg curl ca-certificates unzip && \
    pip3 install --break-system-packages -U yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Deno runtime: yt-dlp uses this to solve YouTube's JS signature/n-challenges
RUN curl -fsSL https://deno.land/install.sh | sh -s -- -y && \
    ln -s /root/.deno/bin/deno /usr/local/bin/deno
ENV DENO_INSTALL="/root/.deno"
ENV PATH="${DENO_INSTALL}/bin:${PATH}"

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
