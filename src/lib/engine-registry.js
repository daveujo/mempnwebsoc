/**
 * Engine Registry - Configuration for all supported chess engines
 * 
 * Defines 4 architecture patterns:
 * - Pattern A: asm.js single-file (stockfish-6)
 * - Pattern B: Emscripten + WASM Worker (stockfish-16-40)
 * - Pattern C: ES Module + WASM (sf17-79, sf16-7, sfhce, fsf14)
 * - Pattern D: iframe sandbox (lc0)
 */

export const EngineType = {
    ASM_JS_SINGLE: 'asm-js-single',
    EMSCRIPTEN_WASM: 'emscripten-wasm',
    ES_MODULE_WASM: 'es-module-wasm',
    IFRAME_SANDBOX: 'iframe-sandbox',
};

export const ENGINE_REGISTRY = {
    'stockfish-6': {
        type: EngineType.ASM_JS_SINGLE,
        path: 'lib/engine/stockfish-6/',
        files: ['stockfish.js'],
        jsEntry: 'stockfish.js',
        hasNnue: false,
        supportsVariants: false,
        loadMethod: 'web-worker',
        uciMethod: 'postMessage',
    },
    'stockfish-16-nnue-40': {
        type: EngineType.EMSCRIPTEN_WASM,
        path: 'lib/engine/stockfish-16-40/',
        files: ['stockfish.js', 'stockfish.wasm'],
        jsEntry: 'stockfish.js',
        hasNnue: true,
        nnueEmbedded: true,
        supportsVariants: false,
        loadMethod: 'web-worker',
        uciMethod: 'postMessage',
    },
    'stockfish-17-nnue-79': {
        type: EngineType.ES_MODULE_WASM,
        path: 'lib/engine/stockfish-17-79/',
        files: ['sf17-79.js', 'sf17-79.wasm'],
        jsEntry: 'sf17-79.js',
        hasNnue: true,
        nnueEmbedded: false,
        supportsVariants: false,
        loadMethod: 'es-import',
        uciMethod: 'ccall',
    },
    'stockfish-16-nnue-7': {
        type: EngineType.ES_MODULE_WASM,
        path: 'lib/engine/stockfish-16-7/',
        files: ['sf16-7.js', 'sf16-7.wasm'],
        jsEntry: 'sf16-7.js',
        hasNnue: true,
        nnueEmbedded: false,
        supportsVariants: false,
        loadMethod: 'es-import',
        uciMethod: 'ccall',
    },
    'stockfish-11-hce': {
        type: EngineType.ES_MODULE_WASM,
        path: 'lib/engine/stockfish-11-hce/',
        files: ['sfhce.js', 'sfhce.wasm'],
        jsEntry: 'sfhce.js',
        hasNnue: false,
        supportsVariants: false,
        loadMethod: 'es-import',
        uciMethod: 'ccall',
    },
    'fairy-stockfish-14-nnue': {
        type: EngineType.ES_MODULE_WASM,
        path: 'lib/engine/fairy-stockfish-14/',
        files: ['fsf14.js', 'fsf14.wasm'],
        jsEntry: 'fsf14.js',
        hasNnue: true,
        nnueEmbedded: false,
        supportsVariants: true,
        loadMethod: 'es-import',
        uciMethod: 'ccall',
    },
    'lc0': {
        type: EngineType.IFRAME_SANDBOX,
        path: 'lib/engine/lc0/',
        files: ['lc0.html', 'lc0.js', 'lc0.wasm'],
        htmlEntry: 'lc0.html',
        hasNnue: true,
        nnuePath: 'weights/',
        supportsVariants: false,
        loadMethod: 'iframe',
        uciMethod: 'postMessage',
    },
};
