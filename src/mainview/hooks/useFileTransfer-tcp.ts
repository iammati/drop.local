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
      
      // Check if it's a text message (use flag from backend)
      if (file.isTextMessage) {
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
        
        // Keep only last 20 messages to prevent memory buildup
        setReceivedMessages((prev) => [...prev, message].slice(-20));
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
            // Keep only last 20 messages to prevent memory buildup
            const newMessages = [...prev, message];
            return newMessages.slice(-20);
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
      
      // Update or create message for incoming files (but not text messages)
      // Text messages don't need progress tracking
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
          // Create placeholder message for new file transfer
          // Skip for text messages (they're handled directly in onFileReceived)
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
              const file = content.data as File;
              console.log(`📤 Sending file ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB) to ${device.name}`);
              
              // For large files (>5MB), use streaming to avoid memory issues
              const RPC_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB per RPC call
              
              if (file.size > 5 * 1024 * 1024) {
                console.log(`🌊 Large file detected, using streaming transfer...`);
                
                const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                // Stream file in chunks - each chunk written directly to TCP socket
                let offset = 0;
                let chunkIndex = 0;
                const totalChunks = Math.ceil(file.size / RPC_CHUNK_SIZE);
                
                while (offset < file.size) {
                  const slice = file.slice(offset, offset + RPC_CHUNK_SIZE);
                  const chunkData = await slice.arrayBuffer();
                  
                  const isFirst = chunkIndex === 0;
                  const isLast = offset + RPC_CHUNK_SIZE >= file.size;
                  
                  await (electroview.rpc as any).request.sendFileChunk({
                    transferId,
                    chunkData: Array.from(new Uint8Array(chunkData)),
                    isFirst,
                    isLast,
                    fileName: file.name,
                    totalSize: file.size,
                    mimeType: file.type,
                    recipientId: device.id,
                  });
                  
                  offset += RPC_CHUNK_SIZE;
                  chunkIndex++;
                  
                  console.log(`🌊 Streamed chunk ${chunkIndex}/${totalChunks}: ${offset}/${file.size} bytes`);
                  
                  // Yield to UI thread
                  await new Promise(resolve => setTimeout(resolve, 0));
                }
                
                console.log(`✓ Streaming transfer complete: ${file.name}`);
              } else {
                // Small files - send directly
                const fileData = await file.arrayBuffer();
                
                await (electroview.rpc as any).request.sendFile({
                  recipientId: device.id,
                  fileName: file.name,
                  fileData: Array.from(new Uint8Array(fileData)),
                  mimeType: file.type,
                });
              }

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
                isTextMessage: true,
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
    setReceivedMessages((prev) => {
      // Find the message to clean up blob URL
      const message = prev.find((m) => m.id === id);
      if (message?.fileUrl) {
        URL.revokeObjectURL(message.fileUrl);
        console.log("🧹 Cleaned up blob URL for:", message.fileName);
      }
      return prev.filter((m) => m.id !== id);
    });
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
