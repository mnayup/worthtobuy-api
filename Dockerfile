FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN yarn install --network-timeout 100000
COPY . .
RUN yarn prisma:generate
RUN yarn build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN yarn install --omit=dev --network-timeout 100000
COPY prisma ./prisma/
RUN yarn prisma:generate
COPY --from=builder /app/dist ./dist
EXPOSE 4000
CMD ["node", "dist/src/main"]