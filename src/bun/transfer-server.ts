/**
 * WebRTC Signaling Server for P2P file transfers
 * Handles signaling between peers without seeing the actual data
 */

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

    // Forward message to recipient
    const recipientCallback = this.callbacks.get(to);
    if (recipientCallback) {
      recipientCallback(message);
    } else {
      console.warn(`Recipient ${to} not registered for signaling`);
    }
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
