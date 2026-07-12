@echo off
REM MongoDB Local Startup Script for Windows

setlocal enabledelayedexpansion

REM مسیرهای ممکن MongoDB
set "mongoPaths[0]=C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe"
set "mongoPaths[1]=C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe"
set "mongoPaths[2]=C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe"
set "mongoPaths[3]=C:\Program Files\MongoDB\Server\6.0\bin\mongod.exe"
set "mongoPaths[4]=C:\Program Files\MongoDB\Server\5.0\bin\mongod.exe"
set "mongoPaths[5]=C:\Program Files (x86)\MongoDB\Server\8.3\bin\mongod.exe"
set "mongoPaths[6]=C:\Program Files (x86)\MongoDB\Server\8.0\bin\mongod.exe"
set "mongoPaths[7]=C:\Program Files (x86)\MongoDB\Server\7.0\bin\mongod.exe"
set "mongoPaths[8]=C:\MongoDB\bin\mongod.exe"

setlocal enabledelayedexpansion
set "mongoPath="

for /l %%i in (0,1,8) do (
    if exist "!mongoPaths[%%i]!" (
        set "mongoPath=!mongoPaths[%%i]!"
        echo [OK] MongoDB پيدا شد: !mongoPath!
        goto found
    )
)

echo [ERROR] MongoDB در هيچ كجا پيدا نشد
echo.
echo لطفا يكي از مسيرهاي زير را بررسي كنيد:
echo - C:\Program Files\MongoDB
echo - C:\Program Files (x86)\MongoDB
echo - C:\MongoDB
echo.
exit /b 1

:found
echo.
echo [INFO] MongoDB در حال شروع...
echo [INFO] Address: localhost:27017
echo [INFO] Database: food_ordering
echo.
echo براي متوقف كردن، Ctrl+C را بفشاريد
echo.

REM ایجاد فولدر داده‌ها اگر وجود ندارد
set "dbPath=%~dp0.mongodb-data"
if not exist "%dbPath%" mkdir "%dbPath%"

"!mongoPath!" --dbpath "%dbPath%" --port 27017 --bind_ip 127.0.0.1
