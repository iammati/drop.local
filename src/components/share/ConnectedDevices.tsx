import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Laptop, Smartphone, Tablet, Monitor, Wifi } from "lucide-react";

type Device = {
  id: string;
  name: string;
  type: "laptop" | "phone" | "tablet" | "desktop";
  ip: string;
  isActive?: boolean;
  lastSeen?: number;
};

const DEVICE_ICONS = {
  laptop: Laptop,
  phone: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
};

interface ConnectedDevicesProps {
  devices: Device[];
}

export const ConnectedDevices = ({ devices }: ConnectedDevicesProps) => {
  const [visible, setVisible] = useState<string[]>([]);

  useEffect(() => {
    // Stagger device appearance
    devices.forEach((d, i) => {
      setTimeout(() => {
        setVisible((prev) => [...prev, d.id]);
      }, 300 + i * 150);
    });
  }, [devices]);

  return (
    <div className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <Wifi className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {devices.length} devices on network
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        {devices.map((device) => {
          const Icon = DEVICE_ICONS[device.type];
          const isVisible = visible.includes(device.id);

          return (
            <motion.div
              key={device.id}
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={
                isVisible
                  ? { opacity: 1, scale: 1, y: 0 }
                  : { opacity: 0, scale: 0.8, y: 10 }
              }
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="group relative flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-accent"
            >
              <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                <Icon
                  className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground"
                  strokeWidth={1.5}
                />
                {/* Online pulse */}
                <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground/30" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-background bg-foreground" />
                </span>
              </div>
              <div className="flex flex-col">
                <p className="text-sm font-medium text-foreground">
                  {device.name}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {device.ip}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
