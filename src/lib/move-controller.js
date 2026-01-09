/**
 * MoveController - Main orchestrator for automated move analysis and dispatch
 * 
 * Coordinates:
 * - EngineInterface: Chess engine analysis
 * - LagManager: Lag compensation
 * - FenBuilder: FEN construction from WebSocket data
 * - MovePacketFactory: Move packet generation
 * - GameStateTracker: Game state and ACK tracking
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
import { GameStateTracker } from './game-state-tracker.js';

// Lichess WebSocket message types
const MESSAGE_TYPES = {
    GAME_DATA: 'd',
    MOVE: 'move',
    DROP: 'drop',      // Crazyhouse piece drops
    ACK: 'ack',
    END_DATA: 'endData',
    CLOCK: 'clock',
    RELOAD: 'reload',
    RESYNC: 'resync'
};

export class MoveController {
    constructor(config = {}) {
        // Component initialization
        this.lagManager = new LagManager({
            defaultLag: config.defaultLag ?? 1000,
            maxLag: config.maxLag ?? 10000,
            strategy: config.lagStrategy ?? 'smart',
            vpnPingOffset: config.vpnPingOffset ?? 0
        });
        
        this.fenBuilder = new FenBuilder(config.fenMode ?? 'full');
        
        this.movePacketFactory = new MovePacketFactory({
            premoveFlag: config.premoveFlag ?? 1
        });
        
        this.gameStateTracker = new GameStateTracker();
        
        this.engineInterface = null;
        this.config = config;
        this.currentFen = '';
        this.enabled = false;
        
        // Analysis state tracking
        this.isAnalyzing = false;
        this.lastAnalyzedFen = '';
        
        // Watchdog timer for stuck analysis
        this.watchdogTimer = null;
        this.analysisTimeout = config.analysisTimeout ?? 5000;
        this.retryCount = 0;
        this.maxRetries = 3;
        
        // Duplicate move prevention
        this.lastMoveSent = null;
        this.lastMoveSentTime = 0;
        
        // Player info
        this.playerColor = null; // 'w' | 'b' | null (null = play both sides)
        
        // Callbacks
        this.onMoveCalculated = null;
        this.onFenUpdated = null;
        this.onGameEnd = null;
    }

    /**
     * Initialize engine
     * @param {string} engineName - Engine name from registry
     * @param {Object} options - Additional options (e.g., variant)
     */
    async initialize(engineName, options = {}) {
        this.engineInterface = new EngineInterface(engineName);
        await this.engineInterface.initialize();
        
        // Set up engine message handler
        this.engineInterface.onMessage((msg) => {
            this._handleEngineMessage(msg);
        });
        
        // Set variant if provided
        if (options.variant) {
            this.fenBuilder.setVariant(options.variant);
        }
        
        console.log('[MoveController] Initialized with engine:', engineName);
    }

    /**
     * Set player color to determine when to analyze
     * @param {string|null} color - 'w', 'b', or null to play both sides
     */
    setPlayerColor(color) {
        this.playerColor = color;
        console.log('[MoveController] Player color set to:', color || 'both sides');
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
            // 1. Let game state tracker process the message
            const state = this.gameStateTracker.processMessage(message);
            
            // 2. Handle game end
            if (state.isGameEnd) {
                this._cleanup();
                if (this.onGameEnd) {
                    this.onGameEnd();
                }
                return;
            }

            // 3. Capture lag from clock messages
            if (message.d?.clock?.lag !== undefined) {
                this.lagManager.updateFromServer(message.d.clock.lag);
            }

            // 4. Skip if state tracker says not to process
            if (!state.shouldProcess) {
                return;
            }

            // 5. Check for game state messages (move, drop, d)
            const isGameState = [MESSAGE_TYPES.GAME_DATA, MESSAGE_TYPES.MOVE, MESSAGE_TYPES.DROP].includes(message.t) &&
                               message.d?.fen;
            
            if (!isGameState) {
                return;
            }

            // 6. Build FEN and check if position changed
            const fen = this.fenBuilder.build(message);
            if (fen === this.currentFen) {
                return;
            }

            // 7. Clear stale analysis state
            this._clearAnalysisState();
            this.currentFen = fen;
            
            if (this.onFenUpdated) {
                this.onFenUpdated(fen);
            }

            // 8. Calculate if our turn
            if (this._isOurTurn(fen)) {
                await this._calculateMove();
            }
        } catch (error) {
            console.error('[MoveController] Error processing message:', error);
        }
    }

    /**
     * Check if it's our turn to move
     * @param {string} fen - FEN string
     * @returns {boolean} True if it's our turn
     */
    _isOurTurn(fen) {
        const turn = fen.split(' ')[1] || 'w';
        if (!this.playerColor) {
            return true; // Play both sides
        }
        return turn === this.playerColor;
    }

    /**
     * Calculate best move for current position
     */
    async _calculateMove() {
        if (!this.engineInterface || !this.currentFen) {
            return;
        }

        // Prevent duplicate analysis
        if (this.isAnalyzing) {
            console.log('[MoveController] Already analyzing, skipping');
            return;
        }

        // Prevent re-analyzing same position
        if (this.currentFen === this.lastAnalyzedFen) {
            console.log('[MoveController] Position already analyzed, skipping');
            return;
        }

        this.isAnalyzing = true;
        this.lastAnalyzedFen = this.currentFen;
        const fenToAnalyze = this.currentFen;

        console.log('[MoveController] Calculating move for:', fenToAnalyze);
        
        // Set watchdog timer
        this._setWatchdog();

        try {
            const depth = this.config.depth ?? 10;
            const bestMove = await this.engineInterface.analyze(fenToAnalyze, { depth });
            
            // Clear watchdog
            this._clearWatchdog();
            this.retryCount = 0;

            // Verify position hasn't changed
            if (fenToAnalyze !== this.currentFen) {
                console.log('[MoveController] Position changed during analysis, discarding result');
                this.isAnalyzing = false;
                return;
            }

            console.log('[MoveController] Best move:', bestMove);
            
            // Notify move calculated
            if (this.onMoveCalculated && bestMove && bestMove !== '(none)') {
                this.onMoveCalculated(bestMove, fenToAnalyze);
            }
        } catch (error) {
            console.error('[MoveController] Error during analysis:', error);
            this._clearWatchdog();
        } finally {
            this.isAnalyzing = false;
        }
    }

    /**
     * Dispatch move through WebSocket
     * @param {string} move - UCI move (e.g., 'e2e4')
     * @param {Function} sendFunction - Function to send data through WebSocket
     * @returns {boolean} True if sent successfully
     */
    dispatchMove(move, sendFunction) {
        // Check game state
        if (!this.gameStateTracker.canSendMove(move)) {
            return false;
        }

        // Duplicate check (time-based)
        const now = Date.now();
        if (move === this.lastMoveSent && now - this.lastMoveSentTime < 500) {
            console.log('[MoveController] Duplicate move blocked:', move);
            return false;
        }

        this.lastMoveSent = move;
        this.lastMoveSentTime = now;

        // Build packet with ACK
        const lag = this.lagManager.getCurrent();
        const ack = this.gameStateTracker.getAck();
        const packet = this.movePacketFactory.create(move, lag, ack);
        
        console.log('[MoveController] Dispatching move:', move, 'lag:', lag, 'ack:', ack);
        
        if (typeof sendFunction === 'function') {
            sendFunction(packet);
            this.gameStateTracker.markMoveSent(move);
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
     * Set watchdog timer for analysis timeout
     */
    _setWatchdog() {
        this._clearWatchdog();
        this.watchdogTimer = setTimeout(() => {
            console.log('[MoveController] Analysis timeout - watchdog triggered');
            this.isAnalyzing = false;
            this.retryCount++;
            
            // Retry if under limit and still our turn
            if (this.retryCount < this.maxRetries && this._isOurTurn(this.currentFen)) {
                console.log(`[MoveController] Retrying analysis (${this.retryCount}/${this.maxRetries})`);
                setTimeout(() => this._calculateMove(), 100);
            } else {
                console.log('[MoveController] Max retries reached or not our turn');
                this.retryCount = 0;
            }
        }, this.analysisTimeout);
    }

    /**
     * Clear watchdog timer
     */
    _clearWatchdog() {
        if (this.watchdogTimer) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    /**
     * Clear analysis state (when position changes)
     */
    _clearAnalysisState() {
        this.isAnalyzing = false;
        this.lastAnalyzedFen = '';
        this._clearWatchdog();
        this.retryCount = 0;
    }

    /**
     * Cleanup on game end or reset
     */
    _cleanup() {
        this._clearWatchdog();
        this.isAnalyzing = false;
        console.log('[MoveController] Cleanup performed');
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
        this._cleanup();
        this.currentFen = '';
        this.lastAnalyzedFen = '';
        this.lastMoveSent = null;
        this.lastMoveSentTime = 0;
        this.retryCount = 0;
        this.lagManager.reset();
        this.gameStateTracker.reset();
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.engineInterface) {
            this.engineInterface.destroy();
            this.engineInterface = null;
        }
        this._cleanup();
        this.reset();
    }
}
