FROM php:8.3-apache
# PDO SQLite est déjà inclus dans l'image officielle
COPY index.html style.css app.js api.php /var/www/html/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /var/data && chown www-data:www-data /var/data
ENV DATA_DIR=/var/data PORT=10000
ENTRYPOINT ["docker-entrypoint.sh"]
