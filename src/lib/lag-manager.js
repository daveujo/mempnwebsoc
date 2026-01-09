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
 * - Smart lag strategy (average + VPN offset with bounds)
 * - Dynamic lag strategy (use server-reported value)
 * - Max lag strategy (use maximum observed value)
 */
export class LagManager {
    constructor(config = {}) {
        this.defaultLag = config.defaultLag ?? 1000;
        this.maxLag = config.maxLag ?? 10000;
        this.strategy = config.strategy ?? 'smart'; // 'fixed' | 'smart' | 'dynamic' | 'max'
        this.vpnPingOffset = config.vpnPingOffset ?? 0;
        
        this.current = this.defaultLag;
        this.serverLagHistory = [50, 50, 50]; // Default history in ms
        this.maxHistorySize = 5;
    }

    /**
     * Update from server-reported lag
     * @param {number} serverLag - Lag value from WebSocket clock data (centiseconds or milliseconds)
     */
    updateFromServer(serverLag) {
        // Lichess reports lag in centiseconds (5 = 50ms) if value < 100
        // Otherwise it's already in milliseconds
        const lagMs = serverLag < 100 ? serverLag * 10 : serverLag;
        
        this.serverLagHistory.push(lagMs);
        if (this.serverLagHistory.length > this.maxHistorySize) {
            this.serverLagHistory.shift();
        }
        
        this._recalculate();
    }

    /**
     * Get average server lag
     * @returns {number} Average lag in milliseconds
     */
    getAverageServerLag() {
        const sum = this.serverLagHistory.reduce((a, b) => a + b, 0);
        return Math.round(sum / this.serverLagHistory.length);
    }

    /**
     * Recalculate current lag based on strategy
     */
    _recalculate() {
        switch (this.strategy) {
            case 'fixed':
                // Original behavior: always use maxLag
                this.current = this.maxLag;
                break;
            case 'smart':
                // Average server lag + VPN offset, bounded by reasonable limits
                const avg = this.getAverageServerLag();
                const total = avg + this.vpnPingOffset;
                // Bounded: min of (total, max(avg*2, 100ms))
                this.current = Math.min(total, Math.max(avg * 2, 100));
                break;
            case 'dynamic':
                // Use most recent lag value
                const recent = this.serverLagHistory[this.serverLagHistory.length - 1];
                this.current = recent;
                break;
            case 'max':
                // Use maximum observed lag
                this.current = Math.max(...this.serverLagHistory);
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
        this.serverLagHistory = [50, 50, 50];
    }

    /**
     * Update strategy
     * @param {string} strategy - 'fixed' | 'smart' | 'dynamic' | 'max'
     */
    setStrategy(strategy) {
        this.strategy = strategy;
        // Recalculate current lag based on new strategy
        if (this.serverLagHistory.length > 0) {
            this._recalculate();
        }
    }
}
