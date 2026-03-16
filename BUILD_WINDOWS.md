# Building Drop Local for Windows

Since Electrobun doesn't support cross-compilation, you need to build the Windows version on a Windows machine.

## Prerequisites on Windows

1. Install [Bun](https://bun.sh) for Windows
2. Install [Git](https://git-scm.com/download/win) (if not already installed)

## Steps to Build on Windows

1. **Clone or copy this project to your Windows machine**
   ```bash
   # If using Git
   git clone <your-repo-url>
   cd drop.local
   
   # Or just copy the entire folder to your Windows machine
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Build the application**
   ```bash
   bun run build:electrobun
   ```

4. **Run the application**
   ```bash
   # The built app will be in: build/dev-win-x64/drop-local-dev.exe
   # Or for production: build/stable-win-x64/drop-local.exe
   
   # Run it directly:
   .\build\dev-win-x64\drop-local-dev.exe
   ```

## Testing Device Discovery

Once you have Drop Local running on both your Mac and Windows machine:

1. Make sure both devices are on the **same WiFi network**
2. Start Drop Local on Mac: `bun run start`
3. Start Drop Local on Windows: `.\build\dev-win-x64\drop-local-dev.exe`
4. Both devices should discover each other within 2-5 seconds
5. You'll see them appear in the "devices on network" section

## Network Requirements

- Both devices must be on the same subnet (usually the same WiFi)
- UDP port **50002** must not be blocked by firewall
- Broadcast address: `192.168.x.255` (automatically calculated)

## Troubleshooting

If devices don't discover each other:

1. **Check Windows Firewall**
   - Allow Drop Local through Windows Defender Firewall
   - Allow UDP port 50002

2. **Check network**
   - Verify both devices are on same WiFi
   - Check if router allows UDP broadcasts

3. **Check console output**
   - Look for "Broadcasting to..." messages
   - Look for "Discovered device:" messages

## Development Mode with Watch

For development on Windows:
```bash
bun run dev:electrobun
```

This will watch for changes and rebuild automatically.
