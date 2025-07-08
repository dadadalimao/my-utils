@echo off
setlocal EnableDelayedExpansion

echo ===========================================
echo Git Merge Script - Debug Mode
echo ===========================================
echo Current working directory: %CD%
echo.

:: Get current branch
echo [DEBUG] Getting current branch...
for /f "tokens=*" %%i in ('git rev-parse --abbrev-ref HEAD') do set CURRENT_BRANCH=%%i
echo [DEBUG] Current branch: !CURRENT_BRANCH!
if "!CURRENT_BRANCH!"=="" (
    echo Error: Cannot get current branch
    exit /b 1
)

:: Check if there are staged changes
echo [DEBUG] Checking for staged changes...
git diff --cached --name-only | findstr . >nul
if %ERRORLEVEL%==0 (
    echo Error: There are staged changes, please commit or reset them first
    exit /b 1
)

:: Confirm current branch is not test
if "!CURRENT_BRANCH!"=="test" (
    echo Error: Already on test branch, cannot merge
    exit /b 1
)

:: Check if test branch exists
echo [DEBUG] Checking if test branch exists...
git rev-parse --verify test >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Error: test branch does not exist
    exit /b 1
)

:: Prompt user for confirmation
echo.
echo Will perform the following operations:
echo 1. Switch to test branch
echo 2. Pull latest code from test branch
echo 3. Merge !CURRENT_BRANCH! to test branch
echo 4. Push test branch to remote
echo 5. Return to current branch
echo.
set /p CONFIRM=Confirm to continue? (y/n):
if /i "%CONFIRM%"=="n" (
    echo Operation cancelled
    exit /b 0
) 

echo.
echo [DEBUG] Starting operations...
echo [DEBUG] Original branch: !CURRENT_BRANCH!
echo [DEBUG] Working directory: %CD%
echo.

:: Switch to test branch
echo Switching to test branch...
git checkout test
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to switch to test branch
    exit /b 1
)

:: Pull latest code from test branch
echo Pulling latest code from test branch...
git pull origin test
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to pull test branch
    echo [DEBUG] Returning to !CURRENT_BRANCH! branch...
    git checkout !CURRENT_BRANCH!
    exit /b 1
)

:: Merge current branch to test
echo.
echo [DEBUG] About to merge: !CURRENT_BRANCH! into test
echo [DEBUG] Merge command: git merge !CURRENT_BRANCH! --no-ff
echo Merging !CURRENT_BRANCH! to test branch...
git merge !CURRENT_BRANCH! --no-ff
if %ERRORLEVEL% neq 0 (
    echo Error: Merge failed, there might be conflicts. Please resolve manually
    echo Use 'git merge --abort' to cancel the merge
    echo [DEBUG] Returning to !CURRENT_BRANCH! branch...
    git checkout !CURRENT_BRANCH!
    exit /b 1
)

:: Push test branch
echo Pushing test branch to remote...
git push origin test
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to push test branch
    echo [DEBUG] Returning to !CURRENT_BRANCH! branch...
    git checkout !CURRENT_BRANCH!
    exit /b 1
)

:: Return to original branch
echo.
echo [DEBUG] Returning to original branch: !CURRENT_BRANCH!
echo Returning to !CURRENT_BRANCH! branch...
git checkout !CURRENT_BRANCH!
if %ERRORLEVEL% neq 0 (
    echo Warning: Failed to return to !CURRENT_BRANCH! branch, please switch manually
)

echo.
echo ===========================================
echo Complete: Successfully merged !CURRENT_BRANCH! to test branch and pushed
echo ===========================================
exit /b 0
