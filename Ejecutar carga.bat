@echo off
rem Carga la base de App No Formalizado (la ejecutan las tareas programadas de las 11:00 y las 15:00).
cd /d "%~dp0"
".venv\Scripts\python.exe" worker\actualizar.py
