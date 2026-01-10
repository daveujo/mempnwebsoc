/**
 * Page Context Bridge - Runs in MAIN world to intercept WebSocket
 * 
 * Enhanced from: lichatoextension-main/mover.user.js (lines 302-441)
 * 
 * This script:
 * 1. Runs in the page's main JavaScript context (world: "MAIN")
 * 2. Intercepts WebSocket connections to Lichess
 * 3. Captures game state messages and extracts lag/ACK data
 * 4. Wraps WebSocket send to prevent duplicate/post-game moves
 * 5. Tracks WebSocket state changes (open/close/error)
 * 6. Sends moves back to Lichess
 * 7. Communicates with content script via CustomEvents
 * 
 * Note: Cannot use ES6 imports in MAIN world, must be vanilla JS
 */

(function() {
    'use strict';
    
    console.log('[Mephisto Page Bridge] Initializing...');
    
    let activeSocket = null;
    let originalWebSocket = null;
    let wsInterceptorEnabled = false;
    
    // Game state tracking (simplified version for page context)
    let gameEnded = false;
    let lastMoveAcked = false;
    let pendingMoveUci = null;
    let currentAck = 0;
    let lastWebSocketState = null;

    /**
     * Reset game state
     */
    function resetGameState() {
        gameEnded = false;
        lastMoveAcked = false;
        pendingMoveUci = null;
        console.log('[Bridge] Game state reset');
    }

    /**
     * Install WebSocket interceptor with enhanced tracking
     */
    function installWebSocketInterceptor() {
        if (wsInterceptorEnabled) return;
        
        originalWebSocket = window.WebSocket;
        
        const webSocketProxy = new Proxy(originalWebSocket, {
            construct(target, args) {
                console.log('[Mephisto] WebSocket intercepted:', args[0]);
                
                const socket = new target(...args);
                activeSocket = socket;

                // Wrap send method to block duplicate/post-game moves
                const originalSend = socket.send.bind(socket);
                socket.send = function(data) {
                    try {
                        const msg = JSON.parse(data);
                        if (msg.t === 'move' && msg.d && msg.d.u) {
                            // Block if game ended
                            if (gameEnded) {
                                console.log(`[Send] ❌ Blocked (game ended): ${msg.d.u}`);
                                return;
                            }
                            // Block duplicate of pending move
                            if (pendingMoveUci === msg.d.u && !lastMoveAcked) {
                                console.log(`[Send] ❌ Blocked (duplicate pending): ${msg.d.u}`);
                                return;
                            }
                            // Track this move
                            pendingMoveUci = msg.d.u;
                            lastMoveAcked = false;
                            console.log(`[Send] ✅ ${msg.d.u} | a: ${msg.d.a} | l: ${msg.d.l}ms`);
                        }
                    } catch (e) {}
                    return originalSend(data);
                };

                // Track WebSocket state changes
                socket.addEventListener('open', () => {
                    console.log('[WebSocket] ✅ Connected');
                    lastWebSocketState = 1;
                    
                    // Notify content script
                    window.dispatchEvent(new CustomEvent('mephisto-ws-state-change', {
                        detail: { state: 'open' }
                    }));
                    
                    // Reset game state on reconnect
                    pendingMoveUci = null;
                });

                socket.addEventListener('close', () => {
                    console.log('[WebSocket] ❌ Disconnected');
                    lastWebSocketState = 3;
                    activeSocket = null;
                    
                    window.dispatchEvent(new CustomEvent('mephisto-ws-state-change', {
                        detail: { state: 'close' }
                    }));
                });

                socket.addEventListener('error', () => {
                    console.log('[WebSocket] ⚠️ Error');
                    
                    window.dispatchEvent(new CustomEvent('mephisto-ws-state-change', {
                        detail: { state: 'error' }
                    }));
                });

                socket.addEventListener('message', (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        
                        // Track ACK - move was accepted
                        if (message.t === 'ack') {
                            lastMoveAcked = true;
                            console.log(`[ACK] Move accepted: ${pendingMoveUci}`);
                            pendingMoveUci = null;
                        }
                        
                        // Track game end
                        if (message.t === 'endData' || (message.d && message.d.status && message.d.winner)) {
                            gameEnded = true;
                            console.log(`[Game] Ended - blocking further moves`);
                        }
                        
                        // Track move confirmations and extract ACK
                        if (message.t === 'move' && message.d) {
                            if (typeof message.d.ply !== 'undefined') {
                                currentAck = message.d.ply;
                            }
                            
                            // Check for game end in move response
                            if (message.d.status || message.d.winner) {
                                gameEnded = true;
                            }
                            
                            // Clear pending after our move is confirmed
                            if (message.d.uci === pendingMoveUci) {
                                pendingMoveUci = null;
                            }
                        }
                        
                        // Handle reload/resync messages
                        if (message.t === 'reload' || message.t === 'resync') {
                            console.log(`[WebSocket] 🔄 ${message.t} received, resetting state`);
                            resetGameState();
                        }
                        
                        // Extract and forward lag data from clock messages
                        if (message.d?.clock?.lag !== undefined) {
                            const lagMs = message.d.clock.lag < 100 ? message.d.clock.lag * 10 : message.d.clock.lag;
                            window.dispatchEvent(new CustomEvent('mephisto-lag-update', {
                                detail: { lag: lagMs }
                            }));
                        }
                        
                        // Forward all WebSocket messages to content script
                        window.dispatchEvent(new CustomEvent('mephisto-ws-message', {
                            detail: message
                        }));
                        
                    } catch (e) {
                        // Non-JSON message, ignore
                    }
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
        resetGameState();
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
                
            case 'reset-game-state':
                resetGameState();
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
