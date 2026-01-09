/**
 * EngineInterface - Unified wrapper for all chess engine architectures
 * 
 * Supports 4 engine patterns:
 * - Pattern A: asm.js single-file (stockfish-6)
 * - Pattern B: Emscripten + WASM Worker (stockfish-16-40)
 * - Pattern C: ES Module + WASM (sf17-79, sf16-7, sfhce, fsf14)
 * - Pattern D: iframe sandbox (lc0)
 * 
 * Provides unified API:
 * - initialize() - Load engine based on type
 * - send(command) - Send UCI command (handles postMessage vs ccall)
 * - analyze(fen, options) - Analyze position, return best move
 * - onMessage(handler) - Register message callback
 * - destroy() - Cleanup resources
 */

import { ENGINE_REGISTRY, EngineType } from './engine-registry.js';

export class EngineInterface {
    constructor(engineName) {
        this.engineName = engineName;
        this.config = ENGINE_REGISTRY[engineName];
        if (!this.config) {
            throw new Error(`Unknown engine: ${engineName}`);
        }
        
        this.engine = null;
        this.ready = false;
        this.messageHandlers = [];
        this.pendingAnalysis = null;
        this._iframe = null;
    }

    /**
     * Initialize engine based on its architecture type
     */
    async initialize() {
        const basePath = chrome?.runtime?.getURL 
            ? chrome.runtime.getURL(this.config.path)
            : this.config.path;
        
        switch (this.config.type) {
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
     * Pattern A: asm.js single-file (Web Worker)
     * Used by: stockfish-6
     */
    async _initAsmJsSingle(basePath) {
        const workerUrl = `${basePath}${this.config.jsEntry}`;
        this.engine = new Worker(workerUrl);
        this.engine.onmessage = (e) => this._handleMessage(e.data);
    }

    /**
     * Pattern B: Emscripten + WASM (Web Worker)
     * Used by: stockfish-16-40
     */
    async _initEmscriptenWasm(basePath) {
        const workerUrl = `${basePath}${this.config.jsEntry}`;
        this.engine = new Worker(workerUrl);
        this.engine.onmessage = (e) => this._handleMessage(e.data);
    }

    /**
     * Pattern C: ES Module + WASM (modern engines)
     * Used by: sf17-79, sf16-7, sfhce, fsf14
     */
    async _initEsModuleWasm(basePath) {
        const moduleUrl = `${basePath}${this.config.jsEntry}`;
        const module = await import(moduleUrl);
        this.engine = await module.default();
        
        // Set up message listener
        this.engine.listen = (msg) => this._handleMessage(msg);
        
        // Load NNUE weights if needed
        if (this.config.hasNnue && !this.config.nnueEmbedded) {
            await this._loadNnueWeights(basePath);
        }
    }

    /**
     * Pattern D: iframe sandbox (lc0)
     * Used by: lc0
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
        
        // Wait for engine to initialize in iframe
        let startup = true;
        const initHandler = () => { startup = false; };
        window.addEventListener('message', initHandler);
        while (startup) {
            await this._promiseTimeout(100);
        }
        window.removeEventListener('message', initHandler);
        
        // Set up postMessage communication
        this.engine = {
            postMessage: (msg) => iframe.contentWindow.postMessage(msg, '*')
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
        
        for (let i = 0; i < nnues.length; i++) {
            const nnueName = nnues[i];
            const response = await fetch(`${basePath}${nnueName}`);
            const buffer = await response.arrayBuffer();
            this.engine.setNnueBuffer(new Uint8Array(buffer), i);
        }
    }

    /**
     * Load LC0 neural network weights
     */
    async _loadLc0Weights(basePath) {
        // LC0 weights filename from config or default
        const weightsFile = this.config.weightsFile || 'weights_32195.dat.gz';
        const weightsPath = `${basePath}lib/${weightsFile}`;
        const weights = await fetch(weightsPath).then(r => r.arrayBuffer());
        
        this.engine.postMessage({
            type: 'weights',
            data: { name: weightsFile, weights }
        }, '*');
        
        // Wait for weights to load
        await this._promiseTimeout(1000);
    }

    /**
     * Send UCI command to engine (unified interface)
     */
    send(command) {
        if (!this.ready) {
            console.warn('[EngineInterface] Engine not ready, queueing command:', command);
        }

        switch (this.config.uciMethod) {
            case 'postMessage':
                this.engine.postMessage(command);
                break;
                
            case 'ccall':
                if (this.engine && typeof this.engine.uci === 'function') {
                    this.engine.uci(command);
                }
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
                this.send(`go depth ${options.depth}`);
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
            const parts = msg.split(' ');
            const bestMove = parts[1];
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
            await this._promiseTimeout(50);
        }
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this._iframe) {
            this._iframe.remove();
        }
        if (this.engine?.terminate) {
            this.engine.terminate();
        }
        this.engine = null;
        this.ready = false;
    }

    /**
     * Helper: Promise timeout
     */
    _promiseTimeout(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
