import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, RotateCcw, AlertCircle } from "lucide-react";
import type { SharedContent, Device } from "@/pages/Index";
import type { TransferProgress } from "../../lib/file-transfer";

interface TransferStatusProps {
  contents: SharedContent[];
  devices: Device[];
  onReset: () => void;
  transfers?: TransferProgress[];
  isTransferring?: boolean;
}

export const TransferStatus = ({
  contents,
  devices,
  onReset,
  transfers = [],
  isTransferring = false,
}: TransferStatusProps) => {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  // Calculate overall progress from all transfers
  useEffect(() => {
    if (transfers.length === 0) {
      // Fallback to simulated progress if no real transfers
      const duration = 2000;
      const interval = 30;
      const step = 100 / (duration / interval);
      const timer = setInterval(() => {
        setProgress((p) => {
          if (p >= 100) {
            clearInterval(timer);
            setDone(true);
            return 100;
          }
          return Math.min(p + step + Math.random() * step * 0.5, 100);
        });
      }, interval);
      return () => clearInterval(timer);
    } else {
      // Calculate real progress
      const totalProgress = transfers.reduce((sum, t) => sum + t.progress, 0);
      const avgProgress = transfers.length > 0 ? totalProgress / transfers.length : 0;
      setProgress(avgProgress);
      
      // Check if all transfers are completed
      const allCompleted = transfers.every(t => t.status === "completed");
      const anyFailed = transfers.some(t => t.status === "failed");
      
      if (allCompleted && !anyFailed) {
        setDone(true);
      }
    }
  }, [transfers]);

  return (
    <div className="flex flex-col items-center space-y-6">
      {/* Status icon */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`flex h-16 w-16 items-center justify-center rounded-2xl transition-colors duration-500 ${
          done ? "bg-green-500" : "bg-accent"
        }`}
      >
        {done ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <Check className="h-7 w-7 text-primary-foreground" strokeWidth={2} />
          </motion.div>
        ) : (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
            className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 border-t-foreground"
          />
        )}
      </motion.div>

      {/* Info */}
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">
          {done ? "Sent successfully" : "Sending..."}
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {contents.length} {contents.length === 1 ? "file" : "files"} → {devices.map(d => d.name).join(", ")}
        </p>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-xs">
        <div className="h-1 w-full overflow-hidden rounded-full bg-accent">
          <motion.div
            className="h-full bg-foreground"
            initial={{ width: "0%" }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.1 }}
          />
        </div>
        <p className="mt-2 text-center font-mono text-[10px] text-muted-foreground">
          {Math.round(progress)}%
        </p>
      </div>

      {/* Reset button */}
      {done && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <button
            onClick={onReset}
            className="flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 font-mono text-xs text-primary-foreground transition-opacity hover:opacity-80"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
            share another
          </button>
        </motion.div>
      )}
    </div>
  );
};
