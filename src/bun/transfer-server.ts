/**
 * WebRTC Signaling Server for P2P file transfers
 * Handles signaling between peers without seeing the actual data
 * Uses UDP to send signals over the network to remote devices
 */

import dgram from "dgram";

const SIGNAL_PORT = 50003; // Different from device discovery port

interface SignalingMessage {
  type: "offer" | "answer" | "ice-candidate";
  transferId: string;
  from: string;
  to: string;
  data: any;
}

interface PendingTransfer {
  id: string;
  from: string;
  to: string;
  offer?: any;
  answer?: any;
  iceCandidates: { from: string; candidate: any }[];
}

class TransferSignalingServer {
  private pendingTransfers: Map<string, PendingTransfer> = new Map();
  private callbacks: Map<string, (message: SignalingMessage) => void> = new Map();
  private udpServer: dgram.Socket | null = null;
  private deviceIpMap: Map<string, string> = new Map(); // deviceId -> IP address

  /**
   * Start UDP server to receive signals from remote devices
   */
  async start(): Promise<void> {
    this.udpServer = dgram.createSocket("udp4");

    this.udpServer.on("message", (msg, rinfo) => {
      try {
        const message = JSON.parse(msg.toString()) as SignalingMessage & { messageType: string };
        
        if (message.messageType === "webrtc-signal") {
          console.log(`📥 Received signal from ${rinfo.address}:`, message.type);
          
          // Forward to local callback
          const callback = this.callbacks.get(message.to);
          if (callback) {
            callback(message);
          } else {
            console.warn(`No callback registered for device ${message.to}`);
          }
        }
      } catch (error) {
        console.error("Failed to parse signaling message:", error);
      }
    });

    this.udpServer.on("error", (err) => {
      console.error("Signaling server error:", err);
    });

    this.udpServer.bind(SIGNAL_PORT, () => {
      console.log(`Signaling server listening on port ${SIGNAL_PORT}`);
    });
  }

  /**
   * Stop the signaling server
   */
  async stop(): Promise<void> {
    if (this.udpServer) {
      this.udpServer.close();
      this.udpServer = null;
    }
  }

  /**
   * Update device IP mapping (called when devices are discovered)
   */
  updateDeviceIp(deviceId: string, ip: string) {
    this.deviceIpMap.set(deviceId, ip);
  }

  /**
   * Register a device to receive signaling messages
   */
  registerDevice(deviceId: string, callback: (message: SignalingMessage) => void) {
    this.callbacks.set(deviceId, callback);
    console.log(`Device ${deviceId} registered for signaling`);
  }

  /**
   * Unregister a device
   */
  unregisterDevice(deviceId: string) {
    this.callbacks.delete(deviceId);
    console.log(`Device ${deviceId} unregistered from signaling`);
  }

  /**
   * Handle signaling message from a device
   */
  handleSignal(message: SignalingMessage) {
    const { transferId, type, from, to, data } = message;

    console.log(`Signaling: ${type} from ${from} to ${to} for transfer ${transferId}`);

    // Get or create pending transfer
    let transfer = this.pendingTransfers.get(transferId);
    if (!transfer) {
      transfer = {
        id: transferId,
        from,
        to,
        iceCandidates: [],
      };
      this.pendingTransfers.set(transferId, transfer);
    }

    // Store the signaling data
    switch (type) {
      case "offer":
        transfer.offer = data;
        break;
      case "answer":
        transfer.answer = data;
        break;
      case "ice-candidate":
        transfer.iceCandidates.push({ from, candidate: data });
        break;
    }

    // Send signal over network to recipient
    const recipientIp = this.deviceIpMap.get(to);
    if (recipientIp) {
      this.sendSignalOverNetwork(message, recipientIp);
    } else {
      console.warn(`No IP address found for recipient ${to}`);
    }
  }

  /**
   * Send signal over UDP to remote device
   */
  private sendSignalOverNetwork(message: SignalingMessage, recipientIp: string) {
    if (!this.udpServer) {
      console.error("UDP server not started");
      return;
    }

    const payload = JSON.stringify({
      ...message,
      messageType: "webrtc-signal",
    });

    const buffer = Buffer.from(payload);

    this.udpServer.send(buffer, SIGNAL_PORT, recipientIp, (err) => {
      if (err) {
        console.error(`Failed to send signal to ${recipientIp}:`, err);
      } else {
        console.log(`📤 Sent ${message.type} signal to ${recipientIp}:${SIGNAL_PORT}`);
      }
    });
  }

  /**
   * Clean up completed transfer
   */
  cleanupTransfer(transferId: string) {
    this.pendingTransfers.delete(transferId);
    console.log(`Transfer ${transferId} cleaned up`);
  }

  /**
   * Get pending transfer info
   */
  getTransfer(transferId: string): PendingTransfer | undefined {
    return this.pendingTransfers.get(transferId);
  }
}

export const signalingServer = new TransferSignalingServer();
