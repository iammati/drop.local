import { BrowserWindow, Updater } from "electrobun/bun";
import { deviceDiscovery } from "./device-discovery";

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
});

// Start device discovery service
console.log("Starting device discovery...");
await deviceDiscovery.start();

// Expose device discovery to window for frontend access
(globalThis as any).__deviceDiscovery = deviceDiscovery;

console.log("React Tailwind Vite app started!");
