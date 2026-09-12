import asyncio
import aiohttp
import sys

async def test_capture(ip):
    url = f"http://{ip}/capture"
    print(f"Fetching {url}...")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                print(f"Status: {response.status}")
                print(f"Headers: {response.headers}")
                content = await response.read()
                print(f"Content Length: {len(content)}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(1)
    asyncio.run(test_capture(sys.argv[1]))
