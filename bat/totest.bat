@echo off
setlocal EnableDelayedExpansion

echo ===========================================
echo Git Merge Script - Debug Mode
echo ===========================================
echo Current working directory: %CD%
echo.

:: Get current branch
echo [DEBUG] Getting current branch...
echo [CMD] git rev-parse --abbrev-ref HEAD
for /f "tokens=*" %%i in ('git rev-parse --abbrev-ref HEAD') do set CURRENT_BRANCH=%%i
echo [DEBUG] Current branch: !CURRENT_BRANCH!
if "!CURRENT_BRANCH!"=="" (
    echo Error: Cannot get current branch
    exit /b 1
)

:: Get default remote name
echo [DEBUG] Getting default remote name...
echo [CMD] git remote
for /f "tokens=1 delims= " %%i in ('git remote') do set REMOTE_NAME=%%i & goto :got_remote
:got_remote
:: Remove trailing spaces
set REMOTE_NAME=!REMOTE_NAME: =!
echo [DEBUG] Remote name: [!REMOTE_NAME!]
if "!REMOTE_NAME!"=="" (
    echo Error: No remote repository found
    exit /b 1
)

:: Check if there are staged changes
echo [DEBUG] Checking for staged changes...
echo [CMD] git diff --cached --name-only
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
echo [CMD] git rev-parse --verify test
git rev-parse --verify test >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Error: test branch does not exist
    exit /b 1
)

:: Check if remote test branch exists
echo [DEBUG] Checking if remote test branch exists...
set REMOTE_TEST_BRANCH=!REMOTE_NAME!/test
echo [CMD] git rev-parse --verify !REMOTE_TEST_BRANCH!
git rev-parse --verify !REMOTE_TEST_BRANCH! >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Error: Remote test branch (!REMOTE_TEST_BRANCH!) does not exist
    exit /b 1
)

:: Prompt user for confirmation
echo.
echo Will perform the following operations:
echo 1. Switch to test branch
echo 2. Pull latest code from test branch from !REMOTE_NAME!
echo 3. Merge !CURRENT_BRANCH! to test branch
echo 4. Push test branch to !REMOTE_NAME!
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
echo [DEBUG] Remote name: !REMOTE_NAME!
echo [DEBUG] Working directory: %CD%
echo.

:: Switch to test branch
echo Switching to test branch...
echo [CMD] git checkout test
git checkout test
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to switch to test branch
    exit /b 1
)

:: Pull latest code from test branch
echo Pulling latest code from test branch...
set PULL_CMD=git pull !REMOTE_NAME! test
echo [CMD] !PULL_CMD!
git pull !REMOTE_NAME! test
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to pull test branch
    echo [DEBUG] Returning to !CURRENT_BRANCH! branch...
    set ERR_CHECKOUT_CMD=git checkout !CURRENT_BRANCH!
    echo [CMD] !ERR_CHECKOUT_CMD!
    git checkout !CURRENT_BRANCH!
    exit /b 1
)

:: Merge current branch to test
echo.
echo [DEBUG] About to merge: !CURRENT_BRANCH! into test
set MERGE_CMD=git merge !CURRENT_BRANCH! --no-ff
echo [DEBUG] Merge command: !MERGE_CMD!
echo Merging !CURRENT_BRANCH! to test branch...
echo [CMD] !MERGE_CMD!
git merge !CURRENT_BRANCH! --no-ff
if %ERRORLEVEL% neq 0 (
    echo Error: Merge failed, there might be conflicts. Please resolve manually
    echo Use 'git merge --abort' to cancel the merge
    echo [DEBUG] Returning to !CURRENT_BRANCH! branch...
    set ERR_CHECKOUT_CMD2=git checkout !CURRENT_BRANCH!
    echo [CMD] !ERR_CHECKOUT_CMD2!
    git checkout !CURRENT_BRANCH!
    exit /b 1
)

:: Push test branch
echo Pushing test branch to remote...
set PUSH_CMD=git push !REMOTE_NAME! test
echo [CMD] !PUSH_CMD!
git push !REMOTE_NAME! test
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to push test branch
    echo [DEBUG] Returning to !CURRENT_BRANCH! branch...
    set ERR_CHECKOUT_CMD3=git checkout !CURRENT_BRANCH!
    echo [CMD] !ERR_CHECKOUT_CMD3!
    git checkout !CURRENT_BRANCH!
    exit /b 1
)

:: Return to original branch
echo.
echo [DEBUG] Returning to original branch: !CURRENT_BRANCH!
echo Returning to !CURRENT_BRANCH! branch...
set CHECKOUT_CMD=git checkout !CURRENT_BRANCH!
echo [CMD] !CHECKOUT_CMD!
git checkout !CURRENT_BRANCH!
if %ERRORLEVEL% neq 0 (
    echo Warning: Failed to return to !CURRENT_BRANCH! branch, please switch manually
)

echo.
echo ===========================================
echo Complete: Successfully merged !CURRENT_BRANCH! to test branch and pushed
echo ===========================================
exit /b 0
