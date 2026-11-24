FROM node:20-alpine
WORKDIR /app
COPY server.js version.json package.json ./
COPY public ./public
RUN mkdir -p data
ENV PORT=3000
EXPOSE 3000
CMD ["node","server.js"]
