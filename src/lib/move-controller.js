/**
 * MoveController - Main orchestrator for automated move analysis and dispatch
 * 
 * Coordinates:
 * - EngineInterface: Chess engine analysis
 * - LagManager: Lag compensation
 * - FenBuilder: FEN construction from WebSocket data
 * - MovePacketFactory: Move packet generation
 * - WebSocketInterceptor: WebSocket communication (in page context)
 * 
 * Usage:
 * const controller = new MoveController(config);
 * await controller.initialize(engineName);
 * controller.processMessage(wsMessage); // Called from WebSocket interceptor
 */

import { EngineInterface } from './engine-interface.js';
import { LagManager } from './lag-manager.js';
import { FenBuilder } from './fen-builder.js';
import { MovePacketFactory } from './move-packet-factory.js';

export class MoveController {
    constructor(config = {}) {
        // Component initialization
        this.lagManager = new LagManager({
            defaultLag: config.defaultLag ?? 1000,
            maxLag: config.maxLag ?? 10000,
            strategy: config.lagStrategy ?? 'fixed'
        });
        
        this.fenBuilder = new FenBuilder(config.fenMode ?? 'simplified');
        
        this.movePacketFactory = new MovePacketFactory({
            premoveFlag: config.premoveFlag ?? 1
        });
        
        this.engineInterface = null;
        this.config = config;
        this.currentFen = '';
        this.enabled = false;
        
        // Callbacks
        this.onMoveCalculated = null;
        this.onFenUpdated = null;
    }

    /**
     * Initialize engine
     * @param {string} engineName - Engine name from registry
     */
    async initialize(engineName) {
        this.engineInterface = new EngineInterface(engineName);
        await this.engineInterface.initialize();
        
        // Set up engine message handler
        this.engineInterface.onMessage((msg) => {
            this._handleEngineMessage(msg);
        });
        
        console.log('[MoveController] Initialized with engine:', engineName);
    }

    /**
     * Enable/disable automatic move processing
     * @param {boolean} enabled - Whether to process moves automatically
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log('[MoveController] Automatic moves:', enabled ? 'ENABLED' : 'DISABLED');
    }

    /**
     * Process WebSocket message from Lichess
     * @param {Object} message - WebSocket message
     */
    async processMessage(message) {
        if (!this.enabled || !this.engineInterface) {
            return;
        }

        try {
            // Capture lag if available (from bot.js line 34-37)
            if (message.d?.clock?.lag !== undefined) {
                this.lagManager.updateFromServer(message.d.clock.lag);
            }

            // Check for game state or move updates (from bot.js line 40)
            if ((message.t === 'd' || message.t === 'move') && message.d && typeof message.d.fen === 'string') {
                // Build FEN from message
                const fen = this.fenBuilder.build(message);
                
                if (fen !== this.currentFen) {
                    this.currentFen = fen;
                    console.log('[MoveController] New position:', fen);
                    
                    // Notify FEN update
                    if (this.onFenUpdated) {
                        this.onFenUpdated(fen);
                    }
                    
                    // Calculate best move
                    await this._calculateMove();
                }
            }
        } catch (error) {
            console.error('[MoveController] Error processing message:', error);
        }
    }

    /**
     * Calculate best move for current position
     */
    async _calculateMove() {
        if (!this.engineInterface || !this.currentFen) {
            return;
        }

        console.log('[MoveController] Calculating move for:', this.currentFen);
        
        const depth = this.config.depth ?? 10;
        const bestMove = await this.engineInterface.analyze(this.currentFen, { depth });
        
        console.log('[MoveController] Best move:', bestMove);
        
        // Notify move calculated
        if (this.onMoveCalculated) {
            this.onMoveCalculated(bestMove, this.currentFen);
        }
    }

    /**
     * Dispatch move through WebSocket
     * @param {string} move - UCI move (e.g., 'e2e4')
     * @param {Function} sendFunction - Function to send data through WebSocket
     * @returns {boolean} True if sent successfully
     */
    dispatchMove(move, sendFunction) {
        const lag = this.lagManager.getCurrent();
        const packet = this.movePacketFactory.create(move, lag);
        
        console.log('[MoveController] Dispatching move:', move, 'lag:', lag);
        
        if (typeof sendFunction === 'function') {
            sendFunction(packet);
            return true;
        }
        
        console.warn('[MoveController] No send function provided');
        return false;
    }

    /**
     * Handle engine messages
     */
    _handleEngineMessage(msg) {
        // Can add additional processing here if needed
        // For now, the engine interface handles bestmove extraction
    }

    /**
     * Update configuration
     * @param {Object} updates - Configuration updates
     */
    updateConfig(updates) {
        if (updates.lagStrategy !== undefined) {
            this.lagManager.setStrategy(updates.lagStrategy);
        }
        
        if (updates.fenMode !== undefined) {
            this.fenBuilder.setMode(updates.fenMode);
        }
        
        if (updates.premoveFlag !== undefined) {
            this.movePacketFactory.setPremoveFlag(updates.premoveFlag);
        }
        
        Object.assign(this.config, updates);
    }

    /**
     * Reset controller state
     */
    reset() {
        this.currentFen = '';
        this.lagManager.reset();
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.engineInterface) {
            this.engineInterface.destroy();
            this.engineInterface = null;
        }
        this.reset();
    }
}
