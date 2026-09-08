import cv2
import json
import threading
import time
from flask import Flask, Response, request
from SimpleWebSocketServer import SimpleWebSocketServer, WebSocket

# ----------------- 1. FLASK HTTP SERVER (PORT 80) -----------------
app = Flask(__name__)
camera = cv2.VideoCapture(0)

def generate_mjpeg_frames():
    while True:
        success, frame = camera.read()
        if not success:
            # If webcam fails, generate an empty frame delay to avoid tight loop
            time.sleep(0.05)
            continue
        ret, buffer = cv2.imencode('.jpg', frame)
        if not ret:
            continue
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

@app.route('/stream', methods=['GET'])
def stream():
    return Response(
        generate_mjpeg_frames(),
        mimetype='multipart/x-mixed-replace; boundary=frame',
        headers={
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache, private'
        }
    )

@app.route('/command', methods=['POST', 'OPTIONS'])
def handle_command():
    if request.method == 'OPTIONS':
        return '', 204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    data = request.get_json(silent=True)
    print(f"[HTTP] Command received: {data}")
    return json.dumps({"status": "SUCCESS"}), 200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    }

@app.route('/telemetry', methods=['GET'])
def telemetry():
    return json.dumps({
        "status": "ONLINE",
        "battery": 92,
        "rssi": -42,
        "ping": 10
    }), 200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    }

def start_http_service():
    # ESP32 defaults to port 80
    app.run(host='0.0.0.0', port=80, debug=False, threaded=True)

# ----------------- 2. WEBSOCKET TELEMETRY (PORT 81) -----------------
class ESP32TelemetrySocket(WebSocket):
    def handleConnected(self):
        print(f"[WS] Client Connected: {self.address}")
        # Send initial online telemetry packet to trigger frontend "ROVER ONLINE" status
        payload = json.dumps({
            "status": "ONLINE",
            "battery": 92,
            "rssi": -42,
            "ping": 10
        })
        self.sendMessage(payload)

    def handleMessage(self):
        # Handle ping/pong heartbeat or incoming arm/drive commands over WS
        try:
            msg = json.loads(self.data)
            print(f"[WS] Message received: {msg}")
        except Exception:
            pass
        # Echo back active status
        self.sendMessage(json.dumps({"status": "ONLINE", "battery": 92}))

    def handleClose(self):
        print(f"[WS] Client Disconnected: {self.address}")

def start_ws_service():
    ws_server = SimpleWebSocketServer('0.0.0.0', 81, ESP32TelemetrySocket)
    ws_server.serveforever()

# ----------------- ENTRYPOINT -----------------
if __name__ == '__main__':
    print("==================================================")
    print("   ARES-01 MOCK HARDWARE SERVER INITIALIZING")
    print("==================================================")
    print("-> HTTP Camera Stream: http://127.0.0.1:80/stream")
    print("-> WebSocket Telemetry: ws://127.0.0.1:81")
    print("-> Press Ctrl+C to terminate the simulation")
    print("==================================================")

    t_http = threading.Thread(target=start_http_service, daemon=True)
    t_ws = threading.Thread(target=start_ws_service, daemon=True)

    t_http.start()
    t_ws.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        camera.release()
        print("\n[INFO] Mock Hardware Server stopped cleanly.")
