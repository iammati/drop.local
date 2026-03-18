import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageSquare } from "lucide-react";
import type { ReceivedMessage } from "../../hooks/useFileTransfer";

interface MessageToastProps {
  messages: ReceivedMessage[];
  onDismiss: (messageId: string) => void;
}

export function MessageToast({ messages, onDismiss }: MessageToastProps) {
  useEffect(() => {
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      const timer = setTimeout(() => {
        onDismiss(latestMessage.id);
      }, 10000);

      return () => clearTimeout(timer);
    }
  }, [messages, onDismiss]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md">
      <AnimatePresence>
        {messages.map((message) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 50, scale: 0.3 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
            className="bg-card border border-border rounded-lg shadow-lg p-4 min-w-[300px]"
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-foreground">
                    Message from {message.from.substring(0, 8)}...
                  </p>
                  <button
                    onClick={() => onDismiss(message.id)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                
                <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">
                  {message.content}
                </p>
                
                <p className="text-xs text-muted-foreground mt-2">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
