import { useState, useCallback } from "react";
import { FileTransferService, type TransferProgress } from "../lib/file-transfer";
import { electroview } from "../electroview";
import type { Device, SharedContent } from "../pages/Index";

export function useFileTransfer() {
  const [transfers, setTransfers] = useState<Map<string, TransferProgress>>(new Map());
  const [isTransferring, setIsTransferring] = useState(false);

  const updateTransferProgress = useCallback((progress: TransferProgress) => {
    setTransfers((prev) => {
      const next = new Map(prev);
      next.set(progress.transferId, progress);
      return next;
    });
  }, []);

  const sendFiles = useCallback(
    async (contents: SharedContent[], devices: Device[]) => {
      if (!electroview || !electroview.rpc) {
        console.error("Electroview not available");
        return;
      }

      setIsTransferring(true);

      try {
        for (const device of devices) {
          for (const content of contents) {
            // Only handle file transfers for now
            if (content.type === "file" && content.data instanceof File) {
              console.log(`Starting transfer of ${content.name} to ${device.name}`);

              const transferService = new FileTransferService();

              try {
                await transferService.sendFile(
                  content.data,
                  device.id,
                  updateTransferProgress
                );

                console.log(`✓ Successfully sent ${content.name} to ${device.name}`);
              } catch (error) {
                console.error(`✗ Failed to send ${content.name} to ${device.name}:`, error);
              }
            } else if (content.type === "text") {
              // Handle text transfer
              console.log(`Sending text to ${device.name}:`, content.data);
              
              // Create a text file from the text content
              const textBlob = new Blob([content.data as string], { type: "text/plain" });
              const textFile = new File([textBlob], content.name || "text.txt", {
                type: "text/plain",
              });

              const transferService = new FileTransferService();

              try {
                await transferService.sendFile(
                  textFile,
                  device.id,
                  updateTransferProgress
                );

                console.log(`✓ Successfully sent text to ${device.name}`);
              } catch (error) {
                console.error(`✗ Failed to send text to ${device.name}:`, error);
              }
            } else if (content.type === "image" && content.data instanceof File) {
              // Handle image transfer
              console.log(`Sending image ${content.name} to ${device.name}`);

              const transferService = new FileTransferService();

              try {
                await transferService.sendFile(
                  content.data,
                  device.id,
                  updateTransferProgress
                );

                console.log(`✓ Successfully sent ${content.name} to ${device.name}`);
              } catch (error) {
                console.error(`✗ Failed to send ${content.name} to ${device.name}:`, error);
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

  return {
    sendFiles,
    isTransferring,
    transfers: getAllTransfers(),
    getTransferProgress,
  };
}
