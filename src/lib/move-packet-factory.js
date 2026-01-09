/**
 * MovePacketFactory - Create Lichess WebSocket move packets
 * 
 * Ported from: new move logic to apply/lichessbot/bot.js (lines 80-89)
 * 
 * Original implementation:
 * webSocketWrapper.send(JSON.stringify({
 *     t: "move",
 *     d: { 
 *         u: bestMove,
 *         b: -10, // Premove flag
 *         l: measuredLag
 *     }
 * }));
 * 
 * The 'b' flag indicates premove behavior:
 * - 1: Normal move
 * - -10: Aggressive premove (used in bot.js)
 */
export class MovePacketFactory {
    constructor(config = {}) {
        this.premoveFlag = config.premoveFlag ?? 1; // 1 or -10
    }

    /**
     * Create Lichess move packet
     * @param {string} move - UCI move string (e.g., 'e2e4')
     * @param {number} lag - Lag compensation in milliseconds
     * @param {number} ack - ACK value from last received message (default: 0)
     * @returns {string} JSON move packet
     */
    create(move, lag, ack = 0) {
        return JSON.stringify({
            t: "move",
            d: {
                u: move,              // UCI move (e.g., 'e2e4')
                a: ack,               // ACK from last received message
                b: this.premoveFlag,  // Premove flag (1 or -10)
                l: lag                // Lag compensation (ms)
            }
        });
    }

    /**
     * Set premove flag
     * @param {number} flag - Premove flag (1 for normal, -10 for aggressive)
     */
    setPremoveFlag(flag) {
        this.premoveFlag = flag;
    }
}
