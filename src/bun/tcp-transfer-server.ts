/**
 * Direct TCP File Transfer Server for LAN-only transfers
 * No WebRTC, no STUN, no ICE - just simple TCP connections
 */

import { createServer, connect, Server, Socket } from "net";
import { randomBytes } from "crypto";

const TRANSFER_PORT = 50004;

interface TransferMetadata {
  transferId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  from: string;
  isTextMessage?: boolean; // Flag to indicate this is a text message, not a file
}

interface TransferProgress {
  transferId: string;
  fileName: string;
  totalBytes: number;
  receivedBytes: number;
  progress: number;
}

interface StreamingTransfer {
  socket: Socket;
  transferId: string;
  fileName: string;
  totalSize: number;
  sentBytes: number;
}

export class TcpTransferServer {
  private server: Server | null = null;
  private onTransferCallback: ((metadata: TransferMetadata, data: Buffer) => void) | null = null;
  private onProgressCallback: ((progress: TransferProgress) => void) | null = null;
  private activeStreams: Map<string, StreamingTransfer> = new Map();

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleIncomingConnection(socket);
      });

      this.server.on("error", (err) => {
        console.error("TCP transfer server error:", err);
        reject(err);
      });

      this.server.listen(TRANSFER_PORT, "0.0.0.0", () => {
        console.log(`✓ TCP transfer server listening on port ${TRANSFER_PORT}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.log("TCP transfer server stopped");
          resolve();
        });
      });
    }
  }

  onTransfer(callback: (metadata: TransferMetadata, data: Buffer) => void): void {
    this.onTransferCallback = callback;
  }

  onProgress(callback: (progress: TransferProgress) => void): void {
    this.onProgressCallback = callback;
  }

  private handleIncomingConnection(socket: Socket): void {
    console.log(`📥 Incoming connection from ${socket.remoteAddress}`);

    let metadata: TransferMetadata | null = null;
    let receivedData: Buffer[] = [];
    let receivedBytes = 0;
    let expectedBytes = 0;
    let metadataReceived = false;
    let transferComplete = false;

    socket.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!metadataReceived) {
        // First packet contains metadata
        try {
          const metadataStr = buf.toString("utf-8");
          const newlineIndex = metadataStr.indexOf("\n");
          
          if (newlineIndex !== -1) {
            const metadataJson = metadataStr.substring(0, newlineIndex);
            metadata = JSON.parse(metadataJson);
            expectedBytes = metadata!.fileSize;
            metadataReceived = true;

            console.log(`📦 Receiving: ${metadata!.fileName} (${expectedBytes} bytes) from ${metadata!.from}`);

            // If there's data after the metadata in the same chunk
            if (buf.length > newlineIndex + 1) {
              const dataChunk = Buffer.from(buf.slice(newlineIndex + 1));
              receivedData.push(dataChunk);
              receivedBytes += dataChunk.length;
            }
          }
        } catch (error) {
          console.error("Failed to parse metadata:", error);
          socket.destroy();
          return;
        }
      } else {
        // Subsequent packets contain file data
        receivedData.push(buf);
        receivedBytes += buf.length;

        // Log every 10MB
        if (receivedBytes % (10 * 1024 * 1024) < buf.length) {
          console.log(`📦 Received: ${(receivedBytes / 1024 / 1024).toFixed(1)}MB / ${(expectedBytes / 1024 / 1024).toFixed(1)}MB`);
        }

        // Report progress locally
        if (this.onProgressCallback && metadata) {
          this.onProgressCallback({
            transferId: metadata.transferId,
            fileName: metadata.fileName,
            totalBytes: expectedBytes,
            receivedBytes,
            progress: Math.floor((receivedBytes / expectedBytes) * 100),
          });
        }

        // Send progress update back to sender
        const progressUpdate = {
          type: "progress",
          transferId: metadata!.transferId,
          receivedBytes,
          totalBytes: expectedBytes,
          progress: Math.floor((receivedBytes / expectedBytes) * 100),
        };
        socket.write(JSON.stringify(progressUpdate) + "\n");
      }

      // Check if transfer is complete
      if (metadataReceived && receivedBytes >= expectedBytes) {
        const completeData = Buffer.concat(receivedData);
        
        console.log(`✓ Transfer complete: ${metadata!.fileName} (${receivedBytes}/${expectedBytes} bytes)`);
        transferComplete = true;

        if (this.onTransferCallback && metadata) {
          this.onTransferCallback(metadata, completeData);
        }

        socket.end();
      }
    });

    socket.on("error", (err) => {
      console.error("Socket error:", err);
      
      // Clean up partial data on error
      if (metadataReceived && !transferComplete) {
        console.warn(`⚠️ Transfer interrupted: ${metadata!.fileName} (${receivedBytes}/${expectedBytes} bytes received)`);
        receivedData = []; // Discard partial data
      }
    });

    socket.on("close", () => {
      // Check if transfer was incomplete
      if (metadataReceived && !transferComplete) {
        const missing = expectedBytes - receivedBytes;
        console.warn(`⚠️ Connection closed with incomplete transfer: ${metadata!.fileName}`);
        console.warn(`   Received: ${receivedBytes} / ${expectedBytes} bytes`);
        console.warn(`   Missing: ${missing} bytes (${((missing / expectedBytes) * 100).toFixed(2)}%)`);
        console.log(`🗑️ Discarding partial data to prevent corrupt file`);
        receivedData = []; // Discard partial data
      } else if (transferComplete) {
        console.log("Connection closed - transfer was complete");
      } else {
        console.log("Connection closed");
      }
    });
  }

  /**
   * Start a streaming transfer - opens TCP connection and sends metadata
   * Chunks will be written directly to this socket without buffering
   */
  async startStreamingTransfer(
    transferId: string,
    recipientIp: string,
    fileName: string,
    totalSize: number,
    mimeType: string,
    fromDeviceId: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`🌊 Opening streaming connection to ${recipientIp}:${TRANSFER_PORT}`);

      const socket = connect(TRANSFER_PORT, recipientIp, () => {
        console.log(`✓ Streaming connection established for ${fileName}`);

        // Send metadata first
        const metadata: TransferMetadata = {
          transferId,
          fileName,
          fileSize: totalSize,
          mimeType,
          from: fromDeviceId,
          isTextMessage: false,
        };

        const metadataStr = JSON.stringify(metadata) + "\n";
        socket.write(metadataStr);

        // Store active stream
        this.activeStreams.set(transferId, {
          socket,
          transferId,
          fileName,
          totalSize,
          sentBytes: 0,
        });

        resolve();
      });

      // Listen for progress updates from receiver
      let progressBuffer = "";
      socket.on("data", (chunk) => {
        progressBuffer += chunk.toString();
        const lines = progressBuffer.split("\n");
        progressBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const update = JSON.parse(line);
            if (update.type === "progress" && update.transferId === transferId) {
              // Report real progress from receiver
              if (this.onProgressCallback) {
                this.onProgressCallback({
                  transferId,
                  fileName,
                  totalBytes: totalSize,
                  receivedBytes: update.receivedBytes,
                  progress: update.progress,
                });
              }
            }
          } catch (err) {
            // Ignore parse errors for progress updates
          }
        }
      });

      socket.on("error", (err) => {
        console.error(`Streaming connection error for ${fileName}:`, err);
        this.activeStreams.delete(transferId);
        reject(err);
      });

      socket.on("close", () => {
        // Clean up if connection drops before transfer completes
        if (this.activeStreams.has(transferId)) {
          console.warn(`⚠️ Connection closed before transfer complete: ${fileName}`);
          this.activeStreams.delete(transferId);
        }
      });
    });
  }

  /**
   * Write a chunk to an active streaming transfer
   * Chunk is written directly to TCP socket and discarded (no buffering)
   */
  async writeChunk(transferId: string, chunk: Buffer): Promise<void> {
    const stream = this.activeStreams.get(transferId);
    if (!stream) {
      throw new Error(`No active stream found for transfer ${transferId}`);
    }

    return new Promise((resolve, reject) => {
      const canContinue = stream.socket.write(chunk);
      stream.sentBytes += chunk.length;

      // Log progress every 10MB
      if (stream.sentBytes % (10 * 1024 * 1024) < chunk.length) {
        console.log(`🌊 Streaming: ${(stream.sentBytes / 1024 / 1024).toFixed(1)}MB / ${(stream.totalSize / 1024 / 1024).toFixed(1)}MB`);
      }

      if (canContinue) {
        resolve();
      } else {
        // Wait for drain event
        stream.socket.once("drain", () => resolve());
      }
    });
  }

  /**
   * Finish a streaming transfer - waits for receiver confirmation before closing
   */
  async finishStreamingTransfer(transferId: string): Promise<void> {
    const stream = this.activeStreams.get(transferId);
    if (!stream) {
      throw new Error(`No active stream found for transfer ${transferId}`);
    }

    return new Promise((resolve) => {
      console.log(`✓ All chunks sent: ${stream.fileName} (${stream.sentBytes} bytes)`);
      console.log(`⏳ Waiting for receiver to confirm 100%...`);
      
      // Wait for receiver to confirm 100% via progress update
      // The socket.on("data") handler will close the socket when progress >= 100
      // If no confirmation after 5 seconds, close anyway
      const timeout = setTimeout(() => {
        console.warn(`⚠️ No 100% confirmation received, closing socket anyway`);
        stream.socket.end(() => {
          this.activeStreams.delete(transferId);
          resolve();
        });
      }, 5000);
      
      // Store timeout so we can clear it if we get 100% confirmation
      (stream as any).closeTimeout = timeout;
      (stream as any).closeResolve = resolve;
    });
  }

  /**
   * Send file to a remote device via direct TCP connection
   */
  async sendFile(
    recipientIp: string,
    fileName: string,
    fileData: Buffer,
    mimeType: string,
    fromDeviceId: string,
    isTextMessage?: boolean,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const transferId = randomBytes(16).toString("hex");
      
      console.log(`📤 Connecting to ${recipientIp}:${TRANSFER_PORT} to send ${fileName}`);

      const socket = connect(TRANSFER_PORT, recipientIp, () => {
        console.log(`✓ Connected to ${recipientIp}`);

        // Send metadata first
        const metadata: TransferMetadata = {
          transferId,
          fileName,
          fileSize: fileData.length,
          mimeType,
          from: fromDeviceId,
          isTextMessage,
        };

        const metadataStr = JSON.stringify(metadata) + "\n";
        socket.write(metadataStr);

        // Send file data in chunks
        const chunkSize = 256 * 1024; // 256KB chunks for faster transfers
        let sentBytes = 0;

        const sendNextChunk = () => {
          if (sentBytes >= fileData.length) {
            console.log(`✓ File sent: ${fileName}`);
            // Don't close socket yet - wait for final progress confirmation
            return;
          }

          const chunk = fileData.slice(sentBytes, sentBytes + chunkSize);
          const canContinue = socket.write(chunk);
          sentBytes += chunk.length;

          if (canContinue) {
            // Continue sending immediately
            setImmediate(sendNextChunk);
          } else {
            // Wait for drain event
            socket.once("drain", sendNextChunk);
          }
        };

        sendNextChunk();
      });

      // Listen for progress updates from receiver
      let progressBuffer = "";
      socket.on("data", (chunk) => {
        progressBuffer += chunk.toString();
        const lines = progressBuffer.split("\n");
        progressBuffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const update = JSON.parse(line);
            if (update.type === "progress" && update.transferId === transferId) {
              // Report real progress from receiver
              if (onProgress) {
                onProgress({
                  transferId,
                  fileName,
                  totalBytes: fileData.length,
                  receivedBytes: update.receivedBytes,
                  progress: update.progress,
                });
              }

              // If transfer is complete, close socket
              if (update.progress >= 100) {
                console.log(`✓ Transfer confirmed complete by receiver: ${fileName}`);
                
                // Clear timeout and resolve from finishStreamingTransfer
                const stream = this.activeStreams.get(transferId);
                if (stream && (stream as any).closeTimeout) {
                  clearTimeout((stream as any).closeTimeout);
                  socket.end(() => {
                    this.activeStreams.delete(transferId);
                    if ((stream as any).closeResolve) {
                      (stream as any).closeResolve();
                    }
                  });
                } else {
                  // Old sendFile method (non-streaming)
                  socket.end();
                  resolve();
                }
              }
            }
          } catch (err) {
            console.error("Failed to parse progress update:", err);
          }
        }
      });

      socket.on("error", (err) => {
        console.error(`Failed to send file to ${recipientIp}:`, err);
        reject(err);
      });
    });
  }
}

export const tcpTransferServer = new TcpTransferServer();
