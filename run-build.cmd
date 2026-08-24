@echo off
REM ---------------------------------------------------------------------------
REM Lingo production build (Windows). Same MSVC dance as run-dev.cmd — see the
REM comment block there for why. Installers land in
REM   src-tauri\target\release\bundle\
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
  exit /b 1
)

echo [Lingo] Using MSVC toolchain at: %VSPATH%
call "%VSPATH%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  echo [Lingo] Failed to initialize the VS C++ environment.
  exit /b 1
)

if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

npm run tauri:build %*
