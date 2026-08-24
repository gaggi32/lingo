@echo off
REM ---------------------------------------------------------------------------
REM Lingo dev launcher (Windows)
REM
REM Rust links through MSVC's link.exe and needs that toolset's x64 CRT
REM libraries. If the newest installed Visual Studio lacks the "Desktop
REM development with C++" workload, a plain `npm run tauri:dev` dies with:
REM   LINK : fatal error LNK1104: cannot open file "msvcrt.lib"
REM
REM This asks vswhere for the newest install that actually HAS the C++ x64
REM build tools, loads its environment, then starts the app. Use this instead
REM of `npm run tauri:dev` on Windows. macOS and Linux need no wrapper.
REM ---------------------------------------------------------------------------
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo [Lingo] vswhere not found. Install Visual Studio Build Tools first.
  exit /b 1
)

set "VSPATH="
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSPATH=%%i"
if not defined VSPATH (
  echo [Lingo] No VS install with the C++ x64 build tools was found.
  echo         Open the Visual Studio Installer and add the
  echo         "Desktop development with C++" workload, then retry.
  exit /b 1
)

echo [Lingo] Using MSVC toolchain at: %VSPATH%
call "%VSPATH%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  echo [Lingo] Failed to initialize the VS C++ environment.
  exit /b 1
)

REM Put cargo on PATH even if this terminal predates the rustup install.
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

npm run tauri:dev %*
