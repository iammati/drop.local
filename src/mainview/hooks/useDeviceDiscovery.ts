import { useState, useEffect } from "react";
import type { Device } from "../pages/Index";
import { electroview } from "../electroview";

interface DiscoveredDevice {
  id: string;
  name: string;
  type: "laptop" | "phone" | "tablet" | "desktop";
  ip: string;
  port: number;
  lastSeen: number;
}

const ACTIVE_THRESHOLD = 10000; // 10 seconds - device is active if seen within this time

export function useDeviceDiscovery() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let pollInterval: Timer | null = null;
    let retryTimeout: Timer | null = null;

    const initDiscovery = async () => {
      try {
        console.log("✓ Initializing device discovery with Electroview...");
        
        // Check if we're in Electrobun environment
        if (electroview && electroview.rpc && electroview.rpc.request) {
          console.log("✓ Electrobun RPC found! Starting device polling...");
          
          // Start polling for devices
          const pollDevices = async () => {
            try {
              const discoveredDevices: DiscoveredDevice[] = await electroview.rpc.request.getDevices();
              const now = Date.now();
              
              console.log("✓ Polled devices:", discoveredDevices.length, "found");
              
              // Convert to Device format with isActive status
              const formattedDevices: Device[] = discoveredDevices.map((d: DiscoveredDevice) => ({
                id: d.id,
                name: d.name,
                type: d.type,
                ip: d.ip,
                isActive: (now - d.lastSeen) < ACTIVE_THRESHOLD,
                lastSeen: d.lastSeen,
              }));

              setDevices(formattedDevices);
              setIsLoading(false);
            } catch (err) {
              console.error("✗ Error fetching devices:", err);
              setError("Failed to fetch devices");
              setIsLoading(false);
            }
          };

          // Poll immediately
          await pollDevices();

          // Then poll every 2 seconds
          pollInterval = setInterval(pollDevices, 2000);
        } else {
          // Not in Electrobun - no devices available
          console.log("⟳ Not in Electrobun environment, no devices available");
          setDevices([]);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("✗ Error initializing device discovery:", err);
        setError("Failed to initialize device discovery");
        setIsLoading(false);
      }
    };

    initDiscovery();

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, []);

  return {
    devices,
    isLoading,
    hasPermission,
    error,
  };
}
