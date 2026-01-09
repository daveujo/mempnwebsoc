/**
 * This is the main logic for the bot. It runs in the page's main context,
 * allowing it to access `window.STOCKFISH` and `window.WebSocket`.
 */
function initializeAndRunBot() {
    let chessEngine;
    let currentFen = "";
    let bestMove;
    let webSocketWrapper = null;

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

                    switch (message.t) {
                        case 'd':
                        case 'move':
                            if (message.d && typeof message.d.fen === "string") {
                                let partialFen = message.d.fen;
                                let isWhitesTurn = message.d.ply % 2 === 0;

                                // --- FIX FOR CASTLING ---
                                // Added checks to ensure castle objects exist before accessing them.
                                let castlingRights = "";
                                if (message.d.castle) {
                                    if (message.d.castle.white) {
                                        if (message.d.castle.white.king) castlingRights += "K";
                                        if (message.d.castle.white.queen) castlingRights += "Q";
                                    }
                                    if (message.d.castle.black) {
                                        if (message.d.castle.black.king) castlingRights += "k";
                                        if (message.d.castle.black.queen) castlingRights += "q";
                                    }
                                }
                                if (castlingRights === "") {
                                    castlingRights = "-";
                                }
                                // --- END CASTLING FIX ---

                                // --- FIX FOR EN PASSANT ---
                                // Previously, the en passant target square was hardcoded as "-".
                                // Now, we check if Lichess provides an en passant square in the data.
                                const enPassantTarget = message.d.enpassant ? message.d.enpassant.square : "-";
                                // --- END EN PASSANT FIX ---

                                // Construct the full FEN with correct castling and en passant rights.
                                // The halfmove and fullmove clocks (0 1) are still simplified but sufficient.
                                currentFen = `${partialFen} ${isWhitesTurn ? 'w' : 'b'} ${castlingRights} ${enPassantTarget} 0 1`;
                                console.log("New FEN constructed:", currentFen);
                                calculateMove();
                            }
                            break;
                        case 'clockInc':
                        case 'crowd':
                        case 'mlat':
                            break;
                        default:
                            break;
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
        chessEngine.postMessage("setoption name Skill Level value 20");
        chessEngine.postMessage("position fen " + currentFen);
        console.log("Asking engine for best move...");

        // In very fast games, thinking time is the enemy.
        // We reduce movetime to a bare minimum (20ms) to simulate a premove.
        // chessEngine.postMessage("go movetime 300");
		chessEngine.postMessage("go depth 10");
    }

    function setupChessEngineOnMessage() {
        chessEngine.onmessage = function(event) {
            if (typeof event === 'string' && event.includes("bestmove")) {
                bestMove = event.split(" ")[1];
                console.log("Engine found best move:", bestMove);

                if (webSocketWrapper && webSocketWrapper.readyState === WebSocket.OPEN) {
                    console.log("Sending move to Lichess with premove/lag flags:", bestMove);
                    
                    webSocketWrapper.send(JSON.stringify({
                        t: "move",
                        d: { 
                            u: bestMove,
                            b: 1, // Premove flag
                            l: 10000 // Lag compensation value (server-side handles this)
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
