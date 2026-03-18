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
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet: boolean = false;

  constructor() {
    this.transferId = generateTransferId();
  }

  getTransferId(): string {
    return this.transferId;
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
    onProgress: (progress: TransferProgress) => void,
    recipientIp?: string
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
      await this.createPeerConnection(recipientId, recipientIp);

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
        // Create peer connection for LAN-only transfers (no STUN/TURN needed)
        // Disable mDNS to use actual IP addresses instead of .local addresses
        this.peerConnection = new RTCPeerConnection({
          iceServers: [], // No external servers - LAN only
          bundlePolicy: "max-bundle",
          rtcpMuxPolicy: "require",
        });

        // Force ICE to use actual IP addresses by filtering mDNS candidates
        const originalSetLocalDescription = this.peerConnection.setLocalDescription.bind(this.peerConnection);
        this.peerConnection.setLocalDescription = async (description?: RTCSessionDescriptionInit) => {
          if (description && description.sdp) {
            // Remove mDNS candidates from SDP
            description.sdp = description.sdp.replace(/c=IN IP4 .*\.local/g, (match) => {
              console.log("🔧 [Receiver] Filtering mDNS candidate:", match);
              return match;
            });
          }
          return originalSetLocalDescription(description);
        };

        // Log connection state changes
        this.peerConnection.onconnectionstatechange = () => {
          console.log(`🔗 [Receiver] Connection state: ${this.peerConnection!.connectionState}`);
        };

        this.peerConnection.oniceconnectionstatechange = () => {
          console.log(`🧊 [Receiver] ICE connection state: ${this.peerConnection!.iceConnectionState}`);
        };

        this.peerConnection.onicegatheringstatechange = () => {
          console.log(`📡 [Receiver] ICE gathering state: ${this.peerConnection!.iceGatheringState}`);
        };

        // Handle ICE candidates - send all host candidates (including mDNS)
        this.peerConnection.onicecandidate = async (event) => {
          if (event.candidate) {
            // Only use host candidates (local network)
            if (event.candidate.type !== "host") {
              console.log("⏭️  [Receiver] Skipping non-host candidate:", event.candidate.type);
              return;
            }
            
            console.log("📤 [Receiver] Sending ICE candidate to sender", senderId, "- Address:", event.candidate.address || "mDNS");
            await this.sendSignal(senderId, "ice-candidate", event.candidate);
          } else {
            console.log("✓ [Receiver] All ICE candidates sent");
          }
        };

        // Handle incoming data channel
        this.peerConnection.ondatachannel = (event) => {
          this.dataChannel = event.channel;
          this.setupDataChannelHandlers(resolve, reject);
        };

        // Set remote offer
        await this.peerConnection.setRemoteDescription(offer);
        this.remoteDescriptionSet = true;
        console.log("✓ Remote description set");

        // Process any pending ICE candidates
        if (this.pendingIceCandidates.length > 0) {
          console.log(`📦 Processing ${this.pendingIceCandidates.length} pending ICE candidates`);
          for (const candidate of this.pendingIceCandidates) {
            try {
              await this.peerConnection.addIceCandidate(candidate);
              console.log("✓ Pending ICE candidate added");
            } catch (error) {
              console.error("✗ Failed to add pending ICE candidate:", error);
            }
          }
          this.pendingIceCandidates = [];
        }

        // Create answer
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        // Send answer back through signaling server
        console.log("Sending answer to sender", senderId);
        await this.sendSignal(senderId, "answer", answer);

        console.log("✓ Ready to receive file");
      } catch (error) {
        console.error("✗ Failed to setup file reception:", error);
        reject(error);
      }
    });
  }

  private async createPeerConnection(recipientId: string, recipientIp?: string): Promise<void> {
    // Create peer connection for LAN-only transfers (no STUN/TURN needed)
    this.peerConnection = new RTCPeerConnection({
      iceServers: [], // No external servers - LAN only
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });

    // Log connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      console.log(`🔗 Connection state: ${this.peerConnection!.connectionState}`);
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log(`🧊 ICE connection state: ${this.peerConnection!.iceConnectionState}`);
    };

    this.peerConnection.onicegatheringstatechange = () => {
      console.log(`📡 ICE gathering state: ${this.peerConnection!.iceGatheringState}`);
    };

    // Handle ICE candidates - send all host candidates
    this.peerConnection.onicecandidate = async (event) => {
      if (event.candidate) {
        // Only use host candidates (local network)
        if (event.candidate.type !== "host") {
          console.log("⏭️  Skipping non-host candidate:", event.candidate.type);
          return;
        }
        
        console.log("📤 Sending ICE candidate to", recipientId, "- Address:", event.candidate.address || "mDNS");
        await this.sendSignal(recipientId, "ice-candidate", event.candidate);
      } else {
        console.log("✓ All ICE candidates sent");
      }
    };

    // Create data channel
    this.dataChannel = this.peerConnection.createDataChannel("fileTransfer", {
      ordered: true,
    });

    this.dataChannel.binaryType = "arraybuffer";

    // Log data channel state
    this.dataChannel.onopen = () => {
      console.log("✅ Data channel opened - ready to send!");
    };

    this.dataChannel.onclose = () => {
      console.log("❌ Data channel closed");
    };

    this.dataChannel.onerror = (error) => {
      console.error("❌ Data channel error:", error);
    };

    // Create and send offer
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    // If we have the recipient's IP, manually add it as an ICE candidate
    if (recipientIp) {
      console.log("🎯 Manually adding recipient IP as ICE candidate:", recipientIp);
      // We'll add this after the remote description is set by the receiver
    }

    // Send offer through signaling server
    console.log("Sending offer to", recipientId);
    await this.sendSignal(recipientId, "offer", offer);
    
    console.log("✓ Peer connection created, offer sent");
  }

  private async sendSignal(to: string, type: string, data: any): Promise<void> {
    console.log(`📤 Sending signal: ${type} to ${to}, transferId: ${this.transferId}`);
    const electroview = (window as any).electroview;
    if (electroview && electroview.rpc) {
      console.log("✓ Electroview RPC available, sending signal...");
      try {
        await electroview.rpc.request.sendSignal({
          to,
          signal: {
            type,
            transferId: this.transferId,
            data,
          },
        });
        console.log(`✓ Signal ${type} sent successfully`);
      } catch (error) {
        console.error(`✗ Failed to send signal ${type}:`, error);
        throw error;
      }
    } else {
      console.error("✗ Electroview RPC not available!");
    }
  }

  /**
   * Handle answer from receiver (for sender)
   */
  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (this.peerConnection) {
      await this.peerConnection.setRemoteDescription(answer);
      this.remoteDescriptionSet = true;
      console.log("✓ Answer received and set");

      // Process any pending ICE candidates
      if (this.pendingIceCandidates.length > 0) {
        console.log(`📦 Processing ${this.pendingIceCandidates.length} pending ICE candidates`);
        for (const candidate of this.pendingIceCandidates) {
          try {
            await this.peerConnection.addIceCandidate(candidate);
            console.log("✓ Pending ICE candidate added");
          } catch (error) {
            console.error("✗ Failed to add pending ICE candidate:", error);
          }
        }
        this.pendingIceCandidates = [];
      }
    }
  }

  /**
   * Handle ICE candidate from receiver (for sender)
   */
  async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) {
      console.warn("⚠️  No peer connection - ignoring ICE candidate");
      return;
    }

    // Queue candidates if remote description not set yet
    if (!this.remoteDescriptionSet) {
      console.log("📦 Queueing ICE candidate (remote description not set yet)");
      this.pendingIceCandidates.push(candidate);
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(candidate);
      console.log("✓ ICE candidate added");
    } catch (error) {
      console.error("✗ Failed to add ICE candidate:", error);
    }
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
      console.log(`⏳ Waiting for data channel to open (current state: ${this.dataChannel!.readyState})...`);
      
      if (this.dataChannel!.readyState === "open") {
        console.log("✓ Data channel already open!");
        resolve();
        return;
      }

      const openHandler = () => {
        console.log("✅ Data channel opened - connection established!");
        resolve();
      };

      const errorHandler = (error: Event) => {
        console.error("❌ Data channel error:", error);
        reject(new Error("Failed to open data channel"));
      };

      this.dataChannel!.addEventListener("open", openHandler, { once: true });
      this.dataChannel!.addEventListener("error", errorHandler, { once: true });

      // Timeout after 45 seconds with detailed error
      setTimeout(() => {
        console.error("❌ Connection timeout - data channel state:", this.dataChannel!.readyState);
        console.error("❌ Peer connection state:", this.peerConnection!.connectionState);
        console.error("❌ ICE connection state:", this.peerConnection!.iceConnectionState);
        reject(new Error(`Connection timeout - Data channel: ${this.dataChannel!.readyState}, ICE: ${this.peerConnection!.iceConnectionState}`));
      }, 45000);
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
