import { useState, useCallback, useEffect } from "react";
import { FileTransferService, type TransferProgress } from "../lib/file-transfer";
import { electroview, onTransferSignal } from "../electroview";
import type { Device, SharedContent } from "../pages/Index";

export interface ReceivedMessage {
  id: string;
  from: string;
  content: string;
  fileName: string;
  timestamp: number;
  type: "text" | "file";
}

export function useFileTransfer() {
  const [transfers, setTransfers] = useState<Map<string, TransferProgress>>(new Map());
  const [isTransferring, setIsTransferring] = useState(false);
  const [activeReceivers, setActiveReceivers] = useState<Map<string, FileTransferService>>(new Map());
  const [activeSenders, setActiveSenders] = useState<Map<string, FileTransferService>>(new Map());
  const [receivedMessages, setReceivedMessages] = useState<ReceivedMessage[]>([]);

  const updateTransferProgress = useCallback((progress: TransferProgress) => {
    setTransfers((prev) => {
      const next = new Map(prev);
      next.set(progress.transferId, progress);
      return next;
    });
  }, []);

  // Listen for incoming transfer signals
  useEffect(() => {
    const unsubscribe = onTransferSignal(async (signal) => {
      console.log("Handling incoming signal:", signal.type);

      if (signal.type === "offer") {
        // Incoming file transfer - create receiver
        console.log("Incoming file transfer from", signal.from);
        
        const transferService = new FileTransferService();
        setActiveReceivers((prev) => {
          const next = new Map(prev);
          next.set(signal.transferId, transferService);
          return next;
        });

        try {
          const receivedFile = await transferService.receiveFile(
            signal.data,
            signal.from,
            updateTransferProgress
          );

          console.log("✓ File received:", receivedFile.name, receivedFile.type);
          
          // Check if it's a text message
          const isTextMessage = receivedFile.type === "text/plain" || receivedFile.name.endsWith(".txt");
          
          if (isTextMessage) {
            // Read text content and display it
            const textContent = await receivedFile.text();
            
            const message: ReceivedMessage = {
              id: signal.transferId,
              from: signal.from,
              content: textContent,
              fileName: receivedFile.name,
              timestamp: Date.now(),
              type: "text",
            };
            
            setReceivedMessages((prev) => [...prev, message]);
            console.log("✓ Text message received:", textContent);
          } else {
            // Auto-download regular files
            const url = URL.createObjectURL(receivedFile);
            const a = document.createElement("a");
            a.href = url;
            a.download = receivedFile.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            console.log("✓ File downloaded:", receivedFile.name);
          }

          // Cleanup
          setActiveReceivers((prev) => {
            const next = new Map(prev);
            next.delete(signal.transferId);
            return next;
          });
        } catch (error) {
          console.error("Failed to receive file:", error);
        }
      } else if (signal.type === "answer") {
        // Handle answer from receiver (for sender)
        const sender = activeSenders.get(signal.transferId);
        if (sender) {
          await sender.handleAnswer(signal.data);
        }
      } else if (signal.type === "ice-candidate") {
        // Handle ICE candidate
        const service = activeSenders.get(signal.transferId) || activeReceivers.get(signal.transferId);
        if (service) {
          await service.handleIceCandidate(signal.data);
        }
      }
    });

    return unsubscribe;
  }, [updateTransferProgress, activeReceivers, activeSenders]);

  const sendFiles = useCallback(
    async (contents: SharedContent[], devices: Device[]) => {
      console.log("🚀 sendFiles called with:", contents.length, "contents,", devices.length, "devices");
      
      if (!electroview || !electroview.rpc) {
        console.error("✗ Electroview not available");
        return;
      }

      setIsTransferring(true);

      try {
        for (const device of devices) {
          console.log(`📱 Processing device: ${device.name} (${device.id})`);
          for (const content of contents) {
            console.log(`📄 Processing content: ${content.name} (${content.type})`);
            // Only handle file transfers for now
            if (content.type === "file" && content.data instanceof File) {
              console.log(`📁 Starting file transfer of ${content.name} to ${device.name}`);

              const transferService = new FileTransferService();
              
              // Track sender service
              setActiveSenders((prev) => {
                const next = new Map(prev);
                next.set(transferService.getTransferId(), transferService);
                return next;
              });

              try {
                await transferService.sendFile(
                  content.data,
                  device.id,
                  updateTransferProgress
                );

                console.log(`✓ Successfully sent ${content.name} to ${device.name}`);
              } catch (error) {
                console.error(`✗ Failed to send ${content.name} to ${device.name}:`, error);
              } finally {
                // Cleanup sender
                setActiveSenders((prev) => {
                  const next = new Map(prev);
                  next.delete(transferService.getTransferId());
                  return next;
                });
              }
            } else if (content.type === "text") {
              // Handle text transfer
              console.log(`💬 Starting text transfer to ${device.name}:`, content.data);
              
              // Create a text file from the text content
              const textBlob = new Blob([content.data as string], { type: "text/plain" });
              const textFile = new File([textBlob], content.name || "text.txt", {
                type: "text/plain",
              });

              const transferService = new FileTransferService();
              
              // Track sender service
              setActiveSenders((prev) => {
                const next = new Map(prev);
                next.set(transferService.getTransferId(), transferService);
                return next;
              });

              try {
                await transferService.sendFile(
                  textFile,
                  device.id,
                  updateTransferProgress,
                  device.ip // Pass device IP for manual ICE candidate
                );

                console.log(`✓ Successfully sent text to ${device.name}`);
              } catch (error) {
                console.error(`✗ Failed to send text to ${device.name}:`, error);
              } finally {
                // Cleanup sender
                setActiveSenders((prev) => {
                  const next = new Map(prev);
                  next.delete(transferService.getTransferId());
                  return next;
                });
              }
            } else if (content.type === "image" && content.data instanceof File) {
              // Handle image transfer
              console.log(`Sending image ${content.name} to ${device.name}`);

              const transferService = new FileTransferService();
              
              // Track sender service
              setActiveSenders((prev) => {
                const next = new Map(prev);
                next.set(transferService.getTransferId(), transferService);
                return next;
              });

              try {
                await transferService.sendFile(
                  content.data,
                  device.id,
                  updateTransferProgress
                );

                console.log(`✓ Successfully sent ${content.name} to ${device.name}`);
              } catch (error) {
                console.error(`✗ Failed to send ${content.name} to ${device.name}:`, error);
              } finally {
                // Cleanup sender
                setActiveSenders((prev) => {
                  const next = new Map(prev);
                  next.delete(transferService.getTransferId());
                  return next;
                });
              }
            }
          }
        }

        console.log("✓ All transfers completed");
      } catch (error) {
        console.error("✗ Transfer error:", error);
      } finally {
        setIsTransferring(false);
      }
    },
    [updateTransferProgress]
  );

  const getTransferProgress = useCallback(
    (transferId: string): TransferProgress | undefined => {
      return transfers.get(transferId);
    },
    [transfers]
  );

  const getAllTransfers = useCallback((): TransferProgress[] => {
    return Array.from(transfers.values());
  }, [transfers]);

  const clearMessage = useCallback((messageId: string) => {
    setReceivedMessages((prev) => prev.filter((msg) => msg.id !== messageId));
  }, []);

  return {
    sendFiles,
    isTransferring,
    transfers: getAllTransfers(),
    getTransferProgress,
    receivedMessages,
    clearMessage,
  };
}
