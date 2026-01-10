/**
 * MoveController - Main orchestrator for automated move analysis and dispatch
 * 
 * Coordinates:
 * - EngineInterface: Chess engine analysis
 * - PanicEngine: Ultra-fast panic mode engine
 * - LagManager: Lag compensation
 * - FenBuilder: FEN construction from WebSocket data
 * - MovePacketFactory: Move packet generation
 * - GameStateTracker: Game state and ACK tracking
 * - HumanTiming: Human-like move delays
 * - VariedMoveSelector: Multi-PV varied move selection
 * - WebSocketInterceptor: WebSocket communication (in page context)
 * 
 * Usage:
 * const controller = new MoveController(config);
 * await controller.initialize(engineName);
 * controller.processMessage(wsMessage); // Called from WebSocket interceptor
 */

import { EngineInterface } from './engine-interface.js';
import { PanicEngine } from './panic-engine.js';
import { LagManager } from './lag-manager.js';
import { FenBuilder } from './fen-builder.js';
import { MovePacketFactory } from './move-packet-factory.js';
import { GameStateTracker } from './game-state-tracker.js';
import { HumanTiming } from './human-timing.js';
import { VariedMoveSelector } from './varied-move-selector.js';
import { getPreset } from './config-presets.js';

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
        this.panicEngine = null;
        this.config = config;
        this.currentFen = '';
        this.enabled = false;
        
        // Mode toggles
        this.panicMode = config.panicMode ?? false;
        this.humanMode = config.humanMode ?? false;
        this.variedMode = config.variedMode ?? true;
        
        // Config preset
        this.currentPreset = config.preset ?? '15s';
        this._applyPreset(this.currentPreset);
        
        // Human timing (initialized with preset config)
        this.humanTiming = new HumanTiming(this.activeHumanConfig);
        
        // Varied move selector (initialized with preset config)
        this.variedMoveSelector = new VariedMoveSelector(this.activeVariedConfig);
        
        // Analysis state tracking
        this.isAnalyzing = false;
        this.lastAnalyzedFen = '';
        this.cachedPVs = null;
        this.cachedPVsFen = null;
        
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
     * Apply configuration preset
     * @param {string} presetName - '7.5s', '15s', or '30s'
     */
    _applyPreset(presetName) {
        const preset = getPreset(presetName);
        this.activeEngineMs = preset.engineMs;
        this.activeHumanConfig = preset.human;
        this.activeVariedConfig = preset.varied;
    }

    /**
     * Initialize engine
     * @param {string} engineName - Engine name from registry
     * @param {Object} options - Additional options (e.g., variant, panicEngineFactory)
     */
    async initialize(engineName, options = {}) {
        this.engineInterface = new EngineInterface(engineName);
        await this.engineInterface.initialize();
        
        // Set up engine message handler
        this.engineInterface.onMessage((msg) => {
            this._handleEngineMessage(msg);
        });
        
        // Initialize panic engine if factory provided
        if (options.panicEngineFactory) {
            this.panicEngine = new PanicEngine(options.panicEngineFactory);
            await this.panicEngine.initialize();
        }
        
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
     * Supports panic mode and multi-PV analysis
     */
    async _calculateMove() {
        // Panic mode - use panic engine
        if (this.panicMode && this.panicEngine) {
            console.log('[MoveController] PANIC MODE - using fast engine');
            const panicMove = await this.panicEngine.calculateMove(this.currentFen);
            if (panicMove && this.onMoveCalculated) {
                this.onMoveCalculated(panicMove, this.currentFen);
            }
            return;
        }
        
        if (!this.engineInterface || !this.currentFen) {
            return;
        }

        // Prevent duplicate analysis
        if (this.isAnalyzing) {
            console.log('[MoveController] Already analyzing, skipping');
            return;
        }

        // Use cached PVs if analyzing same position
        if (this.currentFen === this.cachedPVsFen && this.cachedPVs) {
            console.log('[MoveController] Using cached PVs for same position');
            this._selectAndDispatchMove(this.cachedPVs);
            return;
        }

        this.isAnalyzing = true;
        this.lastAnalyzedFen = this.currentFen;
        const fenToAnalyze = this.currentFen;

        console.log('[MoveController] Calculating move for:', fenToAnalyze);
        
        // Set watchdog timer
        this._setWatchdog();

        try {
            // Get multi-PV analysis (4 lines)
            const pvs = await this._getMultiPV(fenToAnalyze);
            
            // Clear watchdog
            this._clearWatchdog();
            this.retryCount = 0;

            // Verify position hasn't changed
            if (fenToAnalyze !== this.currentFen) {
                console.log('[MoveController] Position changed during analysis, discarding result');
                this.isAnalyzing = false;
                return;
            }

            // Cache PVs
            this.cachedPVs = pvs;
            this.cachedPVsFen = fenToAnalyze;

            console.log('[MoveController] Analysis complete:', pvs.length, 'PVs');
            
            // Select and dispatch move
            this._selectAndDispatchMove(pvs);
        } catch (error) {
            console.error('[MoveController] Error during analysis:', error);
            this._clearWatchdog();
        } finally {
            this.isAnalyzing = false;
        }
    }
    
    /**
     * Get multi-PV analysis from engine
     * @param {string} fen - FEN string
     * @returns {Promise<Array>} Array of PV objects
     */
    async _getMultiPV(fen) {
        return new Promise((resolve) => {
            const pvs = new Map();
            let resolved = false;
            const engineTime = this.activeEngineMs || 20;
            
            const handler = (msg) => {
                if (resolved) return;
                
                if (msg.startsWith('info ')) {
                    const pv = this._parseInfoLine(msg);
                    if (pv && pv.firstMove) {
                        pvs.set(pv.multipv, pv);
                    }
                }
                
                if (msg.startsWith('bestmove')) {
                    resolved = true;
                    const arr = [...pvs.entries()]
                        .sort((a, b) => a[0] - b[0])
                        .map(([, v], idx) => ({ ...v, idx }));
                    resolve(arr);
                }
            };
            
            // Set timeout
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    const arr = [...pvs.entries()]
                        .sort((a, b) => a[0] - b[0])
                        .map(([, v], idx) => ({ ...v, idx }));
                    resolve(arr);
                }
            }, Math.max(engineTime * 2, 2000));
            
            // Add temporary message handler
            this.engineInterface.onMessage(handler);
            
            // Send analysis commands
            this.engineInterface.send('stop');
            this.engineInterface.send('setoption name MultiPV value 4');
            this.engineInterface.send(`position fen ${fen}`);
            this.engineInterface.send(`go movetime ${engineTime}`);
        });
    }
    
    /**
     * Parse engine info line to extract PV data
     * @param {string} text - Engine output line
     * @returns {Object|null} PV object or null
     */
    _parseInfoLine(text) {
        if (!text.startsWith('info ')) return null;
        
        const mpv = text.match(/multipv (\d+)/);
        const cp = text.match(/score cp (-?\d+)/);
        const mate = text.match(/score mate (-?\d+)/);
        const pv = text.match(/ pv (.+)$/);
        
        if (!pv) return null;

        let evalCp = null, evalType = 'cp', mateVal = null;
        if (cp) {
            evalCp = parseInt(cp[1], 10);
        } else if (mate) {
            mateVal = parseInt(mate[1], 10);
            evalCp = (mateVal > 0 ? 100000 : -100000) + mateVal;
            evalType = 'mate';
        } else {
            return null;
        }

        return {
            multipv: mpv ? parseInt(mpv[1], 10) : 1,
            evalType,
            evalCp,
            mateVal,
            pv: pv[1].trim(),
            firstMove: pv[1].trim().split(' ')[0]
        };
    }
    
    /**
     * Select best move from PVs and dispatch
     * @param {Array} pvs - Array of PV objects
     */
    _selectAndDispatchMove(pvs) {
        if (!pvs || pvs.length === 0) {
            console.log('[MoveController] No PVs available');
            return;
        }
        
        let selectedMove = null;
        
        // Varied mode - use varied move selector
        if (this.variedMode) {
            const result = this.variedMoveSelector.selectMove(pvs);
            if (result) {
                selectedMove = result.move;
                console.log('[MoveController] Varied mode selected:', selectedMove, 
                           `(PV${result.idx + 1}, eval: ${result.evalCp})`);
            }
        }
        
        // Fallback to best move
        if (!selectedMove && pvs[0]?.firstMove) {
            selectedMove = pvs[0].firstMove;
            console.log('[MoveController] Using best move:', selectedMove);
        }
        
        // Notify move calculated
        if (selectedMove && this.onMoveCalculated) {
            this.onMoveCalculated(selectedMove, this.currentFen);
        }
    }

    /**
     * Dispatch move through WebSocket
     * Supports human timing delays
     * @param {string} move - UCI move (e.g., 'e2e4')
     * @param {Function} sendFunction - Function to send data through WebSocket
     * @param {Function} getPieceAt - Function to get piece at square (for capture detection)
     * @param {number} pieceCount - Current number of pieces on board
     * @returns {boolean} True if sent successfully
     */
    dispatchMove(move, sendFunction, getPieceAt = null, pieceCount = 32) {
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

        // Calculate human delay if human mode enabled
        let delay = 0;
        if (this.humanMode && getPieceAt) {
            delay = this.humanTiming.calculateDelay(move, pieceCount, getPieceAt, this.panicMode);
            console.log('[MoveController] Human delay:', delay, 'ms');
        }

        // Function to actually send the move
        const doSend = () => {
            this.lastMoveSent = move;
            this.lastMoveSentTime = Date.now();

            // Build packet with ACK
            const lag = this.panicMode ? 
                this.lagManager.getPanicLagCompensation() : 
                this.lagManager.getLagCompensation();
            const ack = this.gameStateTracker.getAck();
            const packet = this.movePacketFactory.create(move, lag, ack);
            
            console.log('[MoveController] Dispatching move:', move, 'lag:', lag, 'ack:', ack,
                       this.panicMode ? '[PANIC]' : '');
            
            if (typeof sendFunction === 'function') {
                sendFunction(packet);
                this.gameStateTracker.markMoveSent(move);
                
                // Update timing stats
                if (this.humanMode) {
                    this.humanTiming.updateStats(delay);
                }
                
                return true;
            }
            
            console.warn('[MoveController] No send function provided');
            return false;
        };

        // Apply delay if needed
        if (delay > 0) {
            setTimeout(doSend, delay);
            return true;
        } else {
            return doSend();
        }
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
        
        if (updates.vpnPingOffset !== undefined) {
            this.lagManager.setVpnPingOffset(updates.vpnPingOffset);
        }
        
        if (updates.preset !== undefined) {
            this.applyPreset(updates.preset);
        }
        
        Object.assign(this.config, updates);
    }
    
    /**
     * Toggle panic mode
     * @param {boolean} enabled - Enable/disable panic mode
     */
    setPanicMode(enabled) {
        this.panicMode = enabled;
        console.log('[MoveController] Panic mode:', enabled ? 'ENABLED' : 'DISABLED');
        
        // Reset panic engine state
        if (this.panicEngine) {
            this.panicEngine.reset();
        }
    }
    
    /**
     * Toggle human mode
     * @param {boolean} enabled - Enable/disable human timing
     */
    setHumanMode(enabled) {
        this.humanMode = enabled;
        console.log('[MoveController] Human mode:', enabled ? 'ENABLED' : 'DISABLED');
        
        if (enabled) {
            this.humanTiming.resetStats();
        }
    }
    
    /**
     * Toggle varied mode
     * @param {boolean} enabled - Enable/disable varied move selection
     */
    setVariedMode(enabled) {
        this.variedMode = enabled;
        console.log('[MoveController] Varied mode:', enabled ? 'ENABLED' : 'DISABLED');
    }
    
    /**
     * Apply configuration preset
     * @param {string} presetName - '7.5s', '15s', or '30s'
     */
    applyPreset(presetName) {
        this._applyPreset(presetName);
        this.currentPreset = presetName;
        
        // Update component configs
        this.humanTiming.updateConfig(this.activeHumanConfig);
        this.variedMoveSelector.updateConfig(this.activeVariedConfig);
        
        console.log('[MoveController] Applied preset:', presetName);
    }
    
    /**
     * Get timing statistics
     * @returns {Object} Timing stats
     */
    getTimingStats() {
        return this.humanTiming.getStats();
    }
    
    /**
     * Get variety statistics
     * @returns {Object} Variety stats
     */
    getVarietyStats() {
        return this.variedMoveSelector.getStats();
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
        this.cachedPVs = null;
        this.cachedPVsFen = null;
        this.lagManager.reset();
        this.gameStateTracker.reset();
        this.humanTiming.resetStats();
        this.variedMoveSelector.resetStats();
        
        if (this.panicEngine) {
            this.panicEngine.reset();
        }
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.engineInterface) {
            this.engineInterface.destroy();
            this.engineInterface = null;
        }
        
        if (this.panicEngine) {
            this.panicEngine.destroy();
            this.panicEngine = null;
        }
        
        this._cleanup();
        this.reset();
    }
}
