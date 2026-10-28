@echo off
rem Lanceur de l'optimiseur de stuff (double-clic). Les resultats sont aussi enregistres dans le dossier "resultats".
chcp 65001 >nul <nul
setlocal EnableDelayedExpansion
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
if not exist resultats mkdir resultats

:debut
cls
echo ============================================
echo        OPTIMISEUR DE STUFF DOFUS 3
echo ============================================
echo.
echo  1 Iop        6 Feca       11 Pandawa     16 Ecaflip
echo  2 Cra        7 Enutrof    12 Sadida      17 Roublard
echo  3 Sacrieur   8 Sram       13 Osamodas    18 Eliotrope
echo  4 Eniripsa   9 Forgelance 14 Steamer     19 Xelor
echo  5 Ouginak   10 Zobal      15 Huppermage
echo.
set "c="
set /p "c=Classe (numero) : "
set "classe="
set /a i=0
for %%n in (Iop Cra Sacrieur Eniripsa Ouginak Feca Enutrof Sram Forgelance Zobal Pandawa Sadida Osamodas Steamer Huppermage Ecaflip Roublard Eliotrope Xelor) do (
  set /a i+=1
  if "!i!"=="!c!" set "classe=%%n"
)
if not defined classe (
  echo Numero invalide.
  pause
  goto debut
)

:niveau
set "niveau="
set /p "niveau=Niveau (1-200) : "
set /a n=niveau 2>nul
if !n! lss 1 goto niveau
if !n! gtr 200 goto niveau

echo.
echo  1 DPS   2 Equilibre   3 Tank
set "r="
set /p "r=Role [2] : "
set "role=equilibre"
if "!r!"=="1" set "role=dps"
if "!r!"=="3" set "role=tank"

echo.
echo  1 Terre   2 Feu   3 Eau   4 Air   5 Auto (compare les elements)   6 Multi-element
set "e="
set /p "e=Element [5] : "
set "voie="
if "!e!"=="1" set "voie=force"
if "!e!"=="2" set "voie=intel"
if "!e!"=="3" set "voie=chance"
if "!e!"=="4" set "voie=agi"
if "!e!"=="6" (
  echo   Ecris les caracs separees par une virgule, ex. force,chance  ^(force=Terre, intel=Feu, chance=Eau, agi=Air^)
  set /p "voie=  Voie : "
)

echo.
set "exo="
set "x="
set /p "x=Exo PA ? (o/n) [n] : "
if /i "!x!"=="o" set "exo=pa"
set "x="
set /p "x=Exo PM ? (o/n) [n] : "
if /i "!x!"=="o" (if defined exo (set "exo=!exo!,pm") else set "exo=pm")
set "x="
set /p "x=Exo PO ? (o/n) [n] : "
if /i "!x!"=="o" (if defined exo (set "exo=!exo!,po") else set "exo=po")
set "exoarg="
if defined exo set "exoarg=exo:!exo!"

set "fichier=resultats\!classe!_!n!_!role!"
if defined voie set "fichier=!fichier!_!voie:,=-!"
if defined exo set "fichier=!fichier!_exo-!exo:,=-!"
set "fichier=!fichier!.txt"

echo.
echo Calcul en cours, compte 15 a 45 secondes...
echo.
call npm run --silent optimize -- !classe! !n! !role! !voie! !exoarg! > "!fichier!" 2>&1
type "!fichier!"
echo.
echo Resultat enregistre dans : %~dp0!fichier!
start "" notepad "!fichier!"
echo.
set "a="
set /p "a=Autre demande ? (o/n) [o] : "
if /i "!a!"=="n" exit /b 0
goto debut
