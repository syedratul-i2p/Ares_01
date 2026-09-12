import asyncio, json, websockets

async def test():
    uri = 'ws://127.0.0.1:81/'
    print('Connecting...')
    async with websockets.connect(uri) as ws:
        print('Connected!')
        
        msg = await asyncio.wait_for(ws.recv(), timeout=3)
        data = json.loads(msg)
        print(f"1. Initial: status={data.get('status')}, battery={data.get('battery')}, rssi={data.get('rssi')}")
        
        await ws.send(json.dumps({'cmd': 'ping'}))
        msg2 = await asyncio.wait_for(ws.recv(), timeout=3)
        data2 = json.loads(msg2)
        print(f"2. Ping reply: status={data2.get('status')}, battery={data2.get('battery')}, rssi={data2.get('rssi')}")
        
        msg3 = await asyncio.wait_for(ws.recv(), timeout=5)
        data3 = json.loads(msg3)
        print(f"3. Broadcast: status={data3.get('status')}, battery={data3.get('battery')}, rssi={data3.get('rssi')}")
        
        print("")
        print("*** ALL 3 MESSAGES RECEIVED SUCCESSFULLY ***")
        print("*** WebSocket is working PERFECTLY ***")

asyncio.run(test())
