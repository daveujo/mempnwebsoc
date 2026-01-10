/**
 * Config Presets - Time control presets with engine, variation, and human timing settings
 * 
 * Ported from: lichatoextension-main/mover.user.js (lines 456-535)
 * 
 * Three presets optimized for different time controls:
 * - 7.5s: Ultra-fast time control (high blunder rate, instant moves)
 * - 15s: Standard time control (moderate blunders, balanced timing)
 * - 30s: Slow time control (low blunders, more thinking time)
 */

export const CONFIG_PRESETS = {
    '7.5s': {
        engineMs: 12,
        varied: {
            maxCpLoss: 900,          // Allows huge blunders (hanging queen/mate)
            weights: [8, 40, 28, 24],
            maxBlundersPerGame: 50,   // High limit
            blunderThreshold: 100,
            blunderChance: 0.45,      // 45% chance to play the bad move
        },
        human: {
            baseDelayMs: 180,
            maxDelayMs: 600,
            premoveDelayMs: 0,
            premoveMaxMs: 10,
            lowPieceDelayMs: 25,
            lowPieceMaxMs: 120,
            premovePieceThreshold: 12,
            lowPieceThreshold: 22,
            quickMoveChance: 0.35,
            quickMoveMs: 0,
            tankChance: 0.008,
            tankMinMs: 250,
            tankMaxMs: 500,
            randomVariance: 0.25,
        }
    },
    '15s': {
        engineMs: 20,
        varied: {
            maxCpLoss: 300,            // Normal safety
            weights: [10, 45, 23, 22],
            maxBlundersPerGame: 10,
            blunderThreshold: 100,
            blunderChance: 0.16,
        },
        human: {
            baseDelayMs: 250,
            maxDelayMs: 800,
            premoveDelayMs: 0,
            premoveMaxMs: 20,
            lowPieceDelayMs: 30,
            lowPieceMaxMs: 150,
            premovePieceThreshold: 10,
            lowPieceThreshold: 20,
            quickMoveChance: 0.25,
            quickMoveMs: 0,
            tankChance: 0.01,
            tankMinMs: 400,
            tankMaxMs: 600,
            randomVariance: 0.27,
        }
    },
    '30s': {
        engineMs: 60,
        varied: {
            maxCpLoss: 200,            // Strict safety
            weights: [30, 55, 10, 5],
            maxBlundersPerGame: 5,
            blunderThreshold: 100,
            blunderChance: 0.08,
        },
        human: {
            baseDelayMs: 500,
            maxDelayMs: 1200,
            premoveDelayMs: 50,
            premoveMaxMs: 150,
            lowPieceDelayMs: 100,
            lowPieceMaxMs: 500,
            premovePieceThreshold: 8,
            lowPieceThreshold: 16,
            quickMoveChance: 0.20,
            quickMoveMs: 60,
            tankChance: 0.05,
            tankMinMs: 1000,
            tankMaxMs: 2000,
            randomVariance: 0.37,
        }
    }
};

/**
 * Get active preset configuration
 * @param {string} presetName - '7.5s', '15s', or '30s'
 * @returns {Object} Preset configuration object
 */
export function getPreset(presetName) {
    return CONFIG_PRESETS[presetName] || CONFIG_PRESETS['15s'];
}

/**
 * Get list of available preset names
 * @returns {string[]} Array of preset names
 */
export function getPresetNames() {
    return Object.keys(CONFIG_PRESETS);
}
