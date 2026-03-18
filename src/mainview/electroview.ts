import { Electroview } from "electrobun/view";

// Create the Electroview instance to access RPC from bun process
// We don't need to define handlers since we're only calling bun functions
export const electroview = new Electroview({
  rpc: Electroview.defineRPC({
    handlers: {
      requests: {},
      messages: {},
    },
  }),
});

// Make it globally available for debugging
if (typeof window !== "undefined") {
  (window as any).electroview = electroview;
  console.log("✓ Electroview initialized and available globally");
}
