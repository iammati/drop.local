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
				console.log("Sending signal to device:", to);
				signalingServer.handleSignal({
					type: signal.type,
					transferId: signal.transferId,
					from: getLocalDeviceId(),
					to,
					data: signal.data,
				});
				return { success: true };
			},
		},
		messages: {},
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

// Start device discovery service
console.log("Starting device discovery...");
await deviceDiscovery.start();

// Forward device events to frontend in real-time
deviceDiscovery.onDeviceEvent((event) => {
	if (mainWindowRef && mainWindowRef.webview && mainWindowRef.webview.rpc) {
		try {
			// Send event to frontend via RPC message
			mainWindowRef.webview.rpc.send.onDeviceEvent(event);
		} catch (error) {
			console.error("Failed to send device event to frontend:", error);
		}
	}
});

console.log("React Tailwind Vite app started!");
