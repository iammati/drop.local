import { Electroview } from "electrobun/view";

// Device event callback type
type DeviceEventCallback = (event: {
  type: "device-joined" | "device-left" | "device-updated";
  device: any;
}) => void;

// Transfer signal callback type
type TransferSignalCallback = (signal: any) => void;

// Store device event listeners
const deviceEventListeners = new Set<DeviceEventCallback>();

// Store transfer signal listeners
const transferSignalListeners = new Set<TransferSignalCallback>();

// Create the Electroview instance with message handlers
export const electroview = new Electroview({
  rpc: Electroview.defineRPC({
    handlers: {
      requests: {},
      messages: {
        // Receive device events from backend
        onDeviceEvent: (event: any) => {
          console.log("📡 Received device event:", event.type, event.device.name);
          
          // Notify all listeners
          for (const listener of deviceEventListeners) {
            try {
              listener(event);
            } catch (error) {
              console.error("Error in device event listener:", error);
            }
          }
        },
        // Receive transfer signals from backend
        onTransferSignal: (signal: any) => {
          console.log("📡 Received transfer signal:", signal.type, "from", signal.from);
          
          // Notify all listeners
          for (const listener of transferSignalListeners) {
            try {
              listener(signal);
            } catch (error) {
              console.error("Error in transfer signal listener:", error);
            }
          }
        },
      },
    },
  }),
});

// Export function to subscribe to device events
export function onDeviceEvent(callback: DeviceEventCallback): () => void {
  deviceEventListeners.add(callback);
  
  // Return unsubscribe function
  return () => {
    deviceEventListeners.delete(callback);
  };
}

// Export function to subscribe to transfer signals
export function onTransferSignal(callback: TransferSignalCallback): () => void {
  transferSignalListeners.add(callback);
  
  // Return unsubscribe function
  return () => {
    transferSignalListeners.delete(callback);
  };
}

// Make it globally available for debugging
if (typeof window !== "undefined") {
  (window as any).electroview = electroview;
  console.log("✓ Electroview initialized and available globally");
}
