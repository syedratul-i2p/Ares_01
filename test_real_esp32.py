import asyncio
import websockets
import json
import sys

async def test_connection(ip):
    uri = f"ws://{ip}:81/"
    print(f"Attempting to connect to {uri}...")
    try:
        async with websockets.connect(uri, ping_interval=None, close_timeout=2) as websocket:
            print("Connected successfully!")
            ping_msg = json.dumps({"ping": True})
            print(f"Sending: {ping_msg}")
            await websocket.send(ping_msg)
            response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
            print(f"Received: {response}")
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python test_real_esp32.py <ip>')
        sys.exit(1)
    asyncio.run(test_connection(sys.argv[1]))
