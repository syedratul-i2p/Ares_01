use tauri::Manager;

#[tauri::command]
async fn capture_photo(ip: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    let path_resolver = app_handle.path();
    let picture_dir = path_resolver.picture_dir().map_err(|e| e.to_string())?;
    
    let ares_dir = picture_dir.join("ARES-01");
    if !ares_dir.exists() {
        std::fs::create_dir_all(&ares_dir).map_err(|e| e.to_string())?;
    }
    
    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or(std::time::Duration::from_secs(0)).as_secs();
    let url = format!("http://{}/capture", ip);
    
    match reqwest::get(&url).await {
        Ok(response) => {
            let bytes = response.bytes().await.map_err(|e| e.to_string())?;
            let file_path = ares_dir.join(format!("ARES_CAP_TEST_{}.jpg", timestamp));
            std::fs::write(&file_path, bytes).map_err(|e| e.to_string())?;
            Ok(file_path.to_string_lossy().to_string())
        }
        Err(e) => {
            Err(format!("Hardware offline or unreachable at IP: {} - {}", ip, e))
        }
    }
}

#[tauri::command]
async fn send_drive_command(ip: String, direction: String) -> Result<String, String> {
    let payload = format!(r#"{{"type": "drive", "command": "{}"}}"#, direction);
    let url = format!("http://{}/command", ip);
    
    match reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .body(payload.clone())
        .send()
        .await 
    {
        Ok(_) => {
            println!("HTTP Drive: Sent {} to {}", payload, url);
            Ok(format!("Transmitted payload: {}", payload))
        },
        Err(e) => Err(format!("Failed to send drive command: {}", e))
    }
}

#[tauri::command]
async fn send_arm_command(ip: String, command: String) -> Result<String, String> {
    let payload = format!(r#"{{"type": "arm_macro", "command": "{}"}}"#, command);
    let url = format!("http://{}/command", ip);
    
    match reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .body(payload.clone())
        .send()
        .await 
    {
        Ok(_) => {
            println!("HTTP Arm: Sent {} to {}", payload, url);
            Ok(format!("Transmitted payload: {}", payload))
        },
        Err(e) => Err(format!("Failed to send arm command: {}", e))
    }
}

#[tauri::command]
async fn save_screenshot_command(raw_data: String, filename: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let path_resolver = app_handle.path();
    let picture_dir = path_resolver.picture_dir().map_err(|e| e.to_string())?;
    let ares_dir = picture_dir.join("ARES-01");
    if !ares_dir.exists() {
        std::fs::create_dir_all(&ares_dir).map_err(|e| e.to_string())?;
    }
    let file_path = ares_dir.join(filename);
    
    // Check if it has data URI prefix
    let b64_data = if raw_data.starts_with("data:image") {
        raw_data.split(',').nth(1).unwrap_or(&raw_data)
    } else {
        &raw_data
    };

    let bytes = STANDARD.decode(b64_data).map_err(|e| e.to_string())?;
    std::fs::write(&file_path, bytes).map_err(|e| e.to_string())?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn save_video_command(video_bytes: Vec<u8>, app_handle: tauri::AppHandle) -> Result<String, String> {
    let path_resolver = app_handle.path();
    let video_dir = path_resolver.video_dir().map_err(|e| e.to_string())?;
    let ares_dir = video_dir.join("ARES-01");
    if !ares_dir.exists() {
        std::fs::create_dir_all(&ares_dir).map_err(|e| e.to_string())?;
    }
    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or(std::time::Duration::from_secs(0)).as_secs();
    let file_path = ares_dir.join(format!("ARES-01_Video_{}.webm", timestamp));
    
    std::fs::write(&file_path, video_bytes).map_err(|e| e.to_string())?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn read_firmware() -> Result<String, String> {
    std::fs::read_to_string("d:\\ARES-01\\esp32_firmware\\src\\main.cpp")
        .map_err(|e| format!("Failed to read firmware: {}", e))
}

#[tauri::command]
async fn flash_firmware(ssid: String, pass: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = "d:\\ARES-01\\esp32_firmware\\src\\main.cpp";
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read firmware: {}", e))?;
    
    let re_ssid = regex::Regex::new(r#"const char \*sta_ssid\s*=\s*"[^"]*";"#).unwrap();
    let re_pass = regex::Regex::new(r#"const char \*sta_password\s*=\s*"[^"]*";"#).unwrap();
    
    let updated = re_ssid.replace(&content, format!("const char *sta_ssid = \"{}\";", ssid).as_str());
    let final_content = re_pass.replace(&updated, format!("const char *sta_password = \"{}\";", pass).as_str());
    
    std::fs::write(path, final_content.as_ref())
        .map_err(|e| format!("Failed to write firmware: {}", e))?;
    
    use std::process::{Command, Stdio};
    use std::io::{BufRead, BufReader};
    use tauri::Emitter;

    let mut child = Command::new("powershell")
        .args(["-Command", "~/.platformio/penv/Scripts/pio.exe run -t upload --upload-port COM7"])
        .current_dir("d:\\ARES-01\\esp32_firmware")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn pio: {}", e))?;
        
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let app_handle_clone = app_handle.clone();
    let app_handle_clone2 = app_handle.clone();
    
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_handle_clone.emit("build-log", line);
            }
        }
    });

    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_handle_clone2.emit("build-log", format!("ERR: {}", line));
            }
        }
    });
    
    let status = child.wait().map_err(|e| format!("Failed to wait for pio: {}", e))?;
    
    if status.success() {
        Ok("Flash successful!".to_string())
    } else {
        Err("Flash failed!".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![capture_photo, send_drive_command, send_arm_command, save_screenshot_command, save_video_command, read_firmware, flash_firmware])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
