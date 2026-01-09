specification sheet:

---

# 🏛️ Architecture Specification Sheet (Revised v3)
## Migrating New Move Logic to Mephisto Engine Architecture

---

## 1. Executive Summary

| Aspect | OLD:  Lichess Bot Move Logic | NEW: Mephisto System |
|--------|----------------------------|----------------------|
| **Source Engine** | `stockfish.js` (single-file Emscripten asm.js) | Multiple engines with different architectures |
| **Engine Pattern** | `window. STOCKFISH()` factory, `"use asm"` | ES Modules, Web Workers, WASM, hybrid patterns |
| **WebSocket** | Direct page-context interception | Content script + message passing |
| **Lag Handling** | Internal (captured from WS messages) | Configurable via popup settings |
| **File Structure** | Single `.js` file (~3MB asm.js) | `.js` + `.wasm` or single `.js` (varies) |

---

## 2. Complete Engine Inventory

### 2.1 Old Move Logic Engine (Reference Implementation)

```
new move logic to apply/lichessbot/
├── stockfish. js    # ~3.2MB - Single-file Emscripten asm.js
├── bot.js          # Move logic with dynamic lag capture
├── bot1.js         # Move logic with full FEN (castling/en passant)
└── bot2.js         # Move logic with simplified FEN
```

**Old Engine Pattern (`stockfish.js`):**
```javascript
// Emscripten asm.js single-file pattern
window.STOCKFISH = (function() {
    function load_stockfish(console) {
        // Browser detection for asm.js compatibility
        if (typeof navigator !== "undefined" && 
            (/MSIE|Trident|Edge/i.test(navigator.userAgent) || 
             /Safari/i.test(navigator.userAgent) && !/Chrome|CriOS/... ))
        // ... 
    }
    
    var asm = (function(global, env, buffer) {
        "use asm";  // asm.js directive
        var a = new global.Int8Array(buffer);
        var b = new global.Int16Array(buffer);
        // ...  typed array views
        
        // EMSCRIPTEN_START_FUNCS
        function Rm(b,e,f,g,h,j) { /* ... */ }
        // EMSCRIPTEN_END_FUNCS
    });
    
    // Module pattern
    var _uci_command = Module["_uci_command"] = asm["_uci_command"];
});
```

**Old Move Logic Usage (`bot.js`):**
```javascript
function initializeChessEngine() {
    chessEngine = window.STOCKFISH();  // Factory call
    setupChessEngineOnMessage();
}

chessEngine.postMessage("position fen " + currentFen);
chessEngine.postMessage("go depth 10");

chessEngine.onmessage = function(event) {
    if (typeof event === 'string' && event.includes("bestmove")) {
        bestMove = event.split(" ")[1];
    }
};
```

---

### 2.2 Mephisto Engine Directory (`lib/engine/`)

| Engine | Files | Size | Architecture | NNUE | Variants |
|--------|-------|------|--------------|------|----------|
| **stockfish-6** | `stockfish.js` | 3.2MB | Emscripten asm.js (single file) | ❌ | ❌ |
| **stockfish-11-hce** | `sfhce.js` + `sfhce.wasm` | 14KB + 388KB | ES Module + WASM | ❌ HCE | ❌ |
| **stockfish-16-40** | `stockfish.js` + `stockfish.wasm` | 41KB + 708KB | Emscripten + WASM (Worker) | ✅ Embedded | ❌ |
| **stockfish-16-7** | `sf16-7.js` + `sf16-7.wasm` | 14KB + 442KB | ES Module + WASM | ✅ External | ❌ |
| **stockfish-17-79** | `sf17-79.js` + `sf17-79.wasm` | 14KB + 472KB | ES Module + WASM | ✅ External | ❌ |
| **fairy-stockfish-14** | `fsf14.js` + `fsf14.wasm` | 14KB + 824KB | ES Module + WASM | ✅ External | ✅ |
| **lc0** | `lc0.html` + `lc0.js` + `lc0.wasm` + `lib/` | 273KB + 655KB | Emscripten iframe sandbox | ✅ NN Weights | ❌ |

---

## 3. Engine Architecture Patterns

### 3.1 Pattern A: Emscripten asm.js (Legacy Single-File)

**Examples:** `stockfish-6/stockfish. js`, old `lichessbot/stockfish.js`

```javascript
// Pattern:  Global factory function with asm.js
window.STOCKFISH = (function() {
    var asm = (function(global, env, buffer) {
        "use asm";
        // Typed array views
        var a = new global. Int8Array(buffer);
        // ... compiled C++ as asm.js
    });
    
    return function() {
        // Returns engine instance with postMessage/onmessage
        return {
            postMessage:  function(cmd) { /* UCI command */ },
            onmessage:  null  // Set by caller
        };
    };
})();
```

**Usage:**
```javascript
const engine = window. STOCKFISH();
engine.onmessage = (msg) => console.log(msg);
engine.postMessage("uci");
```

---

### 3.2 Pattern B:  Emscripten + WASM (Worker-Based)

**Examples:** `stockfish-16-40/stockfish.js`

```javascript
/*!
 * Stockfish.js 16 (c) 2023, Chess. com, LLC
 * https://github.com/nmrugg/stockfish.js
 */
!function() {
    var e, n, t, r, a;
    function i() {
        function e(e) {
            // Module pattern with WASM loading
            i.ready = new Promise(function(e, t) { /* ... */ });
            // XMLHttpRequest polyfill for Node.js
            // WebAssembly. instantiate() for WASM
        }
    }
}();
```

**Usage (as Web Worker):**
```javascript
const worker = new Worker('lib/engine/stockfish-16-40/stockfish.js');
worker.onmessage = (e) => console.log(e.data);
worker.postMessage("uci");
```

---

### 3.3 Pattern C: Modern ES Module + WASM

**Examples:** `stockfish-17-79/sf17-79.js`, `stockfish-16-7/sf16-7.js`, `stockfish-11-hce/sfhce.js`, `fairy-stockfish-14/fsf14.js`

```javascript
// sf17-79.js - ES Module with WASM
var Sf1779Web = (() => {
    var _scriptName = import.meta.url;
    
    return (function(moduleArg = {}) {
        var moduleRtn;
        
        // Heap views
        function aa() { h.buffer != k.buffer && l(); return k; }
        
        // NNUE support
        r.getRecommendedNnue = (a = 0) => ka(la(a));
        r.setNnueBuffer = function(a, b = 0) {
            if (! a) throw Error("buf is null");
            // ...
        };
        
        // WebAssembly loading
        function Na(a, b) {
            return "function" != typeof WebAssembly.instantiateStreaming || 
                   Ja(c) || "function" != typeof fetch
                ? Ma(c, a, b)
                : fetch(c, {credentials: "same-origin"})
                    .then(d => WebAssembly.instantiateStreaming(d, a));
        }
        
        // UCI interface
        var oa = r._uci = a => (oa = r._uci = Y. H)(a);
        
        // SharedArrayBuffer for threading
        if (r.wasmMemory) h = r.wasmMemory;
        else if (h = new WebAssembly.Memory({
            initial: 1024, 
            maximum: 32768, 
            shared: true
        })) // ... 
        
        return moduleRtn;
    });
})();

export default Sf1779Web;

// pthread support
var isPthread = globalThis. self?.name === 'em-pthread';
isPthread && Sf1779Web();
```

**Usage:**
```javascript
import Sf1779Web from './sf17-79.js';

const engine = await Sf1779Web();

// Load NNUE weights
const nnueName = engine.getRecommendedNnue(0);
const nnueBuffer = await fetch(nnueName).then(r => r.arrayBuffer());
engine.setNnueBuffer(new Uint8Array(nnueBuffer), nnueName);

// UCI via ccall
engine.ccall('uci', 'number', ['string'], ['position startpos'], { async: true });
```

---

### 3.4 Pattern D: Emscripten iframe Sandbox (LC0)

**Examples:** `lc0/lc0.html` + `lc0.js` + `lc0.wasm`

```html
<!-- lc0.html - iframe sandbox -->
<!DOCTYPE html>
<script src="lc0.js"></script>
<script>
    // Runs inside iframe for memory isolation
    // Communicates via window.postMessage
</script>
```

```javascript
// lc0.js - Emscripten with integrateWasmJS()
function integrateWasmJS() {
    var wasmBinaryFile = "lc0.wasm";
    
    Module["asm"] = (function(global, env, providedBuffer) {
        env["table"] = new WebAssembly.Table({... });
        exports = doNativeWasm(global, env, providedBuffer);
        return exports;
    });
}
integrateWasmJS();
```

**Usage:**
```javascript
const iframe = document.createElement('iframe');
iframe.src = 'lib/engine/lc0/lc0.html';
document.body.appendChild(iframe);

// Send commands via postMessage
iframe.contentWindow.postMessage({ type: 'uci', command: 'go depth 10' }, '*');

// Receive responses
window.onmessage = (e) => {
    if (e. source === iframe.contentWindow) {
        console.log(e.data);
    }
};

// Load neural network weights
const weights = await fetch('lib/engine/lc0/lib/weights_32195.dat. gz')
    .then(r => r.arrayBuffer());
iframe.contentWindow.postMessage({ 
    type: 'weights', 
    data: { name: 'weights_32195.dat. gz', weights } 
}, '*');
```

---

## 4. Unified Engine Interface Design

### 4.1 Engine Type Enum

```javascript
export const EngineType = {
    ASM_JS_SINGLE:     'asm-js-single',      // stockfish-6, old lichessbot/stockfish.js
    EMSCRIPTEN_WASM:   'emscripten-wasm',    // stockfish-16-40
    ES_MODULE_WASM:   'es-module-wasm',     // sf17-79, sf16-7, sfhce, fsf14
    IFRAME_SANDBOX:   'iframe-sandbox',     // lc0
    EXTERNAL_NEW:     'external-new',       // Future:  new lichessbot/stockfish.js
};
```

### 4.2 Engine Configuration Registry

```javascript
export const ENGINE_REGISTRY = {
    // Pattern A: Legacy asm.js single-file
    'stockfish-6':  {
        type:  EngineType. ASM_JS_SINGLE,
        path: 'lib/engine/stockfish-6/stockfish.js',
        files: ['stockfish. js'],
        hasNnue: false,
        supportsVariants: false,
        loadMethod: 'global-factory',  // window.STOCKFISH()
        uciMethod: 'postMessage',
    },
    
    // Pattern A (External): Old lichessbot engine
    'lichessbot-stockfish': {
        type: EngineType.ASM_JS_SINGLE,
        path: 'new move logic to apply/lichessbot/stockfish.js',
        files: ['stockfish.js'],
        hasNnue: false,
        supportsVariants: false,
        loadMethod: 'global-factory',
        uciMethod:  'postMessage',
    },
    
    // Pattern B:  Emscripten + WASM Worker
    'stockfish-16-nnue-40': {
        type: EngineType.EMSCRIPTEN_WASM,
        path:  'lib/engine/stockfish-16-40/',
        files: ['stockfish.js', 'stockfish. wasm'],
        hasNnue:  true,
        nnueEmbedded: true,  // NNUE weights built into WASM
        supportsVariants: false,
        loadMethod: 'web-worker',
        uciMethod: 'postMessage',
    },
    
    // Pattern C:  Modern ES Module + WASM
    'stockfish-17-nnue-79':  {
        type:  EngineType. ES_MODULE_WASM,
        path: 'lib/engine/stockfish-17-79/',
        files: ['sf17-79.js', 'sf17-79.wasm'],
        jsEntry: 'sf17-79.js',
        hasNnue: true,
        nnueEmbedded: false,  // Requires external NNUE loading
        supportsVariants: false,
        loadMethod: 'es-import',  // await import() + factory()
        uciMethod: 'ccall',
    },
    
    'stockfish-16-nnue-7':  {
        type:  EngineType. ES_MODULE_WASM,
        path: 'lib/engine/stockfish-16-7/',
        files: ['sf16-7.js', 'sf16-7.wasm'],
        jsEntry: 'sf16-7.js',
        hasNnue: true,
        nnueEmbedded: false,
        supportsVariants: false,
        loadMethod:  'es-import',
        uciMethod: 'ccall',
    },
    
    'stockfish-11-hce':  {
        type:  EngineType. ES_MODULE_WASM,
        path: 'lib/engine/stockfish-11-hce/',
        files: ['sfhce.js', 'sfhce.wasm'],
        jsEntry:  'sfhce.js',
        hasNnue:  false,  // HCE = Hand-Crafted Evaluation
        supportsVariants: false,
        loadMethod: 'es-import',
        uciMethod: 'ccall',
    },
    
    'fairy-stockfish-14-nnue': {
        type: EngineType.ES_MODULE_WASM,
        path:  'lib/engine/fairy-stockfish-14/',
        files: ['fsf14.js', 'fsf14.wasm'],
        jsEntry: 'fsf14.js',
        hasNnue: true,
        nnueEmbedded:  false,
        supportsVariants: true,  // Supports chess variants! 
        loadMethod:  'es-import',
        uciMethod: 'ccall',
    },
    
    // Pattern D: iframe sandbox
    'lc0': {
        type: EngineType.IFRAME_SANDBOX,
        path: 'lib/engine/lc0/',
        files: ['lc0.html', 'lc0.js', 'lc0.wasm'],
        htmlEntry: 'lc0.html',
        hasNnue: true,
        nnuePath: 'lib/engine/lc0/lib/weights/',
        supportsVariants: false,
        loadMethod: 'iframe',
        uciMethod: 'postMessage',
    },
};
```

---

### 4.3 Unified Engine Interface Implementation

```javascript
/**
 * EngineInterface - Unified wrapper for all engine architectures
 * 
 * Supports:
 * - Pattern A:  Emscripten asm.js single-file (stockfish-6, lichessbot)
 * - Pattern B: Emscripten + WASM Worker (stockfish-16-40)
 * - Pattern C: ES Module + WASM (sf17-79, sf16-7, sfhce, fsf14)
 * - Pattern D: iframe sandbox (lc0)
 */
export class EngineInterface {
    constructor(engineName) {
        this. engineName = engineName;
        this. config = ENGINE_REGISTRY[engineName];
        if (!this.config) {
            throw new Error(`Unknown engine: ${engineName}`);
        }
        
        this.engine = null;
        this. ready = false;
        this.messageHandlers = [];
        this.pendingAnalysis = null;
    }

    /**
     * Initialize engine based on its architecture type
     */
    async initialize() {
        const basePath = chrome.runtime.getURL(this.config.path);
        
        switch (this.config. type) {
            case EngineType.ASM_JS_SINGLE: 
                await this._initAsmJsSingle(basePath);
                break;
                
            case EngineType.EMSCRIPTEN_WASM:
                await this._initEmscriptenWasm(basePath);
                break;
                
            case EngineType.ES_MODULE_WASM:
                await this._initEsModuleWasm(basePath);
                break;
                
            case EngineType.IFRAME_SANDBOX: 
                await this._initIframeSandbox(basePath);
                break;
        }
        
        this.ready = true;
    }

    /**
     * Pattern A: asm.js single-file (window.STOCKFISH factory)
     */
    async _initAsmJsSingle(basePath) {
        // Inject script into page context to access window.STOCKFISH
        const scriptUrl = `${basePath}${this.config.files[0]}`;
        
        // For extension popup, load as script
        await new Promise((resolve, reject) => {
            const script = document. createElement('script');
            script.src = scriptUrl;
            script.onload = resolve;
            script. onerror = reject;
            document. head.appendChild(script);
        });
        
        // Call factory function
        this.engine = window. STOCKFISH();
        this.engine. onmessage = (msg) => this._handleMessage(msg);
    }

    /**
     * Pattern B:  Emscripten + WASM (Web Worker)
     */
    async _initEmscriptenWasm(basePath) {
        const workerUrl = `${basePath}stockfish. js`;
        this.engine = new Worker(workerUrl);
        this.engine.onmessage = (e) => this._handleMessage(e. data);
    }

    /**
     * Pattern C: ES Module + WASM (modern engines)
     */
    async _initEsModuleWasm(basePath) {
        const moduleUrl = `${basePath}${this.config.jsEntry}`;
        const module = await import(moduleUrl);
        this.engine = await module.default();
        
        // Set up message listener if available
        if (this.engine.addMessageListener) {
            this.engine. addMessageListener((msg) => this._handleMessage(msg));
        }
        
        // Load NNUE weights if needed
        if (this.config.hasNnue && ! this.config.nnueEmbedded) {
            await this._loadNnueWeights(basePath);
        }
    }

    /**
     * Pattern D: iframe sandbox (lc0)
     */
    async _initIframeSandbox(basePath) {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = `${basePath}${this.config.htmlEntry}`;
        document.body.appendChild(iframe);
        
        this._iframe = iframe;
        
        // Wait for iframe to load
        await new Promise((resolve) => {
            iframe.onload = resolve;
        });
        
        // Set up postMessage communication
        this. engine = {
            postMessage:  (msg) => iframe.contentWindow.postMessage(msg, '*')
        };
        
        window.addEventListener('message', (e) => {
            if (e.source === iframe.contentWindow) {
                this._handleMessage(e.data);
            }
        });
        
        // Load neural network weights
        await this._loadLc0Weights(basePath);
    }

    /**
     * Load NNUE weights for ES Module engines
     */
    async _loadNnueWeights(basePath) {
        const nnues = [];
        for (let i = 0; ; i++) {
            const nnue = this.engine.getRecommendedNnue(i);
            if (!nnue || nnues.includes(nnue)) break;
            nnues.push(nnue);
        }
        
        for (const nnueName of nnues) {
            const response = await fetch(`${basePath}${nnueName}`);
            const buffer = await response.arrayBuffer();
            this.engine.setNnueBuffer(new Uint8Array(buffer), nnueName);
        }
    }

    /**
     * Load LC0 neural network weights
     */
    async _loadLc0Weights(basePath) {
        const weightsPath = `${basePath}lib/weights_32195.dat.gz`;
        const weights = await fetch(weightsPath).then(r => r.arrayBuffer());
        
        this.engine.postMessage({
            type: 'weights',
            data: { name: 'weights_32195.dat.gz', weights }
        });
        
        // Wait for weights to load
        await new Promise(r => setTimeout(r, 1000));
    }

    /**
     * Send UCI command to engine (unified interface)
     */
    send(command) {
        switch (this.config. uciMethod) {
            case 'postMessage':
                this.engine.postMessage(command);
                break;
                
            case 'ccall':
                this.engine.ccall('uci', 'number', ['string'], [command], { async: true });
                break;
        }
    }

    /**
     * Analyze position and return best move
     */
    async analyze(fen, options = { depth: 10 }) {
        return new Promise((resolve) => {
            this.pendingAnalysis = resolve;
            
            this.send(`position fen ${fen}`);
            
            if (options.depth) {
                this. send(`go depth ${options.depth}`);
            } else if (options.movetime) {
                this.send(`go movetime ${options.movetime}`);
            }
        });
    }

    /**
     * Handle engine output messages
     */
    _handleMessage(data) {
        const msg = typeof data === 'string' ? data : data.toString();
        
        // Notify all handlers
        for (const handler of this.messageHandlers) {
            handler(msg);
        }
        
        // Check for bestmove (analysis complete)
        if (msg.includes('bestmove') && this.pendingAnalysis) {
            const bestMove = msg. split(' ')[1];
            this.pendingAnalysis(bestMove);
            this.pendingAnalysis = null;
        }
    }

    /**
     * Add message handler
     */
    onMessage(handler) {
        this.messageHandlers.push(handler);
    }

    /**
     * Wait for engine to be ready
     */
    async waitReady() {
        while (!this.ready) {
            await new Promise(r => setTimeout(r, 50));
        }
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this._iframe) {
            this._iframe.remove();
        }
        if (this.engine?. terminate) {
            this.engine.terminate();
        }
    }
}
```

---

## 5. Move Logic Components (From lichessbot/)

### 5.1 Component Overview

| Component | Source | Purpose |
|-----------|--------|---------|
| `LagManager` | `bot.js: 34-37` | Capture/manage WebSocket lag compensation |
| `FenBuilder` | `bot1.js:40-67`, `bot2.js:39` | Construct FEN from partial Lichess data |
| `MovePacketFactory` | `bot.js:80-89` | Create Lichess WebSocket move packets |
| `WebSocketInterceptor` | `bot.js:18-57` | Proxy WebSocket connections |
| `MoveController` | New | Orchestrate all components |

### 5.2 LagManager

```javascript
/**
 * LagManager - WebSocket lag measurement and compensation
 * Ported from:  lichessbot/bot.js (lines 34-37)
 */
export class LagManager {
    constructor(config = {}) {
        this.defaultLag = config.defaultLag ??  1000;
        this.maxLag = config. maxLag ?? 10000;
        this.strategy = config.strategy ??  'fixed';  // 'fixed' | 'dynamic' | 'max'
        
        this.current = this.defaultLag;
        this.history = [];
        this.maxHistorySize = 10;
    }

    /**
     * Update from server-reported lag
     * Original: if (message. d?. clock?. lag !== undefined) { measuredLag = 10000; }
     */
    updateFromServer(serverLag) {
        this.history.push(serverLag);
        if (this.history. length > this.maxHistorySize) {
            this.history.shift();
        }
        
        switch (this.strategy) {
            case 'fixed':
                // Original behavior:  always use maxLag
                this.current = this.maxLag;
                break;
            case 'dynamic': 
                // Use captured lag value
                this.current = serverLag;
                break;
            case 'max': 
                // Use maximum observed lag
                this. current = Math.max(... this.history);
                break;
        }
    }

    reset() {
        this.current = this.defaultLag;
        this.history = [];
    }
}
```

### 5.3 FenBuilder

```javascript
/**
 * FenBuilder - Construct FEN from Lichess WebSocket data
 * Ported from:  
 *   - bot. js (line 46): Simplified FEN
 *   - bot1.js (lines 40-67): Full FEN with castling/en passant
 */
export class FenBuilder {
    constructor(mode = 'simplified') {
        this.mode = mode;  // 'simplified' | 'full'
    }

    /**
     * Build FEN from WebSocket message
     */
    build(message) {
        const partialFen = message.d. fen;
        const isWhitesTurn = message. d. ply % 2 === 0;
        const turnChar = isWhitesTurn ? 'w' : 'b';

        if (this.mode === 'full') {
            return this._buildFull(partialFen, turnChar, message);
        }
        return this._buildSimplified(partialFen, turnChar);
    }

    /**
     * Simplified FEN (bot. js, bot2.js pattern)
     * Original: currentFen = `${partialFen} ${isWhitesTurn ?  'w' :  'b'} - - 0 1`;
     */
    _buildSimplified(partialFen, turnChar) {
        return `${partialFen} ${turnChar} - - 0 1`;
    }

    /**
     * Full FEN with castling and en passant (bot1.js pattern)
     */
    _buildFull(partialFen, turnChar, message) {
        // Castling rights (bot1.js lines 42-54)
        let castlingRights = '';
        if (message. d.castle) {
            if (message.d.castle. white?. king) castlingRights += 'K';
            if (message. d.castle.white?. queen) castlingRights += 'Q';
            if (message.d.castle.black?.king) castlingRights += 'k';
            if (message. d.castle.black?.queen) castlingRights += 'q';
        }
        if (castlingRights === '') castlingRights = '-';

        // En passant (bot1.js lines 57-60)
        const enPassantTarget = message.d. enpassant?. square ??  '-';

        return `${partialFen} ${turnChar} ${castlingRights} ${enPassantTarget} 0 1`;
    }
}
```

### 5.4 MovePacketFactory

```javascript
/**
 * MovePacketFactory - Create Lichess WebSocket move packets
 * Ported from: bot.js (lines 80-89)
 */
export class MovePacketFactory {
    constructor(config = {}) {
        this.premoveFlag = config.premoveFlag ?? 1;  // 1 or -10
    }

    /**
     * Create move packet
     * Original: { t: "move", d: { u: bestMove, b: -10, l: measuredLag } }
     */
    create(move, lag) {
        return JSON.stringify({
            t:  "move",
            d: {
                u: move,                // UCI move (e.g., 'e2e4')
                b: this.premoveFlag,    // Premove flag
                l: lag                  // Lag compensation (ms)
            }
        });
    }
}
```

### 5.5 WebSocketInterceptor

```javascript
/**
 * WebSocketInterceptor - Proxy WebSocket for move interception
 * Ported from: bot.js (lines 18-57)
 * 
 * NOTE: Must run in page context (content_scripts world:  MAIN)
 */
export class WebSocketInterceptor {
    constructor(messageHandler) {
        this.messageHandler = messageHandler;
        this.activeSocket = null;
        this.originalWebSocket = null;
    }

    install() {
        this.originalWebSocket = window.WebSocket;
        const self = this;

        const webSocketProxy = new Proxy(this.originalWebSocket, {
            construct(target, args) {
                console.log("[Mephisto] WebSocket intercepted:", args[0]);
                
                const socket = new target(...args);
                self.activeSocket = socket;

                socket.addEventListener("message", (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        self. messageHandler(message);
                    } catch (e) {
                        // Non-JSON message, ignore
                    }
                });

                socket.addEventListener("close", () => {
                    self.activeSocket = null;
                });

                return socket;
            }
        });

        window.WebSocket = webSocketProxy;
    }

    uninstall() {
        if (this. originalWebSocket) {
            window.WebSocket = this.originalWebSocket;
        }
    }

    send(data) {
        if (this. activeSocket?. readyState === WebSocket.OPEN) {
            this. activeSocket.send(data);
            return true;
        }
        return false;
    }

    isOpen() {
        return this.activeSocket?.readyState === WebSocket.OPEN;
    }
}
```

---

## 6. Complete System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Mephisto Extension                                  │
├────────��────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         Engine Interface Layer                          │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │   │
│  │  │ Pattern A   │ │ Pattern B   │ │ Pattern C   │ │ Pattern D   │       │   │
│  │  │ asm.js      │ │ Emsc+WASM   │ │ ES+WASM     │ │ iframe      │       │   │
│  │  │ single-file │ │ Worker      │ │ Module      │ │ sandbox     │       │   │
│  │  │             │ │             │ │             │ │             │       │   │
│  │  │ stockfish-6 │ │ sf-16-40    │ │ sf17-79     │ │ lc0         │       │   │
│  │  │ lichessbot  │ │             │ │ sf16-7      │ │             │       │   │
│  │  │             │ │             │ │ sfhce       │ │             │       │   │
│  │  │             │ │             │ │ fsf14       │ │             │       │   │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘       │   │
│  │         └───────────────┴───────────────┴───────────────┘               │   │
│  │                                  │                                       │   │
│  │                    ┌─────────────▼─────────────┐                        │   │
│  │                    │     EngineInterface       │                        │   │
│  │                    │  (Unified API Wrapper)    │                        │   │
│  │                    └─────────────┬─────────────┘                        │   │
│  └──────────────────────────────────┼──────────────────────────────────────┘   │
│                                     │                                           │
│  ┌──────────────────────────────────▼──────────────────────────────────────┐   │
│  │                         Move Controller Layer                           │   │
│  │                                                                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │   │
│  │  │ LagManager  │  │ FenBuilder  │  │ MovePacket  │  │  WS Inter-  │    │   │
│  │  │             │  │             │  │ Factory     │  │  ceptor     │    │   │
│  │  │ • fixed     │  │ • simplified│  │             │  │             │    │   │
│  │  │ • dynamic   │  │ • full      │  │ • premove   │  │ • install   │    │   │
│  │  │ • max       │  │             │  │ • lag       │  │ • send      │    │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │   │
│  │                                                                         │   │
│  │                    ┌─────────────────────────────┐                      │   │
│  │                    │      MoveController         │                      │   │
│  │                    │   (Orchestration Layer)     │                      │   │
│  │                    └─────────────────────────────┘                      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                        Extension Components                              │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │  │
│  │  │   popup. js   │  │   content-   │  │  background- │                   │  │
│  │  │  (Analysis   │  │  script.js   │  │  script. js   │                   │  │
│  │  │    UI)       │  │  (DOM/WS)    │  │  (Messaging) │                   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                   │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Migration Summary

| Old (lichessbot/) | New (Mephisto) | Notes |
|-------------------|----------------|-------|
| `window.STOCKFISH()` | `EngineInterface. initialize()` | Unified factory for all patterns |
| `engine.postMessage()` | `EngineInterface. send()` | Handles postMessage/ccall |
| `engine.onmessage` | `EngineInterface.onMessage()` | Unified callback registration |
| `measuredLag` variable | `LagManager` class | Configurable strategy |
| Inline FEN construction | `FenBuilder` class | Supports simplified/full modes |
| Inline JSON. stringify | `MovePacketFactory` | Configurable premove flag |
| Inline WebSocket Proxy | `WebSocketInterceptor` | Reusable component |

---

This revised specification accurately reflects that: 
1. The **old lichessbot system** uses a single-file **Emscripten asm.js** `stockfish. js` with `window.STOCKFISH()` factory
2. **Mephisto** supports **4 different engine architecture patterns**
3. The **EngineInterface** must abstract across all these patterns to provide a unified API for the move logic components
