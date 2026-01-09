/**
 * Page Context Bridge - Runs in MAIN world to intercept WebSocket
 * 
 * This script:
 * 1. Runs in the page's main JavaScript context (world: "MAIN")
 * 2. Intercepts WebSocket connections to Lichess
 * 3. Captures game state messages
 * 4. Sends moves back to Lichess
 * 5. Communicates with content script via CustomEvents
 * 
 * Note: Cannot use ES6 imports in MAIN world, must be vanilla JS
 */

(function() {
    'use strict';
    
    console.log('[Mephisto Page Bridge] Initializing...');
    
    let activeSocket = null;
    let originalWebSocket = null;
    let wsInterceptorEnabled = false;

    /**
     * Install WebSocket interceptor
     */
    function installWebSocketInterceptor() {
        if (wsInterceptorEnabled) return;
        
        originalWebSocket = window.WebSocket;
        
        const webSocketProxy = new Proxy(originalWebSocket, {
            construct(target, args) {
                console.log('[Mephisto] WebSocket intercepted:', args[0]);
                
                const socket = new target(...args);
                activeSocket = socket;

                socket.addEventListener('message', (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        
                        // Forward WebSocket messages to content script
                        window.dispatchEvent(new CustomEvent('mephisto-ws-message', {
                            detail: message
                        }));
                        
                    } catch (e) {
                        // Non-JSON message, ignore
                    }
                });

                socket.addEventListener('close', () => {
                    console.log('[Mephisto] WebSocket closed');
                    activeSocket = null;
                });

                socket.addEventListener('error', (error) => {
                    console.error('[Mephisto] WebSocket error:', error);
                });

                return socket;
            }
        });

        window.WebSocket = webSocketProxy;
        wsInterceptorEnabled = true;
        console.log('[Mephisto] WebSocket interceptor installed');
        
        // Notify content script that interceptor is ready
        window.dispatchEvent(new CustomEvent('mephisto-ws-ready'));
    }

    /**
     * Uninstall WebSocket interceptor
     */
    function uninstallWebSocketInterceptor() {
        if (!wsInterceptorEnabled) return;
        
        if (originalWebSocket) {
            window.WebSocket = originalWebSocket;
            console.log('[Mephisto] WebSocket interceptor uninstalled');
        }
        
        wsInterceptorEnabled = false;
        activeSocket = null;
    }

    /**
     * Send move through active WebSocket
     */
    function sendMove(movePacket) {
        if (activeSocket?.readyState === WebSocket.OPEN) {
            activeSocket.send(movePacket);
            console.log('[Mephisto] Move sent:', movePacket);
            return true;
        }
        console.warn('[Mephisto] Cannot send - WebSocket not open');
        return false;
    }

    /**
     * Check if WebSocket is open
     */
    function isWebSocketOpen() {
        return activeSocket?.readyState === WebSocket.OPEN;
    }

    // Listen for commands from content script
    window.addEventListener('mephisto-command', (event) => {
        const { command, data } = event.detail;
        
        switch (command) {
            case 'install-interceptor':
                installWebSocketInterceptor();
                break;
                
            case 'uninstall-interceptor':
                uninstallWebSocketInterceptor();
                break;
                
            case 'send-move':
                const success = sendMove(data.movePacket);
                window.dispatchEvent(new CustomEvent('mephisto-move-sent', {
                    detail: { success }
                }));
                break;
                
            case 'check-ws-state':
                const isOpen = isWebSocketOpen();
                window.dispatchEvent(new CustomEvent('mephisto-ws-state', {
                    detail: { isOpen }
                }));
                break;
        }
    });

    // Auto-install on Lichess pages
    if (window.location.hostname === 'lichess.org' || 
        window.location.hostname.endsWith('.lichess.org')) {
        installWebSocketInterceptor();
    }
    
    console.log('[Mephisto Page Bridge] Ready');
})();
