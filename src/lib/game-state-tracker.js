/**
 * GameStateTracker - Track game state to prevent invalid moves
 * 
 * Features:
 * - ACK tracking for move confirmation
 * - Game end detection
 * - Duplicate move prevention
 * - Game start detection
 * - Position state tracking
 * 
 * Handles Lichess WebSocket message types:
 * - ack: Move acknowledgment
 * - endData: Game ended
 * - move: Regular move
 * - drop: Crazyhouse piece drop
 * - d: Game data (initial position)
 * - reload: Game reload request
 * - resync: Resync game state
 */

const MESSAGE_TYPES = {
    GAME_DATA: 'd',
    MOVE: 'move',
    DROP: 'drop',
    ACK: 'ack',
    END_DATA: 'endData',
    RELOAD: 'reload',
    RESYNC: 'resync'
};

export class GameStateTracker {
    constructor() {
        this.reset();
    }

    /**
     * Reset all game state
     */
    reset() {
        this.gameEnded = false;
        this.lastMoveAcked = false;
        this.pendingMoveUci = null;
        this.currentAck = 0;
        this.isProcessing = false;
        this.gameStarted = false;
        this.initialFenReceived = false;
        this.lastProcessedFen = '';
    }

    /**
     * Process incoming WebSocket message
     * @param {Object} message - WebSocket message
     * @returns {Object} Processed state information
     */
    processMessage(message) {
        const result = {
            isGameEnd: false,
            isMoveAck: false,
            shouldProcess: false,
            fen: null,
            ply: null,
            isGameStart: false
        };

        if (!message || !message.t) {
            return result;
        }

        // Handle ACK messages
        if (message.t === MESSAGE_TYPES.ACK) {
            this.currentAck = message.d?.ack || this.currentAck + 1;
            this.lastMoveAcked = true;
            this.pendingMoveUci = null;
            result.isMoveAck = true;
            return result;
        }

        // Handle game end
        if (message.t === MESSAGE_TYPES.END_DATA) {
            this.gameEnded = true;
            result.isGameEnd = true;
            return result;
        }

        // Handle reload/resync
        if (message.t === MESSAGE_TYPES.RELOAD || message.t === MESSAGE_TYPES.RESYNC) {
            this.reset();
            result.shouldProcess = false;
            return result;
        }

        // Handle game state messages (d, move, drop)
        if ([MESSAGE_TYPES.GAME_DATA, MESSAGE_TYPES.MOVE, MESSAGE_TYPES.DROP].includes(message.t)) {
            if (message.d?.fen) {
                result.fen = message.d.fen;
                result.ply = message.d.ply ?? message.v ?? 0;
                
                // Detect game start
                if (!this.initialFenReceived && message.t === MESSAGE_TYPES.GAME_DATA) {
                    this.initialFenReceived = true;
                    this.gameStarted = true;
                    result.isGameStart = true;
                }

                // Check if position changed
                if (result.fen !== this.lastProcessedFen) {
                    this.lastProcessedFen = result.fen;
                    result.shouldProcess = true;
                }

                // Update ACK from game data
                if (message.d.ack !== undefined) {
                    this.currentAck = message.d.ack;
                }
            }
        }

        return result;
    }

    /**
     * Check if we can send a move
     * @param {string} uci - UCI move string
     * @returns {boolean} True if move can be sent
     */
    canSendMove(uci) {
        // Can't send if game has ended
        if (this.gameEnded) {
            console.log('[GameStateTracker] Cannot send move - game ended');
            return false;
        }

        // Can't send if we have a pending move that hasn't been ACKed
        if (this.pendingMoveUci && !this.lastMoveAcked) {
            console.log('[GameStateTracker] Cannot send move - pending move not ACKed:', this.pendingMoveUci);
            return false;
        }

        // Can't send duplicate of pending move
        if (this.pendingMoveUci === uci) {
            console.log('[GameStateTracker] Cannot send move - duplicate of pending:', uci);
            return false;
        }

        return true;
    }

    /**
     * Mark a move as sent
     * @param {string} uci - UCI move string
     */
    markMoveSent(uci) {
        this.pendingMoveUci = uci;
        this.lastMoveAcked = false;
    }

    /**
     * Get current ACK value
     * @returns {number} Current ACK value
     */
    getAck() {
        return this.currentAck;
    }

    /**
     * Check if game has ended
     * @returns {boolean} True if game ended
     */
    hasGameEnded() {
        return this.gameEnded;
    }

    /**
     * Check if game has started
     * @returns {boolean} True if game started
     */
    hasGameStarted() {
        return this.gameStarted;
    }
}
