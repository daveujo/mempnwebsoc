/**
 * WebSocketInterceptor - Proxy WebSocket for move interception
 * 
 * Ported from: new move logic to apply/lichessbot/bot.js (lines 18-57)
 * 
 * NOTE: Must run in page context (content_scripts world: MAIN) to access window.WebSocket
 * 
 * Original implementation:
 * const webSocketProxy = new Proxy(nativeWebSocket, {
 *     construct: function(target, args) {
 *         const wrappedWebSocket = new target(...args);
 *         webSocketWrapper = wrappedWebSocket;
 *         wrappedWebSocket.addEventListener("message", ...);
 *         return wrappedWebSocket;
 *     }
 * });
 * window.WebSocket = webSocketProxy;
 */
export class WebSocketInterceptor {
    constructor(messageHandler) {
        this.messageHandler = messageHandler;
        this.activeSocket = null;
        this.originalWebSocket = null;
    }

    /**
     * Install WebSocket proxy
     * Intercepts all WebSocket connections and captures messages
     */
    install() {
        this.originalWebSocket = window.WebSocket;
        const self = this;

        const webSocketProxy = new Proxy(this.originalWebSocket, {
            construct(target, args) {
                console.log("[Mephisto] WebSocket intercepted:", args[0]);
                
                const socket = new target(...args);
                self.activeSocket = socket;

                socket.addEventListener("message", (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        self.messageHandler(message);
                    } catch (e) {
                        // Non-JSON message, ignore
                    }
                });

                socket.addEventListener("close", () => {
                    console.log("[Mephisto] WebSocket closed");
                    self.activeSocket = null;
                });

                socket.addEventListener("error", (error) => {
                    console.error("[Mephisto] WebSocket error:", error);
                });

                return socket;
            }
        });

        window.WebSocket = webSocketProxy;
        console.log("[Mephisto] WebSocket interceptor installed");
    }

    /**
     * Uninstall WebSocket proxy
     * Restores original WebSocket constructor
     */
    uninstall() {
        if (this.originalWebSocket) {
            window.WebSocket = this.originalWebSocket;
            console.log("[Mephisto] WebSocket interceptor uninstalled");
        }
    }

    /**
     * Send data through active WebSocket
     * @param {string} data - Data to send
     * @returns {boolean} True if sent successfully
     */
    send(data) {
        if (this.activeSocket?.readyState === WebSocket.OPEN) {
            this.activeSocket.send(data);
            return true;
        }
        console.warn("[Mephisto] Cannot send - WebSocket not open");
        return false;
    }

    /**
     * Check if WebSocket is open
     * @returns {boolean} True if socket is open
     */
    isOpen() {
        return this.activeSocket?.readyState === WebSocket.OPEN;
    }

    /**
     * Get active socket state
     * @returns {number|null} WebSocket ready state
     */
    getState() {
        return this.activeSocket?.readyState ?? null;
    }
}
