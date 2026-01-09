/**
 * LagManager - WebSocket lag measurement and compensation
 * 
 * Ported from: new move logic to apply/lichessbot/bot.js (lines 34-37)
 * 
 * Original implementation:
 * if (message.d?.clock?.lag !== undefined) { measuredLag = 10000; }
 * 
 * Features:
 * - Fixed lag strategy (always use configured value)
 * - Dynamic lag strategy (use server-reported value)
 * - Max lag strategy (use maximum observed value)
 */
export class LagManager {
    constructor(config = {}) {
        this.defaultLag = config.defaultLag ?? 1000;
        this.maxLag = config.maxLag ?? 10000;
        this.strategy = config.strategy ?? 'fixed'; // 'fixed' | 'dynamic' | 'max'
        
        this.current = this.defaultLag;
        this.history = [];
        this.maxHistorySize = 10;
    }

    /**
     * Update from server-reported lag
     * @param {number} serverLag - Lag value from WebSocket clock data
     */
    updateFromServer(serverLag) {
        this.history.push(serverLag);
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
        
        switch (this.strategy) {
            case 'fixed':
                // Original behavior: always use maxLag
                this.current = this.maxLag;
                break;
            case 'dynamic':
                // Use captured lag value
                this.current = serverLag;
                break;
            case 'max':
                // Use maximum observed lag
                this.current = Math.max(...this.history);
                break;
        }
    }

    /**
     * Get current lag value to use
     * @returns {number} Current lag in milliseconds
     */
    getCurrent() {
        return this.current;
    }

    /**
     * Reset lag tracking
     */
    reset() {
        this.current = this.defaultLag;
        this.history = [];
    }

    /**
     * Update strategy
     * @param {string} strategy - 'fixed' | 'dynamic' | 'max'
     */
    setStrategy(strategy) {
        this.strategy = strategy;
        // Recalculate current lag based on new strategy
        if (this.history.length > 0) {
            this.updateFromServer(this.history[this.history.length - 1]);
        }
    }
}
