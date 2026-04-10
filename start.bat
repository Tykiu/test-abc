@echo off
chcp 65001 >nul
echo.
echo  =========================================
echo   UIT Study Buddy - Khoi dong Backend
echo  =========================================
echo.

:: Kiem tra Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [LOI] Chua cai Python. Tai tai: https://python.org
    pause
    exit /b 1
)

:: Kiem tra file .env
if not exist ".env" (
    echo  [LOI] Chua co file .env
    echo  Chay lenh sau roi dien key vao:
    echo.
    echo     copy .env.example .env
    echo.
    pause
    exit /b 1
)

:: Tao venv neu chua co
if not exist "venv\Scripts\activate.bat" (
    echo  Dang tao moi truong ao Python...
    python -m venv venv
    echo  Dang cai thu vien...
    call venv\Scripts\activate.bat
    pip install -r requirements.txt --quiet
) else (
    call venv\Scripts\activate.bat
)

echo.
echo  Backend chay tai: http://localhost:8000
echo  API docs tai:     http://localhost:8000/docs
echo  Nhan Ctrl+C de dung
echo  =========================================
echo.

uvicorn backend:app --reload --port 8000
