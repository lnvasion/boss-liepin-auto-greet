"""
BOSS直聘自动沟通 - 外部监控工具 (可选)

启动本地 WebSocket 服务器，接收用户脚本的实时日志流。
适合需要在不看浏览器的情况下监控进度的场景。

使用方式:
    pip install websockets
    python boss-monitor.py

然后用户脚本会自动连接 ws://localhost:9999
"""
import asyncio
import json
import websockets
from datetime import datetime

CONNECTED_CLIENTS = set()


async def handler(websocket):
    """处理 WebSocket 连接"""
    CONNECTED_CLIENTS.add(websocket)
    client_ip = websocket.remote_address[0] if websocket.remote_address else "unknown"
    print(f"\n✅ 客户端已连接: {client_ip}")
    print(f"   活跃连接数: {len(CONNECTED_CLIENTS)}")

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                timestamp = data.get("timestamp", 0)
                level = data.get("level", "INFO")
                msg = data.get("message", "")
                extra = data.get("data")

                time_str = datetime.fromtimestamp(timestamp / 1000).strftime("%H:%M:%S")

                # 彩色输出
                colors = {
                    "DEBUG": "\033[90m",
                    "INFO": "\033[0m",
                    "SUCCESS": "\033[92m",
                    "WARN": "\033[93m",
                    "ERROR": "\033[91m",
                    "CAPTCHA": "\033[95m",
                }
                reset = "\033[0m"
                color = colors.get(level, "")

                print(f"{color}[{time_str}] [{level:7s}] {msg}{reset}")

                if extra and extra != "null":
                    print(f"         {extra}")

            except json.JSONDecodeError:
                print(f"  收到非JSON消息: {message[:100]}")

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        CONNECTED_CLIENTS.discard(websocket)
        print(f"\n❌ 客户端断开: {client_ip}")
        print(f"   活跃连接数: {len(CONNECTED_CLIENTS)}")


async def main():
    print("=" * 50)
    print("  BOSS直聘自动沟通 - 外部监控")
    print(f"  监听地址: ws://localhost:9999")
    print(f"  等待用户脚本连接...")
    print("=" * 50)

    async with websockets.serve(handler, "localhost", 9999):
        await asyncio.Future()  # 永久运行


if __name__ == "__main__":
    asyncio.run(main())
