/**
 * This is the main logic for the bot. It runs in the page's main context,
 * allowing it to access `window.STOCKFISH` and `window.WebSocket`.
 */
function initializeAndRunBot() {
    let chessEngine;
    let currentFen = "";
    let bestMove;
    let webSocketWrapper = null;
    let measuredLag = 1000; // A safe, default lag value in milliseconds.

    function initializeChessEngine() {
        chessEngine = window.STOCKFISH();
        console.log("Chess engine initialized.");
        setupChessEngineOnMessage();
    }

    function interceptWebSocket() {
        const nativeWebSocket = window.WebSocket;
        const webSocketProxy = new Proxy(nativeWebSocket, {
            construct: function(target, args) {
                console.log("WebSocket connection intercepted.");
                const wrappedWebSocket = new target(...args);
                webSocketWrapper = wrappedWebSocket;

                wrappedWebSocket.addEventListener("message", function(event) {
                    let message;
                    try {
                        message = JSON.parse(event.data);
                    } catch (e) {
                        return;
                    }

                    // ** CAPTURE THE SERVER-REPORTED LAG **
                    if (message.d && message.d.clock && typeof message.d.clock.lag === 'number') {
                        measuredLag = 10000;
                    }

                    // Check for game state or move updates
                    if ((message.t === 'd' || message.t === 'move') && message.d && typeof message.d.fen === "string") {
                        
                        let partialFen = message.d.fen;
                        let isWhitesTurn = message.d.ply % 2 === 0;

                        // Simplified FEN construction
                        currentFen = `${partialFen} ${isWhitesTurn ? 'w' : 'b'} - - 0 1`;
                        
                        console.log("New FEN constructed:", currentFen);
                        calculateMove();
                    }
                });

                return wrappedWebSocket;
            }
        });
        window.WebSocket = webSocketProxy;
    }

    function calculateMove() {
        if (!chessEngine) {
            console.error("Chess engine not initialized. Cannot calculate move.");
            return;
        }
        //chessEngine.postMessage("setoption name Skill Level value 20");
        chessEngine.postMessage("position fen " + currentFen);
        console.log("Asking engine for best move...");
        chessEngine.postMessage("go depth 10");
		//chessEngine.postMessage("go movetime 300");
    }

    function setupChessEngineOnMessage() {
        chessEngine.onmessage = function(event) {
            if (typeof event === 'string' && event.includes("bestmove")) {
                bestMove = event.split(" ")[1];
                console.log("Engine found best move:", bestMove);

                if (webSocketWrapper && webSocketWrapper.readyState === WebSocket.OPEN) {
                    console.log(`Sending move to Lichess with dynamic lag (${measuredLag}ms):`, bestMove);
                    
                    webSocketWrapper.send(JSON.stringify({
                        t: "move",
                        d: { 
                            u: bestMove,
                            b: -10, // Premove flag
                            // ** USE THE DYNAMICALLY MEASURED LAG **
                            l: measuredLag, 
							//o: 1
                        }
                    }));
                } else {
                    console.error("WebSocket is not open. Cannot send move.");
                }
            }
        };
    }

    // --- Start the bot ---
    initializeChessEngine();
    interceptWebSocket();
}

// --- Entry point for the bot logic ---
initializeAndRunBot();