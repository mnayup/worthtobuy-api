FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN yarn config set registry https://registry.npmjs.org/ && \
    yarn config set network-timeout 600000 -g && \
    yarn install
COPY . .
RUN yarn prisma:generate
RUN yarn build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN yarn config set registry https://registry.npmjs.org/ && \
    yarn config set network-timeout 600000 -g && \
    yarn install --omit=dev
COPY prisma ./prisma/
RUN yarn prisma:generate
COPY --from=builder /app/dist ./dist
EXPOSE 4000
CMD ["node", "dist/src/main"]