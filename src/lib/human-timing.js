/**
 * HumanTiming - Calculate human-like move delays
 * 
 * Ported from: lichatoextension-main/mover.user.js (lines 809-860, 862-866)
 * 
 * Features:
 * - Base delay with random variance
 * - Instant captures (0 delay)
 * - Premove mode (low piece count < threshold)
 * - Quick move chance (random instant moves)
 * - Tank chance (random thinking delays)
 * - Auto-adjust based on average move time
 */

export class HumanTiming {
    constructor(config = {}) {
        this.config = config;
        this.stats = { 
            totalMoves: 0, 
            totalTimeMs: 0, 
            engineTimeMs: 0 
        };
    }

    /**
     * Calculate human-like delay for a move
     * @param {string} uci - UCI move string (e.g., 'e2e4')
     * @param {number} pieceCount - Current number of pieces on board
     * @param {Function} getPieceAt - Function to get piece at square (square => piece|null)
     * @param {boolean} panicMode - Whether panic mode is enabled (instant moves)
     * @returns {number} Delay in milliseconds
     */
    calculateDelay(uci, pieceCount, getPieceAt, panicMode = false) {
        const cfg = this.config;

        // PANIC MODE - instant moves
        if (panicMode) {
            return 0;
        }

        // CAPTURES - always instant
        if (uci && uci.length >= 4) {
            const targetSquare = uci.substring(2, 4);
            const targetPiece = getPieceAt(targetSquare);
            if (targetPiece) {
                return 0;
            }
        }

        // Premove mode (very low piece count)
        if (pieceCount <= cfg.premovePieceThreshold) {
            const delay = cfg.premoveDelayMs + Math.random() * (cfg.premoveMaxMs - cfg.premoveDelayMs);
            return Math.max(0, Math.round(delay));
        }

        // Low piece mode (endgame)
        if (pieceCount <= cfg.lowPieceThreshold) {
            const delay = cfg.lowPieceDelayMs + Math.random() * (cfg.lowPieceMaxMs - cfg.lowPieceDelayMs);
            return Math.max(0, Math.round(delay));
        }

        // Normal mode
        let delay = cfg.baseDelayMs;
        delay *= (1 + (Math.random() * 2 - 1) * cfg.randomVariance);

        const roll = Math.random();
        if (roll < cfg.quickMoveChance) {
            // Quick move
            delay = cfg.quickMoveMs + Math.random() * 50;
        } else if (roll < cfg.quickMoveChance + cfg.tankChance) {
            // Tank (long think)
            delay = cfg.tankMinMs + Math.random() * (cfg.tankMaxMs - cfg.tankMinMs);
        }

        delay = Math.max(0, Math.min(delay, cfg.maxDelayMs));

        // Auto-adjust based on average move time
        if (this.stats.totalMoves > 5) {
            const avg = (this.stats.totalTimeMs + this.stats.engineTimeMs) / this.stats.totalMoves;
            if (avg > 580) {
                delay *= Math.max(0.5, 580 / avg);
            }
        }

        return Math.round(delay);
    }

    /**
     * Update timing statistics
     * @param {number} delayMs - Delay used for this move
     * @param {number} engineMs - Engine analysis time
     */
    updateStats(delayMs, engineMs = 0) {
        this.stats.totalMoves++;
        this.stats.totalTimeMs += delayMs;
        this.stats.engineTimeMs += engineMs;
    }

    /**
     * Get current statistics
     * @returns {Object} Stats object
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Get average move time
     * @returns {number} Average time in milliseconds
     */
    getAverageMoveTime() {
        if (this.stats.totalMoves === 0) return 0;
        return Math.round((this.stats.totalTimeMs + this.stats.engineTimeMs) / this.stats.totalMoves);
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = { 
            totalMoves: 0, 
            totalTimeMs: 0, 
            engineTimeMs: 0 
        };
    }

    /**
     * Update configuration
     * @param {Object} newConfig - New configuration object
     */
    updateConfig(newConfig) {
        this.config = newConfig;
    }
}
