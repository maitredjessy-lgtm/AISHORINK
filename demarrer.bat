@echo off
cd /d "%~dp0"
echo Site disponible sur http://localhost:8080  (fermez cette fenetre pour arreter)
start http://localhost:8080
php -S localhost:8080
pause
