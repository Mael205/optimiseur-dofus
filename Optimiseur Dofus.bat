@echo off
rem Lanceur de l'optimiseur de stuff (double-clic) : ouvre l'interface dans le navigateur.
rem Garder cette fenetre ouverte pendant l'utilisation ; la fermer arrete l'optimiseur.
rem La version en ligne de commande reste disponible : "Optimiseur Dofus (console).bat".
chcp 65001 >nul <nul
cd /d "%~dp0"
title Optimiseur de stuff Dofus

where npm >nul 2>nul <nul
if errorlevel 1 (
  echo Node.js est introuvable : installe-le depuis https://nodejs.org puis relance.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Premiere utilisation : installation des dependances...
  call npm install
)

echo ============================================
echo        OPTIMISEUR DE STUFF DOFUS 3
echo ============================================
echo.
echo L'interface s'ouvre dans ton navigateur.
echo Laisse cette fenetre ouverte ; ferme-la pour arreter l'optimiseur.
echo.
call npm run dev -- --open
pause
