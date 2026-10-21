#!/bin/sh
set -e
sed -i "s/Listen 80/Listen ${PORT}/" /etc/apache2/ports.conf
sed -i "s/:80>/:${PORT}>/" /etc/apache2/sites-enabled/000-default.conf
mkdir -p "$DATA_DIR"; chown -R www-data:www-data "$DATA_DIR"
exec apache2-foreground
