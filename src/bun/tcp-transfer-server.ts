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
}

interface TransferProgress {
  transferId: string;
  fileName: string;
  totalBytes: number;
  receivedBytes: number;
  progress: number;
}

export class TcpTransferServer {
  private server: Server | null = null;
  private onTransferCallback: ((metadata: TransferMetadata, data: Buffer) => void) | null = null;
  private onProgressCallback: ((progress: TransferProgress) => void) | null = null;

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

        // Report progress
        if (this.onProgressCallback && metadata) {
          this.onProgressCallback({
            transferId: metadata.transferId,
            fileName: metadata.fileName,
            totalBytes: expectedBytes,
            receivedBytes,
            progress: Math.floor((receivedBytes / expectedBytes) * 100),
          });
        }
      }

      // Check if transfer is complete
      if (metadataReceived && receivedBytes >= expectedBytes) {
        const completeData = Buffer.concat(receivedData);
        
        console.log(`✓ Transfer complete: ${metadata!.fileName}`);

        if (this.onTransferCallback && metadata) {
          this.onTransferCallback(metadata, completeData);
        }

        socket.end();
      }
    });

    socket.on("error", (err) => {
      console.error("Socket error:", err);
    });

    socket.on("end", () => {
      console.log("Connection closed");
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
        };

        const metadataStr = JSON.stringify(metadata) + "\n";
        socket.write(metadataStr);

        // Send file data in chunks
        const chunkSize = 64 * 1024; // 64KB chunks
        let sentBytes = 0;

        const sendNextChunk = () => {
          if (sentBytes >= fileData.length) {
            console.log(`✓ File sent: ${fileName}`);
            socket.end();
            resolve();
            return;
          }

          const chunk = fileData.slice(sentBytes, sentBytes + chunkSize);
          const canContinue = socket.write(chunk);
          sentBytes += chunk.length;

          // Report progress
          if (onProgress) {
            onProgress({
              transferId,
              fileName,
              totalBytes: fileData.length,
              receivedBytes: sentBytes,
              progress: Math.floor((sentBytes / fileData.length) * 100),
            });
          }

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

      socket.on("error", (err) => {
        console.error(`Failed to send file to ${recipientIp}:`, err);
        reject(err);
      });
    });
  }
}

export const tcpTransferServer = new TcpTransferServer();
