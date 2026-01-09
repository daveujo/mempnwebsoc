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
 * 
 * Supports variants:
 * - chess: Standard chess
 * - crazyhouse: Crazyhouse with pocket pieces in FEN
 */
export class FenBuilder {
    constructor(mode = 'full') {
        this.mode = mode; // 'simplified' | 'full'
        this.variant = 'chess'; // 'chess' | 'crazyhouse' | etc.
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
        const ply = message.d.ply ?? message.v ?? 0;
        const isWhitesTurn = ply % 2 === 0;
        const turnChar = isWhitesTurn ? 'w' : 'b';

        if (this.variant === 'crazyhouse') {
            return this._buildCrazyhouse(partialFen, turnChar, message);
        }

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
     * Build Crazyhouse FEN with pocket pieces
     * Format: position[pockets] turn castling enpassant halfmove fullmove
     * 
     * @param {string} partialFen - Board position from Lichess
     * @param {string} turnChar - 'w' or 'b'
     * @param {Object} message - Full WebSocket message
     * @returns {string} FEN string
     */
    _buildCrazyhouse(partialFen, turnChar, message) {
        const pockets = message.d.crazyhouse?.pockets || [{}, {}];
        const whitePocket = this._pocketToString(pockets[0], true);
        const blackPocket = this._pocketToString(pockets[1], false);
        
        // Crazyhouse FEN: position[pockets] turn castling - 0 1
        const positionWithPockets = `${partialFen}[${whitePocket}${blackPocket}]`;
        
        // Castling rights (even in crazyhouse, if variant supports it)
        let castling = '-';
        if (message.d.castle) {
            castling = '';
            if (message.d.castle.white?.king) castling += 'K';
            if (message.d.castle.white?.queen) castling += 'Q';
            if (message.d.castle.black?.king) castling += 'k';
            if (message.d.castle.black?.queen) castling += 'q';
            if (!castling) castling = '-';
        }
        
        return `${positionWithPockets} ${turnChar} ${castling} - 0 1`;
    }

    /**
     * Convert pocket object to FEN pocket string
     * @param {Object} pocket - Pocket pieces {pawn: 2, knight: 1, ...}
     * @param {boolean} isWhite - True for white pieces
     * @returns {string} FEN pocket string (e.g., 'PPNnb')
     */
    _pocketToString(pocket, isWhite) {
        if (!pocket) return '';
        
        const pieceMap = { 
            pawn: 'p', 
            knight: 'n', 
            bishop: 'b', 
            rook: 'r', 
            queen: 'q' 
        };
        
        let result = '';
        for (const [piece, count] of Object.entries(pocket)) {
            const char = pieceMap[piece.toLowerCase()] || piece[0].toLowerCase();
            const pieceChar = isWhite ? char.toUpperCase() : char.toLowerCase();
            result += pieceChar.repeat(count);
        }
        
        return result;
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

    /**
     * Set variant
     * @param {string} variant - Variant name (e.g., 'chess', 'crazyhouse')
     */
    setVariant(variant) {
        this.variant = variant;
    }
}
