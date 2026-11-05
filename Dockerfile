FROM node:18
WORKDIR /app
COPY . .
RUN npm init -y
RUN npm install @whiskeysockets/baileys axios express pino
EXPOSE 3000
CMD ["node", "index.js"]
