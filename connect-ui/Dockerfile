# Static image: serves a PRE-BUILT Vite bundle with nginx.
#
# The Vite build runs on the dev machine / CI (not here) because it needs more
# RAM than a small server has. Build locally first:  npm run build  (-> dist/)
# then this image just copies dist/ into nginx.
#
#   (in connect-ui/)  npm run build
#   docker build -t cloudfuze/ai-gov-connect-ui:latest ./connect-ui

FROM nginx:1.27-alpine
# Pre-built SPA (base path /CloudFuze from vite.config.js).
COPY dist /usr/share/nginx/html/CloudFuze
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
