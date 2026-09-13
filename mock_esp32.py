"""
ARES-01 Mock ESP32 Hardware Server
===================================
Simulates the real ESP32-S3 rover for offline testing / presentation demos.

Architecture:
  Port 80  – Flask HTTP API  (command, reboot, capture)
  Port 81  – asyncio WebSocket Telemetry (heartbeats + command echo)
  Port 82  – Flask MJPEG video stream
"""

import asyncio
import cv2
import io
import json
import numpy as np
import threading
import time
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont
from flask import Flask, Response, request

# ──────────────────────────────────────────────────────────────────────
# Shared state
# ──────────────────────────────────────────────────────────────────────
is_rebooting = False
ws_clients: set = set()

# ──────────────────────────────────────────────────────────────────────
# 1. FLASK HTTP API SERVER  (PORT 80)
# ──────────────────────────────────────────────────────────────────────
api_app = Flask("api")

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
}

@api_app.after_request
def add_cors(response):
    for k, v in CORS_HEADERS.items():
        response.headers[k] = v
    return response

@api_app.route('/', methods=['GET', 'HEAD', 'OPTIONS'])
def root_endpoint():
    if is_rebooting:
        return "Service Unavailable", 503
    return "OK", 200

@api_app.route('/command', methods=['POST', 'OPTIONS'])
def handle_command():
    if request.method == 'OPTIONS':
        return '', 204
    data = request.get_json(silent=True)
    if data and data.get("mode") != "ping":
        print(f"[HTTP] Command received: {data}")
    return json.dumps({"status": "SUCCESS"}), 200, {'Content-Type': 'application/json'}

@api_app.route('/reboot', methods=['GET', 'POST', 'OPTIONS'])
def handle_reboot():
    if request.method == 'OPTIONS':
        return '', 204
    print("[SYSTEM] ESP32 Soft Restart Command Acknowledged. Rebooting...")
    global is_rebooting
    is_rebooting = True

    def simulate_reboot():
        global is_rebooting
        time.sleep(3)
        is_rebooting = False
        print("[SYSTEM] Reboot complete.")

    threading.Thread(target=simulate_reboot, daemon=True).start()
    return "OK", 200

@api_app.route('/capture', methods=['GET'])
def handle_capture():
    if is_rebooting:
        return "Service Unavailable", 503
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(frame, "MOCK CAPTURE", (200, 240),
                cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)
    cv2.putText(frame, f"TIME: {time.time():.1f}", (200, 280),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
    _, buf = cv2.imencode('.jpg', frame)
    return Response(buf.tobytes(), mimetype='image/jpeg')

def start_api_service():
    api_app.run(host='0.0.0.0', port=80, debug=False, threaded=True, use_reloader=False)

# ──────────────────────────────────────────────────────────────────────
# 2. FLASK MJPEG STREAM SERVER  (PORT 82)
# ──────────────────────────────────────────────────────────────────────
stream_app = Flask("stream")

def generate_mjpeg_frames():
    frame_count = 0
    font = ImageFont.load_default()
    while True:
        if is_rebooting:
            break
        
        # Create a temporary square or correctly proportioned canvas for drawing
        draw_width, draw_height = 480, 640  # Flipped dimensions
        temp_img = Image.new('RGB', (draw_width, draw_height), color=(30, 30, 40))
        temp_draw = ImageDraw.Draw(temp_img)
        
        # Draw a moving grid to simulate video motion
        offset = (frame_count * 5) % 40
        for i in range(0, draw_width, 40):
            temp_draw.line([(i + offset, 0), (i + offset, draw_height)], fill=(50, 50, 70), width=2)
        for i in range(0, draw_height, 40):
            temp_draw.line([(0, i + offset), (draw_width, i + offset)], fill=(50, 50, 70), width=2)
            
        # Draw a bouncing ball to simulate movement
        ball_y = abs((frame_count * 10) % (draw_height * 2) - draw_height)
        ball_x = abs((frame_count * 15) % (draw_width * 2) - draw_width)
        temp_draw.ellipse([(ball_x-20, ball_y-20), (ball_x+20, ball_y+20)], fill=(0, 255, 100))

        # Draw the text
        text1 = "ARES-01 LIVE STREAM (MOCK)"
        text2 = datetime.now().strftime("%H:%M:%S")
        text3 = f"FRAME {frame_count}"
        
        # Center the text
        temp_draw.text((draw_width//2 - 90, draw_height//2 - 20), text1, font=font, fill=(0, 255, 0))
        temp_draw.text((draw_width//2 - 40, draw_height//2), text2, font=font, fill=(255, 255, 255))
        temp_draw.text((draw_width//2 - 40, draw_height//2 + 20), text3, font=font, fill=(200, 200, 200))
        
        # Now rotate the temporary image by +90 degrees to match the UI's -90 degree rotation
        # so that when the UI rotates it back, it is perfectly upright!
        img = temp_img.rotate(90, expand=True)

        img_byte_arr = io.BytesIO()
        img.save(img_byte_arr, format='JPEG')
        buf = img_byte_arr.getvalue()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + buf + b'\r\n')
        frame_count += 1
        time.sleep(0.04)

@stream_app.route('/stream', methods=['GET'])
def stream():
    if is_rebooting:
        return "Service Unavailable", 503
    return Response(
        generate_mjpeg_frames(),
        mimetype='multipart/x-mixed-replace; boundary=frame',
        headers={'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache, private'}
    )

def start_stream_service():
    stream_app.run(host='0.0.0.0', port=82, debug=False, threaded=True, use_reloader=False)

# ──────────────────────────────────────────────────────────────────────
# 3. ASYNCIO WEBSOCKET TELEMETRY SERVER  (PORT 81)
# ──────────────────────────────────────────────────────────────────────
import websockets
import websockets.asyncio.server

_battery = 92.0
_distance = 120

def _telemetry_payload() -> str:
    global _battery, _distance
    import random
    _battery = max(10, _battery - random.uniform(0, 0.02))
    _distance = max(5, min(400, _distance + random.randint(-3, 3)))
    return json.dumps({
        "status": "ONLINE",
        "battery": round(_battery, 1),
        "rssi": -42 + (int(time.time()) % 5),
        "distance": _distance,
        "heap": 180000 + (int(time.time()) % 5000),
        "ping": 8 + (int(time.time()) % 4),
    })

async def ws_handler(websocket):
    ws_clients.add(websocket)
    addr = websocket.remote_address
    print(f"[WS] Client connected: {addr}")

    try:
        await websocket.send(_telemetry_payload())
    except Exception:
        ws_clients.discard(websocket)
        return

    try:
        async for raw_msg in websocket:
            if is_rebooting:
                continue
            try:
                msg = json.loads(raw_msg)
                if msg.get("cmd") == "reboot" or msg.get("action") == "reboot":
                    print("[WS] Reboot command received")
                    continue
                if msg.get("mode") in ("manual", "arm"):
                    print(f"[WS] Control: {msg}")
            except Exception:
                pass
            try:
                await websocket.send(_telemetry_payload())
            except Exception:
                break
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        ws_clients.discard(websocket)
        print(f"[WS] Client disconnected: {addr}")

async def broadcast_telemetry():
    while True:
        await asyncio.sleep(2)
        if is_rebooting:
            continue
        clients_snapshot = list(ws_clients)
        if not clients_snapshot:
            continue
        payload = _telemetry_payload()
        for ws in clients_snapshot:
            try:
                await ws.send(payload)
            except Exception:
                ws_clients.discard(ws)

async def start_ws_service_async():
    async with websockets.asyncio.server.serve(ws_handler, "0.0.0.0", 81):
        print("[WS] WebSocket telemetry server running on port 81")
        await broadcast_telemetry()

def start_ws_service():
    asyncio.run(start_ws_service_async())

# ──────────────────────────────────────────────────────────────────────
# ENTRYPOINT
# ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 50)
    print("   ARES-01 MOCK HARDWARE SERVER INITIALIZING")
    print("=" * 50)
    print("-> HTTP API Server: http://127.0.0.1:80")
    print("-> HTTP Camera Stream: http://127.0.0.1:82/stream")
    print("-> WebSocket Telemetry: ws://127.0.0.1:81")
    print("-> Press Ctrl+C to terminate the simulation")
    print("=" * 50)

    import logging
    logging.getLogger('werkzeug').setLevel(logging.ERROR)

    t_api = threading.Thread(target=start_api_service, daemon=True)
    t_stream = threading.Thread(target=start_stream_service, daemon=True)
    t_ws = threading.Thread(target=start_ws_service, daemon=True)

    t_api.start()
    t_stream.start()
    t_ws.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[INFO] Mock Hardware Server stopped cleanly.")
