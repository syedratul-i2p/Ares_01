import socket
import concurrent.futures
import ipaddress
import time
import sys

def get_local_subnet():
    # Attempt to find the local IP and construct a /24 subnet.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        network = ipaddress.IPv4Network(f"{ip}/24", strict=False)
        return network
    except Exception:
        return ipaddress.IPv4Network("192.168.0.0/24")

def scan_port(ip, port, timeout=0.5):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect((ip, port))
            return True
    except:
        return False

def scan_ip(ip):
    ip_str = str(ip)
    has_80 = scan_port(ip_str, 80)
    has_81 = scan_port(ip_str, 81)
    
    if has_80 and has_81:
        return (ip_str, "Command Endpoint (Ports 80, 81)")
    elif has_80:
        return (ip_str, "Camera Endpoint / Web Server (Port 80)")
    elif has_81:
        return (ip_str, "WebSocket Server (Port 81)")
    return None

def main():
    subnet = get_local_subnet()
    print(f"Scanning subnet: {subnet}")
    
    start_time = time.time()
    found_devices = []
    
    # Use thread pool to scan quickly
    with concurrent.futures.ThreadPoolExecutor(max_workers=50) as executor:
        # Skip network and broadcast addresses
        ips = list(subnet.hosts())
        future_to_ip = {executor.submit(scan_ip, ip): ip for ip in ips}
        
        for future in concurrent.futures.as_completed(future_to_ip):
            result = future.result()
            if result:
                found_devices.append(result)
                print(f"[+] Found Device: {result[0]} -> {result[1]}")
                
    elapsed = time.time() - start_time
    print(f"\nScan completed in {elapsed:.2f} seconds.")
    if not found_devices:
        print("No ARES-01 endpoints found. Please check connection.")
        
if __name__ == "__main__":
    main()
