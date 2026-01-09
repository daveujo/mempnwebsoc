/**
 * This content script's only responsibility is to inject the necessary scripts,
 * in the correct order, into the page's main context. This avoids CSP errors
 * by loading scripts via `src` from the extension's secure resources, instead
 * of trying to inject inline code.
 */
function runInjector() {
    // 1. Inject the Stockfish library itself. This script runs first.
    const stockfishScript = document.createElement('script');
    stockfishScript.src = chrome.runtime.getURL('stockfish.js');
    (document.head || document.documentElement).appendChild(stockfishScript);

    // 2. Once the Stockfish library has loaded, we can then inject our bot's logic,
    // which depends on Stockfish being available.
    stockfishScript.onload = () => {
        console.log("Stockfish library loaded. Injecting bot logic...");
        const botScript = document.createElement('script');
        botScript.src = chrome.runtime.getURL('bot.js');
        (document.head || document.documentElement).appendChild(botScript);

        // Clean up the script tags from the DOM after they are loaded/executed.
        botScript.onload = () => {
            console.log("Bot logic script loaded and running.");
            botScript.remove();
        };
        stockfishScript.remove();
    };

    stockfishScript.onerror = () => {
        console.error("Fatal: Could not load stockfish.js. Check that the file exists and is listed in web_accessible_resources in the manifest.");
    };
}

// --- Entry Point for the Content Script ---
runInjector();
