# Simple static file server using nginx
FROM nginx:alpine

# Copy site into nginx html directory
COPY index.html /usr/share/nginx/html/index.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY script.js /usr/share/nginx/html/script.js

# Expose default nginx port
EXPOSE 80

# No custom CMD — use default nginx entrypoint

