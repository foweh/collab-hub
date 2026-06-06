@echo off
chcp 65001 >nul
title Windows 驱动批量安装工具
echo ============================================
echo   Windows 驱动批量安装工具
echo   请以管理员身份运行此脚本
echo ============================================
echo.

:: 检查是否管理员权限
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [错误] 请右键选择"以管理员身份运行"本脚本
    pause
    exit /b 1
)

echo [信息] 正在扫描系统中的驱动...
echo.

:: 扫描当前目录下的 .inf 文件
set "COUNT=0"
for /r "%~dp0" %%f in (*.inf) do (
    set /a COUNT+=1
    set "INF_FILE=%%f"
    call :installDriver "%%f"
)

if %COUNT% equ 0 (
    echo [提示] 未找到 .inf 驱动文件
    echo.
    echo 请将驱动 .inf 文件放在本脚本同目录或子目录中。
    echo 支持的驱动类型：网卡、显卡、声卡、USB 设备等。
)

echo.
echo ============================================
echo   安装完成！按任意键退出...
echo ============================================
pause >nul
exit /b 0

:installDriver
echo [安装] %~1
pnputil /add-driver "%~1" /install >nul 2>&1
if %errorLevel% equ 0 (
    echo [成功] 驱动安装成功: %~nx1
) else (
    echo [失败] 驱动安装失败: %~nx1 (可能已存在或不兼容)
)
echo.
exit /b 0
