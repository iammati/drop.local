/**
 * File Transfer Hook - TCP Version (No WebRTC)
 * Direct TCP connections for LAN-only file transfers
 */

import { useState, useCallback, useEffect } from "react";
import { electroview, onFileReceived, onTransferProgress } from "../electroview";
import type { SharedContent } from "../pages/Index";
import type { TransferProgress as UiTransferProgress } from "../lib/file-transfer";

interface Device {
  id: string;
  name: string;
  type: string;
  ip: string;
}

interface TcpTransferProgress {
  transferId: string;
  fileName: string;
  totalBytes: number;
  receivedBytes: number;
  progress: number;
}

export interface ReceivedMessage {
  id: string;
  from: string;
  fromName: string;
  content: string;
  fileName: string;
  timestamp: number;
  type: "text";
}

export function useFileTransfer() {
  const [transfers, setTransfers] = useState<Map<string, TcpTransferProgress>>(new Map());
  const [isTransferring, setIsTransferring] = useState(false);
  const [receivedMessages, setReceivedMessages] = useState<ReceivedMessage[]>([]);

  // Listen for incoming files
  useEffect(() => {
    const unsubscribe = onFileReceived(async (file) => {
      console.log("📥 File received:", file.fileName, "from", file.from);

      // Convert array back to Uint8Array
      const fileData = new Uint8Array(file.data);
      
      // Check if it's a text message
      const isTextMessage = file.mimeType === "text/plain" || file.fileName.endsWith(".txt");
      
      if (isTextMessage) {
        // Display as text message
        const textContent = new TextDecoder().decode(fileData);
        
        const message: ReceivedMessage = {
          id: file.transferId,
          from: file.from,
          fromName: file.fromName,
          content: textContent,
          fileName: file.fileName,
          timestamp: Date.now(),
          type: "text",
        };
        
        setReceivedMessages((prev) => [...prev, message]);
        console.log("✓ Text message received:", textContent);
      } else {
        // Auto-download regular files
        const blob = new Blob([fileData], { type: file.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log("✓ File downloaded:", file.fileName);
        
        // Show notification as a text message
        const message: ReceivedMessage = {
          id: file.transferId,
          from: file.from,
          fromName: file.fromName,
          content: `📎 File received: ${file.fileName} (${(file.fileSize / 1024).toFixed(1)} KB)`,
          fileName: file.fileName,
          timestamp: Date.now(),
          type: "text",
        };
        
        setReceivedMessages((prev) => [...prev, message]);
      }
    });

    return unsubscribe;
  }, []);

  // Listen for transfer progress
  useEffect(() => {
    const unsubscribe = onTransferProgress((progress) => {
      setTransfers((prev) => {
        const next = new Map(prev);
        next.set(progress.transferId, progress);
        return next;
      });
    });

    return unsubscribe;
  }, []);

  const sendFiles = useCallback(
    async (contents: SharedContent[], devices: Device[]) => {
      console.log("🚀 sendFiles called with:", contents.length, "contents,", devices.length, "devices");

      setIsTransferring(true);

      for (const device of devices) {
        console.log(`📱 Processing device: ${device.name} (${device.id})`);

        for (const content of contents) {
          console.log(`📄 Processing content: ${content.name} (${content.type})`);

          try {
            if (content.type === "file") {
              // Send file
              const file = content.data as File;
              const fileData = await file.arrayBuffer();
              
              console.log(`📤 Sending file ${file.name} to ${device.name}`);
              
              await (electroview.rpc as any).request.sendFile({
                recipientId: device.id,
                fileName: file.name,
                fileData: Array.from(new Uint8Array(fileData)),
                mimeType: file.type,
              });

              console.log(`✓ Successfully sent file to ${device.name}`);
            } else if (content.type === "text") {
              // Send text as file
              const textContent = content.data as string;
              console.log(`💬 Starting text transfer to ${device.name}:`, textContent);
              
              const textData = new TextEncoder().encode(textContent);
              
              await (electroview.rpc as any).request.sendFile({
                recipientId: device.id,
                fileName: content.name || "text.txt",
                fileData: Array.from(textData),
                mimeType: "text/plain",
              });

              console.log(`✓ Successfully sent text to ${device.name}`);
            }
          } catch (error) {
            console.error(`✗ Failed to send to ${device.name}:`, error);
          }
        }
      }

      console.log("✓ All transfers completed");
      setIsTransferring(false);
    },
    []
  );

  const clearMessage = useCallback((id: string) => {
    setReceivedMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const uiTransfers: UiTransferProgress[] = Array.from(transfers.values()).map((t) => ({
    transferId: t.transferId,
    fileName: t.fileName,
    totalBytes: t.totalBytes,
    sentBytes: t.receivedBytes,
    progress: t.progress,
    status: t.progress >= 100 ? "completed" : "transferring",
  }));

  return {
    sendFiles,
    transfers: uiTransfers,
    isTransferring,
    receivedMessages,
    clearMessage,
  };
}
