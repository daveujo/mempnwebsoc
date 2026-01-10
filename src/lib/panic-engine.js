/**
 * PanicEngine - Ultra-fast Stockfish at Skill Level 0 for time pressure
 * 
 * Ported from: lichatoextension-main/mover.user.js (lines 87-300)
 * 
 * Features:
 * - Stockfish at Skill Level 0 for ultra-fast depth-1 moves
 * - Watchdog timer with timeout handling (500ms)
 * - Retry mechanism with max retries (3)
 * - Engine reinitialization on failure
 * - Cached position detection to avoid recalculation
 */

export class PanicEngine {
    constructor(stockfishFactory) {
        this.stockfishFactory = stockfishFactory; // Function that returns STOCKFISH instance
        this.engine = null;
        this.ready = false;
        
        // State tracking
        this.calculating = false;
        this.lastRequestTime = 0;
        this.lastFenRequested = null;
        this.bestMove = null;
        
        // Watchdog and retry
        this.watchdogTimer = null;
        this.retryCount = 0;
        this.TIMEOUT_MS = 500;
        this.MAX_RETRIES = 3;
        
        // Callback for when move is ready
        this.onMoveReady = null;
    }

    /**
     * Initialize panic engine
     * @returns {Promise<boolean>} True if initialized successfully
     */
    async initialize() {
        if (this.engine) return true;

        try {
            this.engine = this.stockfishFactory();

            // Configure for Skill Level 0 (weakest, fastest)
            this.engine.postMessage("uci");
            this.engine.postMessage("setoption name Skill Level value 0");
            this.engine.postMessage("setoption name Hash value 16"); // Minimal memory

            // Set up message handler
            this.engine.onmessage = (event) => {
                this._handleMessage(event);
            };

            this.ready = true;
            console.log('[Panic Engine] ✅ Initialized (Skill Level 0)');
            return true;
        } catch (e) {
            console.error('[Panic Engine] ❌ Failed to initialize:', e);
            this.ready = false;
            return false;
        }
    }

    /**
     * Calculate move for position
     * @param {string} fen - FEN string
     * @returns {Promise<string|null>} Best move in UCI format or null
     */
    async calculateMove(fen) {
        // Guard: Don't start new calculation if engine is busy
        if (this.calculating) {
            const elapsed = Date.now() - this.lastRequestTime;
            if (elapsed < this.TIMEOUT_MS) {
                console.log(`[⚡ PANIC] ⏳ Engine busy (${elapsed}ms), waiting...`);
                return null;
            } else {
                // Engine seems stuck, force reset
                console.log(`[⚡ PANIC] ⚠️ Engine stuck for ${elapsed}ms, forcing reset`);
                this.calculating = false;
            }
        }

        // Guard: Use cached move for same position
        if (fen === this.lastFenRequested && this.bestMove) {
            console.log(`[⚡ PANIC] ♻️ Using cached move for same position: ${this.bestMove}`);
            return this.bestMove;
        }

        // Initialize if not ready
        if (!this.engine || !this.ready) {
            await this.initialize();
            if (!this.ready) {
                return null;
            }
        }

        // Mark engine as busy and set watchdog
        this.calculating = true;
        this.lastRequestTime = Date.now();
        this.lastFenRequested = fen;
        this.bestMove = null; // Clear old move

        // Set watchdog timer to handle timeout
        this._setWatchdog();

        // Return promise that resolves when move is ready
        return new Promise((resolve) => {
            // Store resolver to call when move is ready
            this._moveResolver = resolve;

            try {
                this.engine.postMessage("stop"); // Stop any ongoing calculation
                this.engine.postMessage("position fen " + fen);
                this.engine.postMessage("go depth 1"); // Ultra-fast depth 1
                console.log(`[⚡ PANIC] 🔍 Calculating: ${fen.split(' ')[0].substring(0, 20)}...`);
            } catch (e) {
                console.error('[⚡ PANIC] ❌ Engine error:', e);
                this.calculating = false;
                this._clearWatchdog();
                this._reinitialize();
                resolve(null);
            }
        });
    }

    /**
     * Handle engine message
     */
    _handleMessage(event) {
        const msg = (typeof event === 'string') ? event : event.data || '';
        
        if (msg.includes("bestmove")) {
            this.bestMove = msg.split(" ")[1];
            this.calculating = false;
            this.retryCount = 0;

            // Clear watchdog timer
            this._clearWatchdog();

            console.log(`[⚡ PANIC] ✅ Move ready: ${this.bestMove}`);

            // Resolve promise if waiting
            if (this._moveResolver) {
                this._moveResolver(this.bestMove);
                this._moveResolver = null;
            }

            // Call callback if set
            if (this.onMoveReady) {
                this.onMoveReady(this.bestMove);
            }
        }
    }

    /**
     * Set watchdog timer
     */
    _setWatchdog() {
        this._clearWatchdog();
        this.watchdogTimer = setTimeout(() => {
            this._handleTimeout();
        }, this.TIMEOUT_MS);
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
     * Handle timeout
     */
    _handleTimeout() {
        console.log(`[⚡ PANIC] ⚠️ Engine timeout after ${this.TIMEOUT_MS}ms`);
        this.calculating = false;
        this.retryCount++;

        if (this.retryCount >= this.MAX_RETRIES) {
            console.log(`[⚡ PANIC] ❌ Max retries (${this.MAX_RETRIES}) reached, reinitializing engine`);
            this._reinitialize();
            this.retryCount = 0;
        }

        // Resolve with null if waiting
        if (this._moveResolver) {
            this._moveResolver(null);
            this._moveResolver = null;
        }
    }

    /**
     * Reinitialize panic engine
     */
    _reinitialize() {
        console.log('[Panic Engine] 🔄 Reinitializing...');
        this.engine = null;
        this.ready = false;
        this.calculating = false;
        this.retryCount = 0;
        this.initialize();
    }

    /**
     * Check if engine is ready
     * @returns {boolean} True if ready
     */
    isReady() {
        return this.ready && !this.calculating;
    }

    /**
     * Check if engine is calculating
     * @returns {boolean} True if calculating
     */
    isCalculating() {
        return this.calculating;
    }

    /**
     * Reset state (on new game or reconnect)
     */
    reset() {
        this.calculating = false;
        this.lastRequestTime = 0;
        this.lastFenRequested = null;
        this.bestMove = null;
        this._clearWatchdog();
        this.retryCount = 0;
        console.log('[Panic Engine] 🔄 State reset');
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this._clearWatchdog();
        if (this.engine && this.engine.terminate) {
            this.engine.terminate();
        }
        this.engine = null;
        this.ready = false;
    }
}
