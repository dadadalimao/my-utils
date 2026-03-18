# 将当前目录下所有图片用 ffmpeg 缩放到宽度 640，已是 640 的跳过
# 需要已安装 ffmpeg 且 ffprobe 在 PATH 中

$ErrorActionPreference = 'Stop'
$extensions = @('.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif')
$targetWidth = 640
# 使用「运行脚本时的当前目录」，不是脚本所在目录
$workDir = (Get-Location).Path

$images = Get-ChildItem -Path $workDir -File | Where-Object {
    $extensions -contains $_.Extension.ToLowerInvariant()
}

if ($images.Count -eq 0) {
    Write-Host "当前目录下没有找到图片文件。"
    Write-Host "查找目录: $workDir"
    exit 0
}
Write-Host "查找目录: $workDir"

foreach ($img in $images) {
    $path = $img.FullName
    $prevEA = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        $probe = & ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$path" 2>$null
        if ($LASTEXITCODE -ne 0) {
            $probe = & ffprobe -v error -show_entries stream=width -of csv=p=0 "$path" 2>$null
            $width = ($probe | Select-Object -First 1) -replace '"', ''
        } else {
            $width = $probe -replace '"', ''
        }
        $width = [int]($width -replace '\s', '')
        if ($width -eq $targetWidth) {
            Write-Host "跳过 (已是 ${width}px): $($img.Name)"
            continue
        }
        $tempPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + $img.Extension)
        & ffmpeg -y -i "$path" -vf "scale=${targetWidth}:-1" "$tempPath" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "处理失败: $($img.Name)"
            if (Test-Path $tempPath) { Remove-Item $tempPath -Force }
            continue
        }
        Move-Item -Path $tempPath -Destination $path -Force
        Write-Host "已缩放 ${width} -> ${targetWidth}: $($img.Name)"
    } catch {
        Write-Warning "错误 $($img.Name): $_"
    } finally {
        $ErrorActionPreference = $prevEA
    }
}

Write-Host '完成。'
