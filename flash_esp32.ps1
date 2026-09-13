
$pio = "C:\Users\hp\.platformio\penv\Scripts\pio.exe"
$success = $false
while (-not $success) {
    Write-Host "Attempting to flash ESP32..."
    & $pio run -t upload -d "D:\ARES-01\esp32_firmware"
    if ($LASTEXITCODE -eq 0) {
        $success = $true
        Write-Host "Flashing successful!"
    } else {
        Write-Host "COM port is likely busy. Retrying in 3 seconds..."
        Start-Sleep -Seconds 3
    }
}

