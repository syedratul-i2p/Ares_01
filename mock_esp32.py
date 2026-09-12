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
import json
import numpy as np
import threading
import time
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
    while True:
        if is_rebooting:
            break
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(frame, "ARES-01 LIVE", (180, 220),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 2)
        cv2.putText(frame, time.strftime("%H:%M:%S"), (220, 270),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (200, 200, 255), 2)
        cv2.putText(frame, f"FRAME {int(time.time()*25) % 10000:04d}", (210, 310),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (100, 255, 100), 1)
        _, buf = cv2.imencode('.jpg', frame)
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n')
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
