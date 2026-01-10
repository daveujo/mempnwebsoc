/**
 * VariedMoveSelector - Multi-PV move selection with anti-draw logic and blunders
 * 
 * Ported from: lichatoextension-main/mover.user.js (lines 640-806)
 * 
 * Features:
 * - Multi-PV analysis (4 principal variations)
 * - Anti-draw logic (skip moves leading to 3-fold repetition)
 * - Blunder injection (configurable chance and CP loss threshold)
 * - Weighted random selection among top moves
 * - Statistics tracking (PV distribution, blunder count)
 */

export class VariedMoveSelector {
    constructor(config = {}, chessInstance = null) {
        this.config = config;
        this.chessInstance = chessInstance; // chess.js instance for anti-draw checking
        this.stats = { 
            pv1: 0, 
            pv2: 0, 
            pv3: 0, 
            pv4: 0, 
            blunders: 0 
        };
        this.gameBlunderCount = 0;
    }

    /**
     * Set chess.js instance for anti-draw checking
     * @param {Object} chessInstance - chess.js instance
     */
    setChessInstance(chessInstance) {
        this.chessInstance = chessInstance;
    }

    /**
     * Select a move from principal variations
     * @param {Array} pvs - Array of PV objects with {firstMove, evalCp, evalType, mateVal, idx}
     * @returns {Object|null} Selected move object with {move, evalCp, evalType, idx, isBlunder}
     */
    selectMove(pvs) {
        if (!pvs || pvs.length === 0) return null;

        const valid = [];
        
        // Anti-draw check (requires chess.js instance)
        try {
            if (this.chessInstance) {
                const tempGame = this._cloneChessInstance();
                
                for (let i = 0; i < pvs.length && i < 4; i++) {
                    if (!pvs[i]?.firstMove) continue;

                    const uci = pvs[i].firstMove;

                    // Try move with "Always Queen" promotion
                    const moveResult = tempGame.move({
                        from: uci.substring(0, 2),
                        to: uci.substring(2, 4),
                        promotion: 'q' // Always promote to queen
                    });

                    // If move is valid (legal), check for draw
                    if (moveResult) {
                        const isDraw = tempGame.in_threefold_repetition() || tempGame.in_draw();

                        // Undo immediately to reset for next loop iteration
                        tempGame.undo();

                        if (isDraw) {
                            console.log(`[Anti-Draw] 🚫 Skipping ${uci} (leads to draw/repetition)`);
                            continue; // Skip this move, do not add to valid
                        }

                        // If we get here, it's valid and not a draw
                        valid.push({ ...pvs[i], idx: i });
                    }
                }
            } else {
                // No chess instance - allow all moves
                for (let i = 0; i < pvs.length && i < 4; i++) {
                    if (pvs[i]) valid.push({ ...pvs[i], idx: i });
                }
            }
        } catch (e) {
            console.error("[Anti-Draw] Safety fallback triggered:", e);
            // If checking fails, allow all moves to prevent freeze
            for (let i = 0; i < pvs.length && i < 4; i++) {
                if (pvs[i]) valid.push({ ...pvs[i], idx: i });
            }
        }

        // If ALL moves were draws (forced draw), we must play one
        if (valid.length === 0) {
            console.log('[Anti-Draw] ⚠️ Forced draw detected. Playing best available.');
            for (let i = 0; i < pvs.length && i < 4; i++) {
                if (pvs[i]) valid.push({ ...pvs[i], idx: i });
            }
        }

        if (valid.length === 0) return null;

        const cfg = this.config;
        const topEval = valid[0].evalCp || 0;

        // Blunder Logic
        let allowBlunder = false;
        if (this.gameBlunderCount < cfg.maxBlundersPerGame && 
            topEval > -100 && 
            Math.random() < cfg.blunderChance) {
            allowBlunder = true;
            console.log('[Vary] 🎲 Blunder allowed!');
        }

        const candidates = [];

        for (const pv of valid) {
            const cpLoss = topEval - (pv.evalCp || 0);
            const isBlunder = cpLoss >= cfg.blunderThreshold;

            // Safety: Don't blunder into immediate mate (Mate in 1, 2, or 3)
            if (pv.evalType === 'mate' && pv.mateVal !== null && pv.mateVal < 0 && pv.mateVal >= -3) {
                continue;
            }

            if (cpLoss > cfg.maxCpLoss) {
                if (!allowBlunder) continue;
            }

            let weight = cfg.weights[pv.idx] || 5;
            if (cfg.maxCpLoss < 1000) {
                weight = weight - (cpLoss * 0.1);
            }
            weight = Math.max(weight, 3);

            candidates.push({ ...pv, weight, cpLoss, isBlunder });
        }

        // Final Selection
        if (candidates.length === 0) {
            this.stats.pv1++;
            return { ...valid[0], move: valid[0].firstMove };
        }

        const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
        let rand = Math.random() * totalWeight;
        let selected = candidates[0];

        for (const c of candidates) {
            rand -= c.weight;
            if (rand <= 0) { 
                selected = c; 
                break; 
            }
        }

        // Stats
        if (selected.idx === 0) this.stats.pv1++;
        else if (selected.idx === 1) this.stats.pv2++;
        else if (selected.idx === 2) this.stats.pv3++;
        else this.stats.pv4++;

        if (selected.isBlunder) {
            this.gameBlunderCount++;
            this.stats.blunders++;
            console.log(`[Vary] ⚠️ BLUNDER! (${this.gameBlunderCount}/${cfg.maxBlundersPerGame})`);
        }

        return { ...selected, move: selected.firstMove };
    }

    /**
     * Clone chess.js instance to avoid modifying original
     * @returns {Object} Cloned chess instance
     */
    _cloneChessInstance() {
        if (!this.chessInstance) return null;
        
        // Create new instance and load current game state
        const clone = new this.chessInstance.constructor();
        if (this.chessInstance.pgn) {
            clone.load_pgn(this.chessInstance.pgn());
        }
        return clone;
    }

    /**
     * Get current statistics
     * @returns {Object} Stats object
     */
    getStats() {
        return { 
            ...this.stats, 
            gameBlunderCount: this.gameBlunderCount 
        };
    }

    /**
     * Get PV1 percentage
     * @returns {number} Percentage of PV1 moves played (0-100)
     */
    getPV1Percentage() {
        const total = this.stats.pv1 + this.stats.pv2 + this.stats.pv3 + this.stats.pv4;
        if (total === 0) return 0;
        return Math.round(this.stats.pv1 / total * 100);
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = { 
            pv1: 0, 
            pv2: 0, 
            pv3: 0, 
            pv4: 0, 
            blunders: 0 
        };
        this.gameBlunderCount = 0;
    }

    /**
     * Reset game blunder count (on new game)
     */
    resetGameBlunders() {
        this.gameBlunderCount = 0;
    }

    /**
     * Update configuration
     * @param {Object} newConfig - New configuration object
     */
    updateConfig(newConfig) {
        this.config = newConfig;
    }
}
