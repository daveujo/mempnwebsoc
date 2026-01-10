/**
 * LagManager - WebSocket lag measurement and compensation
 * 
 * Ported from: new move logic to apply/lichessbot/bot.js (lines 34-37)
 * Enhanced from: lichatoextension-main/mover.user.js (lines 22-56)
 * 
 * Original implementation:
 * if (message.d?.clock?.lag !== undefined) { measuredLag = 10000; }
 * 
 * Features:
 * - Fixed lag strategy (always use configured value)
 * - Smart lag strategy (average + VPN offset with bounds)
 * - Dynamic lag strategy (use server-reported value)
 * - Max lag strategy (use maximum observed value)
 * - VPN ping offset support (0, 30, 50, 80, 100, 150ms)
 * - Panic lag compensation (separate calculation for panic mode)
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
     * Set VPN ping offset
     * @param {number} offsetMs - VPN ping offset in milliseconds (0, 30, 50, 80, 100, 150)
     */
    setVpnPingOffset(offsetMs) {
        this.vpnPingOffset = offsetMs;
        this._recalculate();
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
     * Get current lag value to use (for normal moves)
     * @returns {number} Current lag in milliseconds
     */
    getCurrent() {
        return this.current;
    }

    /**
     * Get lag compensation for normal moves
     * Bounded by 2x server average or 100ms minimum
     * @returns {number} Lag compensation in milliseconds
     */
    getLagCompensation() {
        const avgServerLag = this.getAverageServerLag();
        const totalLag = avgServerLag + this.vpnPingOffset;
        const maxReasonable = Math.max(avgServerLag * 2, 100);
        return Math.min(totalLag, maxReasonable);
    }

    /**
     * Get lag compensation for panic mode moves
     * Bounded by 3x server average or 200ms minimum
     * Adds extra 30ms buffer for ultra-fast moves
     * @returns {number} Panic lag compensation in milliseconds
     */
    getPanicLagCompensation() {
        const avgServerLag = this.getAverageServerLag();
        const totalLag = avgServerLag + this.vpnPingOffset + 30; // +30ms buffer
        const maxReasonable = Math.max(avgServerLag * 3, 200);
        return Math.min(totalLag, maxReasonable);
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
