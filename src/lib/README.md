# Mephisto Library Components

This directory contains the core library components for the unified engine interface and move controller architecture.

## Architecture Overview

The library implements a modular architecture that supports 4 different chess engine patterns and provides automated move analysis and dispatch through WebSocket interception.

### Components

#### 1. Engine Registry (`engine-registry.js`)
Configuration registry for all supported chess engines.

**Exports:**
- `EngineType`: Enum defining engine architecture patterns
- `ENGINE_REGISTRY`: Configuration object for all engines

**Supported Engines:**
- `stockfish-6`: Pattern A (asm.js single-file)
- `stockfish-16-nnue-40`: Pattern B (Emscripten + WASM Worker)
- `stockfish-17-nnue-79`: Pattern C (ES Module + WASM)
- `stockfish-16-nnue-7`: Pattern C (ES Module + WASM)
- `stockfish-11-hce`: Pattern C (ES Module + WASM, no NNUE)
- `fairy-stockfish-14-nnue`: Pattern C (ES Module + WASM, with variants)
- `lc0`: Pattern D (iframe sandbox)

#### 2. Engine Interface (`engine-interface.js`)
Unified wrapper that abstracts engine initialization and communication across all patterns.

**Key Methods:**
- `initialize()`: Load and initialize engine based on type
- `send(command)`: Send UCI command (handles postMessage vs ccall)
- `analyze(fen, options)`: Analyze position and return best move
- `onMessage(handler)`: Register message callback
- `destroy()`: Cleanup resources

**Engine Patterns:**
- **Pattern A** (asm.js): `new Worker(path)` → `postMessage()`
- **Pattern B** (Emscripten WASM): `new Worker(path)` → `postMessage()`
- **Pattern C** (ES Module): `await import()` → `engine.uci()`
- **Pattern D** (iframe): `iframe.contentWindow.postMessage()`

#### 3. Move Controller (`move-controller.js`)
Main orchestrator that coordinates all components for automated move analysis.

**Key Features:**
- Processes WebSocket messages from Lichess
- Extracts FEN from game state
- Analyzes positions using engine
- Generates move packets with lag compensation
- Dispatches moves through WebSocket

**Configuration:**
```javascript
const controller = new MoveController({
    defaultLag: 1000,
    maxLag: 10000,
    lagStrategy: 'fixed',  // 'fixed' | 'dynamic' | 'max'
    fenMode: 'simplified',  // 'simplified' | 'full'
    premoveFlag: 1,         // 1 | -10
    depth: 10
});
```

#### 4. Lag Manager (`lag-manager.js`)
WebSocket lag measurement and compensation.

**Strategies:**
- `fixed`: Always use configured maximum lag value
- `dynamic`: Use server-reported lag value
- `max`: Use maximum observed lag value

**Methods:**
- `updateFromServer(serverLag)`: Update from WebSocket clock data
- `getCurrent()`: Get current lag value to use
- `setStrategy(strategy)`: Change compensation strategy
- `reset()`: Reset lag tracking

#### 5. FEN Builder (`fen-builder.js`)
Constructs FEN strings from Lichess WebSocket data.

**Modes:**
- `simplified`: Basic FEN with placeholder castling/en passant
  - Format: `{position} {turn} - - 0 1`
- `full`: Complete FEN with parsed castling rights and en passant
  - Format: `{position} {turn} {castling} {enpassant} 0 1`

**Usage:**
```javascript
const builder = new FenBuilder('full');
const fen = builder.build(wsMessage);
// Example: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
```

#### 6. Move Packet Factory (`move-packet-factory.js`)
Creates Lichess WebSocket move packets.

**Packet Format:**
```javascript
{
    t: "move",
    d: {
        u: "e2e4",    // UCI move
        b: 1,         // Premove flag (1 or -10)
        l: 10000      // Lag compensation (ms)
    }
}
```

**Premove Flags:**
- `1`: Normal move
- `-10`: Aggressive premove

#### 7. WebSocket Interceptor (`websocket-interceptor.js`)
WebSocket proxy for intercepting connections in page context.

**Note:** Must run in `world: "MAIN"` to access `window.WebSocket`.

**Methods:**
- `install()`: Install WebSocket proxy
- `uninstall()`: Restore original WebSocket
- `send(data)`: Send through active socket
- `isOpen()`: Check connection state

## Usage Example

### Complete Integration

```javascript
import { MoveController } from './lib/move-controller.js';

// 1. Initialize controller
const controller = new MoveController({
    lagStrategy: 'fixed',
    fenMode: 'full',
    premoveFlag: 1
});

await controller.initialize('stockfish-17-nnue-79');

// 2. Set up callbacks
controller.onMoveCalculated = (move, fen) => {
    console.log('Best move:', move);
    // Send move through WebSocket
};

controller.onFenUpdated = (fen) => {
    console.log('Position updated:', fen);
};

// 3. Enable automatic processing
controller.setEnabled(true);

// 4. Process WebSocket messages
// (called from WebSocket interceptor)
controller.processMessage(wsMessage);
```

### WebSocket Interception Flow

1. **Page Context** (`page-context-bridge.js`):
   - Intercepts WebSocket connections
   - Captures game state messages
   - Forwards messages via CustomEvents

2. **Content Script** (`content-script.js`):
   - Listens for CustomEvents
   - Forwards messages to popup

3. **Popup** (`popup.js`):
   - MoveController processes messages
   - Analyzes positions with engine
   - Sends moves back to content script

4. **Content Script → Page Context**:
   - Sends move packet to page context
   - Page context sends through WebSocket

## Configuration Options

### Engine Selection
Configure in `src/options/pages/settings/general/`:
- Engine type (SF6, SF11, SF16, SF17, FSF14, LC0)
- Variant support
- Search time, threads, memory

### WebSocket Mode Settings
- `websocket_mode`: Enable/disable WebSocket mode
- `lag_compensation`: Lag value in milliseconds (default: 10000)
- `lag_strategy`: 'fixed' | 'dynamic' | 'max'
- `fen_mode`: 'simplified' | 'full'
- `premove_flag`: 1 | -10

## Security Considerations

1. **WebSocket Interception**: Only intercepts on exact Lichess domains
2. **Message Validation**: All WebSocket messages are JSON-validated
3. **Engine Isolation**: Engines run in isolated contexts (workers/iframes)
4. **CSP Compliance**: Uses `wasm-unsafe-eval` for WASM execution

## Testing

The implementation supports all 7 engines across 4 patterns. Testing checklist:

- [ ] Pattern A: stockfish-6 initialization and analysis
- [ ] Pattern B: stockfish-16-40 initialization and analysis
- [ ] Pattern C: All modern engines (SF17, SF16, SF11, FSF14)
- [ ] Pattern D: LC0 with weights loading
- [ ] WebSocket interception on Lichess
- [ ] FEN construction (simplified and full modes)
- [ ] Lag compensation strategies
- [ ] Move packet generation and dispatch

## Troubleshooting

### Engine Fails to Initialize
- Check console for error messages
- Verify WASM files are accessible
- Ensure CSP allows `wasm-unsafe-eval`

### WebSocket Not Intercepting
- Verify page-context-bridge.js is running in MAIN world
- Check manifest.json for correct world setting
- Look for "[Mephisto] WebSocket intercepted" in console

### Moves Not Sending
- Check WebSocket connection state
- Verify lag compensation settings
- Ensure premove flag is valid (1 or -10)

## References

- Original bot logic: `new move logic to apply/lichessbot/`
- Engine patterns documentation: `README.md` (root)
- Lichess WebSocket API: https://lichess.org/api
