/**
 * FenBuilder - Construct FEN from Lichess WebSocket data
 * 
 * Ported from:
 * - bot.js (line 46): Simplified FEN
 * - bot1.js (lines 40-67): Full FEN with castling/en passant parsing
 * 
 * Supports two modes:
 * - 'simplified': Basic FEN with placeholder castling/en passant
 * - 'full': Complete FEN with parsed castling rights and en passant square
 */
export class FenBuilder {
    constructor(mode = 'simplified') {
        this.mode = mode; // 'simplified' | 'full'
    }

    /**
     * Build FEN from WebSocket message
     * @param {Object} message - Lichess WebSocket message
     * @returns {string} FEN string
     */
    build(message) {
        if (!message.d || typeof message.d.fen !== 'string') {
            throw new Error('Invalid message: missing fen data');
        }

        const partialFen = message.d.fen;
        const isWhitesTurn = message.d.ply % 2 === 0;
        const turnChar = isWhitesTurn ? 'w' : 'b';

        if (this.mode === 'full') {
            return this._buildFull(partialFen, turnChar, message);
        }
        return this._buildSimplified(partialFen, turnChar);
    }

    /**
     * Simplified FEN (bot.js, bot2.js pattern)
     * Original: currentFen = `${partialFen} ${isWhitesTurn ? 'w' : 'b'} - - 0 1`;
     * 
     * @param {string} partialFen - Board position from Lichess
     * @param {string} turnChar - 'w' or 'b'
     * @returns {string} FEN string
     */
    _buildSimplified(partialFen, turnChar) {
        return `${partialFen} ${turnChar} - - 0 1`;
    }

    /**
     * Full FEN with castling and en passant (bot1.js pattern)
     * 
     * @param {string} partialFen - Board position from Lichess
     * @param {string} turnChar - 'w' or 'b'
     * @param {Object} message - Full WebSocket message
     * @returns {string} FEN string
     */
    _buildFull(partialFen, turnChar, message) {
        // Castling rights (bot1.js lines 42-54)
        let castlingRights = '';
        if (message.d.castle) {
            if (message.d.castle.white) {
                if (message.d.castle.white.king) castlingRights += 'K';
                if (message.d.castle.white.queen) castlingRights += 'Q';
            }
            if (message.d.castle.black) {
                if (message.d.castle.black.king) castlingRights += 'k';
                if (message.d.castle.black.queen) castlingRights += 'q';
            }
        }
        if (castlingRights === '') {
            castlingRights = '-';
        }

        // En passant (bot1.js lines 57-60)
        const enPassantTarget = message.d.enpassant ? message.d.enpassant.square : '-';

        return `${partialFen} ${turnChar} ${castlingRights} ${enPassantTarget} 0 1`;
    }

    /**
     * Set FEN builder mode
     * @param {string} mode - 'simplified' | 'full'
     */
    setMode(mode) {
        if (mode !== 'simplified' && mode !== 'full') {
            throw new Error(`Invalid mode: ${mode}. Must be 'simplified' or 'full'`);
        }
        this.mode = mode;
    }
}
