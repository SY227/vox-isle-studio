FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node . .
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "server/index.mjs"]
