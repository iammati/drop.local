/**
 * Secure P2P File Transfer using WebRTC Data Channels
 * Features:
 * - Direct peer-to-peer connection (no data goes through server)
 * - End-to-end encryption using AES-GCM
 * - Chunked transfer with progress tracking
 * - Integrity verification using SHA-256 hashes
 */

import { encryptData, decryptData, generateEncryptionKey, importKey, hashData, generateTransferId } from "./crypto";
import type { SharedContent } from "../pages/Index";

const MB = 1024 * 1024;

// Adaptive chunk sizes based on file size
function getChunkSize(fileSize: number): number {
  if (fileSize < 1 * MB) return fileSize; // < 1MB: whole file
  if (fileSize < 50 * MB) return 2 * MB; // 1-50MB: 2MB chunks
  if (fileSize < 500 * MB) return 8 * MB; // 50-500MB: 8MB chunks
  return 16 * MB; // > 500MB: 16MB chunks
}

// WebRTC buffer threshold for backpressure
const BUFFER_THRESHOLD = 16 * MB;

export interface TransferProgress {
  transferId: string;
  fileName: string;
  totalBytes: number;
  sentBytes: number;
  progress: number; // 0-100
  status: "preparing" | "connecting" | "transferring" | "completed" | "failed";
  error?: string;
}

export class FileTransferService {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private encryptionKey: CryptoKey | null = null;
  private onProgressCallback: ((progress: TransferProgress) => void) | null = null;
  private transferId: string;

  constructor() {
    this.transferId = generateTransferId();
  }

  /**
   * Send file to a remote peer
   * 
   * Uses adaptive chunking based on file size:
   * - < 1MB: whole file (no chunking)
   * - 1-50MB: 2MB chunks
   * - 50-500MB: 8MB chunks
   * - > 500MB: 16MB chunks
   * 
   * Implements backpressure via bufferedAmount monitoring
   * to prevent buffer overflow on large transfers.
   */
  async sendFile(
    file: File,
    recipientId: string,
    onProgress: (progress: TransferProgress) => void
  ): Promise<void> {
    this.onProgressCallback = onProgress;

    try {
      // Update status: preparing
      this.updateProgress({
        transferId: this.transferId,
        fileName: file.name,
        totalBytes: file.size,
        sentBytes: 0,
        progress: 0,
        status: "preparing",
      });

      // Generate encryption key
      this.encryptionKey = await generateEncryptionKey();

      // Create peer connection
      await this.createPeerConnection(recipientId);

      // Wait for connection to be established
      await this.waitForConnection();

      // Update status: transferring
      this.updateProgress({
        transferId: this.transferId,
        fileName: file.name,
        totalBytes: file.size,
        sentBytes: 0,
        progress: 0,
        status: "transferring",
      });

      // Read and encrypt file in chunks
      const fileBuffer = await file.arrayBuffer();
      const encrypted = await encryptData(fileBuffer, this.encryptionKey);

      // Calculate hash for integrity
      const fileHash = await hashData(fileBuffer);

      // Send metadata first
      const metadata = {
        type: "metadata",
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        hash: fileHash,
        iv: Array.from(encrypted.iv),
        encryptionKey: encrypted.key,
      };

      this.dataChannel!.send(JSON.stringify(metadata));

      // Send encrypted data in chunks with adaptive sizing
      const chunkSize = getChunkSize(file.size);
      const chunks = Math.ceil(encrypted.ciphertext.byteLength / chunkSize);
      let sentBytes = 0;

      for (let i = 0; i < chunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, encrypted.ciphertext.byteLength);
        const chunk = encrypted.ciphertext.slice(start, end);

        // Backpressure: wait for buffer to have space
        while (this.dataChannel!.bufferedAmount > BUFFER_THRESHOLD) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        this.dataChannel!.send(chunk);
        sentBytes += chunk.byteLength;

        // Update progress
        this.updateProgress({
          transferId: this.transferId,
          fileName: file.name,
          totalBytes: file.size,
          sentBytes: Math.floor((sentBytes / encrypted.ciphertext.byteLength) * file.size),
          progress: Math.floor((sentBytes / encrypted.ciphertext.byteLength) * 100),
          status: "transferring",
        });
      }

      // Send completion signal
      this.dataChannel!.send(JSON.stringify({ type: "complete" }));

      // Update status: completed
      this.updateProgress({
        transferId: this.transferId,
        fileName: file.name,
        totalBytes: file.size,
        sentBytes: file.size,
        progress: 100,
        status: "completed",
      });

      console.log(`✓ File ${file.name} sent successfully`);
    } catch (error) {
      console.error("✗ File transfer failed:", error);
      this.updateProgress({
        transferId: this.transferId,
        fileName: file.name,
        totalBytes: 0,
        sentBytes: 0,
        progress: 0,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    } finally {
      this.cleanup();
    }
  }

  /**
   * Receive file from a remote peer
   */
  async receiveFile(
    offer: RTCSessionDescriptionInit,
    senderId: string,
    onProgress: (progress: TransferProgress) => void
  ): Promise<File> {
    this.onProgressCallback = onProgress;

    return new Promise(async (resolve, reject) => {
      try {
        // Create peer connection
        this.peerConnection = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        // Handle incoming data channel
        this.peerConnection.ondatachannel = (event) => {
          this.dataChannel = event.channel;
          this.setupDataChannelHandlers(resolve, reject);
        };

        // Set remote offer
        await this.peerConnection.setRemoteDescription(offer);

        // Create answer
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        // Send answer back through signaling server
        // (This would be handled by the signaling mechanism)

        console.log("✓ Ready to receive file");
      } catch (error) {
        console.error("✗ Failed to setup file reception:", error);
        reject(error);
      }
    });
  }

  private async createPeerConnection(recipientId: string): Promise<void> {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // Create data channel
    this.dataChannel = this.peerConnection.createDataChannel("fileTransfer", {
      ordered: true,
    });

    this.dataChannel.binaryType = "arraybuffer";

    // Create and send offer
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    // In a real implementation, send offer through signaling server
    console.log("✓ Peer connection created, offer ready");
  }

  private setupDataChannelHandlers(
    resolve: (file: File) => void,
    reject: (error: Error) => void
  ): void {
    let metadata: any = null;
    let receivedChunks: ArrayBuffer[] = [];
    let receivedBytes = 0;

    this.dataChannel!.onmessage = async (event) => {
      if (typeof event.data === "string") {
        const message = JSON.parse(event.data);

        if (message.type === "metadata") {
          metadata = message;
          this.encryptionKey = await importKey(message.encryptionKey);

          this.updateProgress({
            transferId: this.transferId,
            fileName: metadata.fileName,
            totalBytes: metadata.fileSize,
            sentBytes: 0,
            progress: 0,
            status: "transferring",
          });
        } else if (message.type === "complete") {
          // Reconstruct file from chunks
          const encryptedData = new Uint8Array(
            receivedChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0)
          );
          let offset = 0;
          for (const chunk of receivedChunks) {
            encryptedData.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }

          // Decrypt
          const decrypted = await decryptData(
            {
              ciphertext: encryptedData.buffer,
              iv: new Uint8Array(metadata.iv),
              key: metadata.encryptionKey,
            },
            this.encryptionKey!
          );

          // Verify hash
          const receivedHash = await hashData(decrypted);
          if (receivedHash !== metadata.hash) {
            reject(new Error("File integrity check failed"));
            return;
          }

          // Create file
          const file = new File([decrypted], metadata.fileName, {
            type: metadata.mimeType,
          });

          this.updateProgress({
            transferId: this.transferId,
            fileName: metadata.fileName,
            totalBytes: metadata.fileSize,
            sentBytes: metadata.fileSize,
            progress: 100,
            status: "completed",
          });

          resolve(file);
        }
      } else {
        // Binary chunk
        receivedChunks.push(event.data);
        receivedBytes += event.data.byteLength;

        if (metadata) {
          this.updateProgress({
            transferId: this.transferId,
            fileName: metadata.fileName,
            totalBytes: metadata.fileSize,
            sentBytes: Math.floor((receivedBytes / receivedChunks.length) * metadata.fileSize),
            progress: Math.floor((receivedBytes / receivedChunks.length) * 100),
            status: "transferring",
          });
        }
      }
    };

    this.dataChannel!.onerror = (error) => {
      reject(new Error("Data channel error"));
    };
  }

  private async waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.dataChannel!.readyState === "open") {
        resolve();
        return;
      }

      this.dataChannel!.onopen = () => {
        console.log("✓ Data channel opened");
        resolve();
      };

      this.dataChannel!.onerror = () => {
        reject(new Error("Failed to open data channel"));
      };

      // Timeout after 30 seconds
      setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 30000);
    });
  }

  private updateProgress(progress: TransferProgress): void {
    if (this.onProgressCallback) {
      this.onProgressCallback(progress);
    }
  }

  private cleanup(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.encryptionKey = null;
  }
}
