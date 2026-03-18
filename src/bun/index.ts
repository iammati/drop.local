import { BrowserWindow, BrowserView, Updater } from "electrobun/bun";
import { deviceDiscovery } from "./device-discovery";
import { signalingServer } from "./transfer-server";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			);
		}
	}
	return "views://mainview/index.html";
}

// Get local device ID
function getLocalDeviceId(): string {
	const devices = deviceDiscovery.getDevices();
	// Return the local device ID (we'll need to expose this from device-discovery)
	return deviceDiscovery.getLocalDeviceId();
}

// Store reference to main window for sending events
let mainWindowRef: BrowserWindow | null = null;

// Set up RPC for device discovery and file transfer
const deviceDiscoveryRPC = BrowserView.defineRPC({
	handlers: {
		requests: {
			getDevices: () => {
				const devices = deviceDiscovery.getDevices();
				console.log("Frontend requested devices, returning:", devices.length, "devices");
				return devices;
			},
			getLocalDeviceId: () => {
				return getLocalDeviceId();
			},
			// Subscribe to device events
			subscribeToDeviceEvents: () => {
				console.log("Frontend subscribed to device events");
				
				// Immediately push current device list
				if (mainWindowRef && mainWindowRef.webview && mainWindowRef.webview.rpc) {
					const currentDevices = deviceDiscovery.getDevices();
					console.log("Pushing initial device list:", currentDevices.length, "devices");
					
					// Send each device as a "device-joined" event
					for (const device of currentDevices) {
						try {
							mainWindowRef.webview.rpc.send.onDeviceEvent({
								type: "device-joined",
								device,
							});
						} catch (error) {
							console.error("Failed to send initial device:", error);
						}
					}
				}
				
				return { success: true };
			},
			// Send signaling message to another device
			sendSignal: async ({ to, signal }: { to: string; signal: any }) => {
				const localId = getLocalDeviceId();
				console.log(`📤 Backend received sendSignal request:`);
				console.log(`   From: ${localId}`);
				console.log(`   To: ${to}`);
				console.log(`   Type: ${signal.type}`);
				console.log(`   TransferId: ${signal.transferId}`);
				
				signalingServer.handleSignal({
					type: signal.type,
					transferId: signal.transferId,
					from: localId,
					to,
					data: signal.data,
				});
				
				console.log(`✓ Signal forwarded to signaling server`);
				return { success: true };
			},
		},
		messages: {
			// Receive signaling messages from frontend
			onSignalReceived: (signal: any) => {
				console.log("Frontend received signal:", signal);
			},
		},
	},
});

// Create the main application window
const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
	title: "drop.local",
	url,
	frame: {
		width: 900,
		height: 700,
		x: 200,
		y: 200,
	},
	rpc: deviceDiscoveryRPC,
});

// Store window reference
mainWindowRef = mainWindow;

// Show the window
mainWindow.show();

// Start signaling server
console.log("Starting signaling server...");
await signalingServer.start();

// Start device discovery service
console.log("Starting device discovery...");
await deviceDiscovery.start();

// Register this device with signaling server to receive transfer signals
const localDeviceId = getLocalDeviceId();
signalingServer.registerDevice(localDeviceId, (signal) => {
	console.log("📥 Received signal for local device:", signal.type, "from", signal.from);
	
	// Forward signal to frontend
	if (mainWindowRef && mainWindowRef.webview && mainWindowRef.webview.rpc) {
		try {
			mainWindowRef.webview.rpc.send.onTransferSignal(signal);
			console.log("✓ Signal forwarded to frontend");
		} catch (error) {
			console.error("Failed to forward signal to frontend:", error);
		}
	}
});

// Forward device events to frontend in real-time
deviceDiscovery.onDeviceEvent((event) => {
	// Update signaling server with device IP
	if (event.type === "device-joined" || event.type === "device-updated") {
		signalingServer.updateDeviceIp(event.device.id, event.device.ip);
	}
	
	if (mainWindowRef && mainWindowRef.webview && mainWindowRef.webview.rpc) {
		try {
			// Send event to frontend via RPC message
			mainWindowRef.webview.rpc.send.onDeviceEvent(event);
		} catch (error) {
			console.error("Failed to send device event to frontend:", error);
		}
	}
});

// Graceful shutdown on app close
process.on("SIGINT", async () => {
	console.log("\n🛑 Shutting down gracefully...");
	await deviceDiscovery.stop();
	await signalingServer.stop();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	console.log("\n🛑 Shutting down gracefully...");
	await deviceDiscovery.stop();
	await signalingServer.stop();
	process.exit(0);
});

// Handle window close
mainWindow.on("close", async () => {
	console.log("Window closing, stopping services...");
	await deviceDiscovery.stop();
	await signalingServer.stop();
});

console.log("React Tailwind Vite app started!");
