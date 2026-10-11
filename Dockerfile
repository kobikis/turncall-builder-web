# The console as a static site behind nginx, which also proxies /api to
# builder-api — the job Vite's dev proxy does on a laptop (vite.config.ts).
# The Node CI builds with (.github/workflows/ci.yml).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# The official image renders templates/*.template with envsubst at start.
ENV BUILDER_API_URL=http://builder-api:8000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
