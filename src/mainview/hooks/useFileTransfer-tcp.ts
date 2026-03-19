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
  type: "text" | "file";
  fileSize?: number;
  fileUrl?: string;
  mimeType?: string;
  downloadProgress?: number;
  isDownloading?: boolean;
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
        // Create blob URL for file (don't auto-download)
        const blob = new Blob([fileData], { type: file.mimeType });
        const url = URL.createObjectURL(blob);
        
        console.log("✓ File received:", file.fileName);
        
        // Update existing message or create new one
        setReceivedMessages((prev) => {
          const existingIndex = prev.findIndex((msg) => msg.id === file.transferId);
          
          if (existingIndex !== -1) {
            // Update existing placeholder message
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              from: file.from,
              fromName: file.fromName,
              fileUrl: url,
              mimeType: file.mimeType,
              downloadProgress: 100,
              isDownloading: false,
            };
            return updated;
          } else {
            // Create new message if no placeholder exists
            const message: ReceivedMessage = {
              id: file.transferId,
              from: file.from,
              fromName: file.fromName,
              content: file.fileName,
              fileName: file.fileName,
              timestamp: Date.now(),
              type: "file",
              fileSize: file.fileSize,
              fileUrl: url,
              mimeType: file.mimeType,
              downloadProgress: 100,
              isDownloading: false,
            };
            return [...prev, message];
          }
        });
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
      
      // Update or create message for incoming files
      setReceivedMessages((prev) => {
        const existingMsg = prev.find((msg) => msg.id === progress.transferId);
        
        if (existingMsg) {
          // Update existing message
          return prev.map((msg) => 
            msg.id === progress.transferId
              ? { 
                  ...msg, 
                  downloadProgress: progress.progress,
                  isDownloading: progress.progress < 100 
                }
              : msg
          );
        } else {
          // Create placeholder message for new transfer
          const placeholderMsg: ReceivedMessage = {
            id: progress.transferId,
            from: "",
            fromName: "Unknown",
            content: progress.fileName,
            fileName: progress.fileName,
            timestamp: Date.now(),
            type: "file",
            fileSize: progress.totalBytes,
            downloadProgress: progress.progress,
            isDownloading: true,
          };
          return [...prev, placeholderMsg];
        }
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
