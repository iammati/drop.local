import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DropZone } from "@/components/share/DropZone";
import { DeviceSelector } from "@/components/share/DeviceSelector";
import { TransferStatus } from "@/components/share/TransferStatus";
import { StepIndicator } from "@/components/share/StepIndicator";
import { ThemeToggle } from "@/components/share/ThemeToggle";
import { ConnectedDevices } from "@/components/share/ConnectedDevices";
import { MessageToast } from "../components/share/MessageToast";
import { useDeviceDiscovery } from "../hooks/useDeviceDiscovery";
import { useFileTransfer } from "../hooks/useFileTransfer";

export type SharedContent = {
  type: "file" | "text" | "image";
  name: string;
  size?: number;
  preview?: string;
  data?: File | string;
};

export type SharedContentCollection = SharedContent[];

export type Device = {
  id: string;
  name: string;
  type: "laptop" | "phone" | "tablet" | "desktop";
  ip: string;
  isActive?: boolean;
  lastSeen?: number;
};

const Index = () => {
  const { devices, isLoading, hasPermission, error } = useDeviceDiscovery();
  const { sendFiles, isTransferring, transfers, receivedMessages, clearMessage } = useFileTransfer();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [contents, setContents] = useState<SharedContent[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<Device[]>([]);

  const handleContent = useCallback((c: SharedContent) => {
    setContents((prev) => [...prev, c]);
    setStep(2);
  }, []);

  const handleRemoveContent = useCallback((index: number) => {
    setContents((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDeviceSelect = useCallback((d: Device) => {
    // Only allow selection of active devices
    if (!d.isActive) return;
    
    setSelectedDevices((prev) => {
      const isAlreadySelected = prev.some((device) => device.id === d.id);
      if (isAlreadySelected) {
        return prev.filter((device) => device.id !== d.id);
      }
      return [...prev, d];
    });
  }, []);

  // Auto-deselect devices that go offline
  useEffect(() => {
    setSelectedDevices((prev) => 
      prev.filter((selected) => {
        const device = devices.find((d) => d.id === selected.id);
        return device?.isActive ?? false;
      })
    );
  }, [devices]);

  const handleProceedToSend = useCallback(() => {
    if (selectedDevices.length > 0) {
      setStep(3);
      // Start the actual file transfer
      sendFiles(contents, selectedDevices);
    }
  }, [selectedDevices, contents, sendFiles]);

  const handleReset = useCallback(() => {
    setStep(1);
    setContents([]);
    setSelectedDevices([]);
  }, []);

  const handleBackToContent = useCallback(() => {
    setStep(1);
  }, []);

  const handleBackToDeviceSelection = useCallback(() => {
    setStep(2);
  }, []);

  const handleAddFiles = useCallback(() => {
    setStep(1);
  }, []);

  const handleUndo = useCallback(() => {
    setStep(2);
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4">
      {/* Theme toggle - top right */}
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-xl"
      >
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
            drop
            <span className="text-muted-foreground">.</span>
            local
          </h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground tracking-wide">
            share across your devices
          </p>
        </div>

        <StepIndicator current={step} />

        <div className="mt-8">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="drop"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
              >
                <DropZone onContent={handleContent} />
              </motion.div>
            )}
            {step === 2 && contents.length > 0 && (
              <motion.div
                key="device"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
              >
                <DeviceSelector
                  devices={devices}
                  contents={contents}
                  selectedDevices={selectedDevices}
                  onSelect={handleDeviceSelect}
                  onBack={handleBackToContent}
                  onRemoveContent={handleRemoveContent}
                  onAddFiles={handleAddFiles}
                  onProceed={handleProceedToSend}
                />
              </motion.div>
            )}
            {step === 3 && contents.length > 0 && selectedDevices.length > 0 && (
              <motion.div
                key="transfer"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
              >
                <TransferStatus
                  contents={contents}
                  devices={selectedDevices}
                  onReset={handleReset}
                  onUndo={handleBackToDeviceSelection}
                  transfers={transfers}
                  isTransferring={isTransferring}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Permission/Loading/Error states */}
        {!hasPermission && !isLoading && (
          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground">
              {error || "Network permission required to discover devices"}
            </p>
          </div>
        )}

        {/* Connected devices visualization - only show when no content uploaded */}
        {contents.length === 0 && !isLoading && (
          <ConnectedDevices devices={devices} />
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground animate-pulse">
              Discovering devices on your network...
            </p>
          </div>
        )}
      </motion.div>

      {/* Message notifications */}
      <MessageToast messages={receivedMessages} onDismiss={clearMessage} />
    </div>
  );
};

export default Index;
