# Lichess Funnies - Chrome Extension

Chess automation tool for Lichess.org - speed optimized with smart lag compensation and weakened panic mode.

## Features

- Speed-optimized chess engine automation
- Smart lag compensation for VPN/network latency
- Panic mode with Stockfish 8
- Automatic move execution on Lichess.org
- Real-time game state tracking

## Chrome Extension Installation

### Loading the Extension in Developer Mode

1. **Download or clone this repository**
   ```bash
   git clone https://github.com/redwhitedaffodil/lichatoextension.git
   cd lichatoextension
   ```

2. **Open Chrome and navigate to the Extensions page**
   - Open Chrome/Chromium browser
   - Type `chrome://extensions` in the address bar
   - Or click the menu (⋮) → More Tools → Extensions

3. **Enable Developer Mode**
   - Find the "Developer mode" toggle in the top right corner
   - Click to enable it

4. **Load the Extension**
   - Click the "Load unpacked" button
   - Navigate to the folder containing the extension files
   - Select the `lichatoextension` folder
   - Click "Select Folder" or "Open"

5. **Verify Installation**
   - The extension should now appear in your extensions list
   - You should see "Lichess Funnies (Chess Automation)" with version 36.6

6. **Navigate to Lichess.org**
   - Go to https://lichess.org
   - The extension will activate automatically on any Lichess page
   - Start or join a game to see the automation in action

## File Structure

```
lichatoextension/
├── manifest.json          # Chrome Extension configuration
├── content.js             # Main application logic
├── jquery-3.6.0.min.js    # jQuery library
├── chess.js               # Chess.js library for game logic
├── stockfish.js           # Main Stockfish chess engine
├── stockfish8.js          # Stockfish 8 (panic mode engine)
├── mover.user.js          # Original userscript (reference)
└── README.md              # This file
```

## Technical Details

### Script Loading Order

The extension loads scripts in the following order (critical for proper operation):

1. `jquery-3.6.0.min.js` - Provides `$` and `jQuery` globals
2. `chess.js` - Provides `Chess` constructor for game state
3. `stockfish8.js` - Provides `STOCKFISH()` factory for panic mode engine
4. `stockfish.js` - Provides main `stockfish` engine
5. `content.js` - Main application logic

### World Context

The extension uses `"world": "MAIN"` to inject scripts directly into the page context, which is necessary for:
- Intercepting WebSocket connections to Lichess servers
- Accessing page-level JavaScript variables
- Full integration with Lichess's single-page application (SPA)

### Permissions

The extension requires:
- **Host Permissions**: `https://lichess.org/*` - To run on Lichess pages only
- **No Special Permissions**: The extension runs entirely in the page context with no additional Chrome API access

## Troubleshooting

### Extension Not Loading

1. Check that Developer Mode is enabled in `chrome://extensions`
2. Verify all files are present in the extension directory
3. Look for errors in the Extensions page (click "Errors" button if present)

### Extension Not Working on Lichess

1. Open Developer Tools (F12) and check the Console for errors
2. Verify the extension is enabled in `chrome://extensions`
3. Try reloading the Lichess page (Ctrl+R or Cmd+R)
4. Check that the extension has proper permissions for `https://lichess.org/*`

### Console Errors

If you see "jQuery is not defined" or similar errors:
- The scripts may be loading out of order
- Check the manifest.json file to ensure scripts are in the correct order
- Try removing and re-adding the extension

## Development

### Modifying the Extension

1. Edit the relevant files (typically `content.js` for main logic)
2. Go to `chrome://extensions`
3. Click the refresh/reload icon for this extension
4. Reload any Lichess pages to see changes

### Original Userscript

The original Tampermonkey/Greasemonkey userscript is preserved as `mover.user.js` for reference.

## Version

**Current Version**: 36.6

## Authors

- Michael and Ian (original authors)
- Modified with Config Toggles

## License

This is an automation tool for educational and research purposes. Use responsibly and in accordance with Lichess.org's terms of service.

## Notes

- Lichess.org is a single-page application (SPA), so the extension monitors for game state changes rather than relying on page loads
- The extension includes smart lag compensation for VPN and network latency
- Two chess engines are used: main Stockfish for normal play and Stockfish 8 for panic mode
