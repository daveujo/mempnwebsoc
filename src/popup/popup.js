import {Chess} from '../../lib/chess.js';

let engine;
let board;
let fen_cache;
let config;

let is_calculating = false;
let prog = 0;
let last_eval = {fen: '', activeLines: 0, lines: []};
let turn = ''; // 'w' | 'b'
let currentVariant = 'chess';  // Track current detected variant
let engineInitialized = false;

// Determine if we are running in a floating window and which tab we are watching
let targetTabId = new URLSearchParams(window.location.search).get('targetTabId');

// Variant display name mapping
const VARIANT_DISPLAY_NAMES = {
    'chess': 'Standard Chess',
    'fischerandom': 'Chess960',
    'crazyhouse': 'Crazyhouse',
    'kingofthehill': 'King of the Hill',
    '3check': 'Three-Check',
    'antichess': 'Antichess',
    'atomic': 'Atomic',
    'horde': 'Horde',
    'racingkings': 'Racing Kings'
};

// Variant NNUE model mapping
const VARIANT_NNUE_MAP = {
    'chess': 'nn-46832cfbead3.nnue',
    'fischerandom': 'nn-46832cfbead3.nnue',
    'crazyhouse': 'crazyhouse-8ebf84784ad2.nnue',
    'kingofthehill': 'kingofthehill-978b86d0e6a4.nnue',
    '3check': '3check-cb5f517c228b.nnue',
    'antichess': 'antichess-dd3cbe53cd4e.nnue',
    'atomic': 'atomic-2cf13ff256cc.nnue',
    'horde': 'horde-28173ddccabe.nnue',
    'racingkings': 'racingkings-636b95f085e3.nnue',
};

document.addEventListener('DOMContentLoaded', async function () {
    // Load extension configurations from localStorage
    const computeTime = JSON.parse(localStorage.getItem('compute_time'));
    const fenRefresh = JSON.parse(localStorage.getItem('fen_refresh'));
    const thinkTime = JSON.parse(localStorage.getItem('think_time'));
    const thinkVariance = JSON.parse(localStorage.getItem('think_variance'));
    const moveTime = JSON.parse(localStorage.getItem('move_time'));
    const moveVariance = JSON.parse(localStorage.getItem('move_variance'));
    
    config = {
        engine: JSON.parse(localStorage.getItem('engine')) || 'stockfish-16-nnue-7',
        variant: JSON.parse(localStorage.getItem('variant')) || 'chess',
        compute_time: (computeTime != null) ? computeTime : 3000,
        fen_refresh: (fenRefresh != null) ? fenRefresh : 100,
        multiple_lines: JSON.parse(localStorage.getItem('multiple_lines')) || 1,
        threads: JSON.parse(localStorage.getItem('threads')) || navigator.hardwareConcurrency - 1,
        memory: JSON.parse(localStorage.getItem('memory')) || 32,
        think_time: (thinkTime != null) ? thinkTime : 1000,
        think_variance: (thinkVariance != null) ? thinkVariance : 500,
        move_time: (moveTime != null) ? moveTime : 500,
        move_variance: (moveVariance != null) ? moveVariance : 250,
        computer_evaluation: JSON.parse(localStorage.getItem('computer_evaluation')) || false,
        threat_analysis: JSON.parse(localStorage.getItem('threat_analysis')) || false,
        simon_says_mode: JSON.parse(localStorage.getItem('simon_says_mode')) || false,
        autoplay: JSON.parse(localStorage.getItem('autoplay')) || false,
        puzzle_mode: JSON.parse(localStorage.getItem('puzzle_mode')) || false,
        python_autoplay_backend: JSON.parse(localStorage.getItem('python_autoplay_backend')) || false,
        pieces: JSON.parse(localStorage.getItem('pieces')) || 'wikipedia.svg',
        board: JSON.parse(localStorage.getItem('board')) || 'brown',
        coordinates: JSON.parse(localStorage.getItem('coordinates')) || false,
    };
    push_config();

    // Init Dark Mode
    const darkModeEnabled = JSON.parse(localStorage.getItem('dark_mode')) || false;
    if (darkModeEnabled) {
        document.body.classList.add('dark-mode');
        document.getElementById('dark-mode-icon').innerText = 'brightness_high';
    }

    // init chess board
    document.getElementById('board').classList.add(config.board);
    const [pieceSet, ext] = config.pieces.split('.');
    board = ChessBoard('board', {
        position: 'start',
        pieceTheme: `/res/chesspieces/${pieceSet}/{piece}.${ext}`,
        appearSpeed: 'fast',
        moveSpeed: 'fast',
        showNotation: config.coordinates,
        draggable: false
    });

    // init fen LRU cache
    fen_cache = new LRU(100);

    // init engine webworker
    await initialize_engine();
    engineInitialized = true;

    // listen to messages from content-script
    chrome.runtime.onMessage.addListener(async function (response) {
        if (response.fenresponse && response.dom !== 'no') {
            if (board.orientation() !== response.orient) {
                board.orientation(response.orient);
            }
            const detectedVariant = response.detectedVariant || 'chess';
            if (detectedVariant !== currentVariant) {
                currentVariant = detectedVariant;
                await handleVariantChange(detectedVariant);
            }
            const {fen, startFen, moves} = parse_position_from_response(response.dom);
            if (last_eval.fen !== fen) {
                on_new_pos(fen, startFen, moves);
            }
        } else if (response.pullConfig) {
            push_config();
        } else if (response.click) {
            dispatch_click_event(response.x, response.y);
        }
    });

    // query fen periodically
    request_fen();
    setInterval(() => request_fen(), config.fen_refresh);

    // --- BUTTON LISTENERS ---

    document.getElementById('config').addEventListener('click', () => {
        window.open('/src/options/options.html', '_blank');
    });

    document.getElementById('pop-out').addEventListener('click', () => {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                const url = new URL(window.location.href);
                url.searchParams.set('targetTabId', tabs[0].id);
                chrome.windows.create({
                    url: url.toString(),
                    type: 'popup',
                    width: 370,
                    height: 520
                });
                window.close();
            }
        });
    });

    document.getElementById('dark-mode-toggle').addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark-mode');
        localStorage.setItem('dark_mode', JSON.stringify(isDark));
        document.getElementById('dark-mode-icon').innerText = isDark ? 'brightness_high' : 'brightness_4';
    });

    M.Tooltip.init(document.querySelectorAll('.tooltipped'), {});
});

// --- MESSAGING HELPERS (Handles Floating Window Target) ---

function request_fen() {
    if (targetTabId) {
        chrome.tabs.sendMessage(parseInt(targetTabId), {queryfen: true});
    } else {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, {queryfen: true});
        });
    }
}

function request_automove(move) {
    const message = (config.puzzle_mode)
        ? {automove: true, pv: last_eval.lines[0].pv.split(' ') || [move]}
        : {automove: true, move: move};
    if (targetTabId) {
        chrome.tabs.sendMessage(parseInt(targetTabId), message);
    } else {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, message);
        });
    }
}

function request_console_log(message) {
    if (targetTabId) {
        chrome.tabs.sendMessage(parseInt(targetTabId), {consoleMessage: message});
    } else {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, {consoleMessage: message});
        });
    }
}

function push_config() {
    if (targetTabId) {
        chrome.tabs.sendMessage(parseInt(targetTabId), {pushConfig: true, config: config});
    } else {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, {pushConfig: true, config: config});
        });
    }
}

// --- ENGINE LOGIC ---

async function initialize_engine() {
    const engineMap = {
        'stockfish-17-nnue-79': 'stockfish-17-79/sf17-79.js',
        'stockfish-16-nnue-40': 'stockfish-16-40/stockfish.js',
        'stockfish-16-nnue-7': 'stockfish-16-7/sf16-7.js',
        'stockfish-11-hce': 'stockfish-11-hce/sfhce.js',
        'stockfish-6': 'stockfish-6/stockfish.js',
        'lc0': 'lc0/lc0.js',
        'fairy-stockfish-14-nnue': 'fairy-stockfish-14/fsf14.js',
    };
    const enginePath = `/lib/engine/${engineMap[config.engine]}`;
    const engineBasePath = enginePath.substring(0, enginePath.lastIndexOf('/'));
    
    if (['stockfish-16-nnue-40', 'stockfish-6'].includes(config.engine)) {
        engine = new Worker(enginePath);
        engine.onmessage = (event) => on_engine_response(event.data);
    } else if (['stockfish-17-nnue-79', 'stockfish-16-nnue-7', 'fairy-stockfish-14-nnue', 'stockfish-11-hce'].includes(config.engine)) {
        const module = await import(enginePath);
        engine = await module.default();
        if (config.engine.includes('nnue')) {
            const fetchNnueModels = async (engine, engineBasePath) => {
                if (config.engine !== 'fairy-stockfish-14-nnue') {
                    const nnues = [];
                    for (let i = 0; ; i++) {
                        let nnue = engine.getRecommendedNnue(i);
                        if (!nnue || nnues.includes(nnue)) break;
                        nnues.push(nnue);
                    }
                    const nnue_responses = await Promise.all(nnues.map(n => fetch(`${engineBasePath}/${n}`)));
                    return await Promise.all(nnue_responses.map(res => res.arrayBuffer()));
                } else {
                    const res = await fetch(`${engineBasePath}/nnue/${VARIANT_NNUE_MAP[config.variant]}`);
                    return [await res.arrayBuffer()];
                }
            };
            if (config.engine === 'fairy-stockfish-14-nnue') send_engine_uci(`setoption name UCI_Variant value ${config.variant}`);
            const models = await fetchNnueModels(engine, engineBasePath);
            models.forEach((m, i) => engine.setNnueBuffer(new Uint8Array(m), i));
        }
        engine.listen = (msg) => on_engine_response(msg);
    } else if (config.engine === 'lc0') {
        const frame = document.createElement('iframe');
        frame.src = `${engineBasePath}/lc0.html`; frame.style.display = 'none';
        document.body.appendChild(frame); engine = frame.contentWindow;
        let startup = true; window.onmessage = () => startup = false;
        while (startup) await promise_timeout(100);
        window.onmessage = e => on_engine_response(e.data);
        let w = await fetch(`${engineBasePath}/weights/weights_32195.dat.gz`).then(res => res.arrayBuffer());
        engine.postMessage({type: 'weights', data: {name: 'weights_32195.dat.gz', weights: w}}, '*');
    }

    if (config.engine === 'remote') {
        request_remote_configure({"Hash": config.memory, "Threads": config.threads, "MultiPV": config.multiple_lines});
    } else {
        if (!['stockfish-16-nnue-40', 'stockfish-6'].includes(config.engine)) send_engine_uci(`setoption name Hash value ${config.memory}`);
        if (config.engine !== 'stockfish-6') send_engine_uci(`setoption name Threads value ${config.threads}`);
        send_engine_uci(`setoption name MultiPV value ${config.multiple_lines}`);
        send_engine_uci('ucinewgame');
        send_engine_uci('isready');
    }
}

async function handleVariantChange(variant) {
    config.variant = variant;
    if (variant !== 'chess' && variant !== 'fischerandom' && config.engine !== 'fairy-stockfish-14-nnue') {
        config.engine = 'fairy-stockfish-14-nnue';
        await reinitialize_engine();
    } else if (config.engine === 'fairy-stockfish-14-nnue') {
        await reloadVariantNnue(variant);
    }
    updateVariantDisplay(variant);
}

function updateVariantDisplay(variant) {
    const elem = document.getElementById('game-detection');
    if (elem) {
        const site = elem.innerText.split(' - ')[0];
        elem.innerText = `${site} - ${VARIANT_DISPLAY_NAMES[variant] || variant}`;
    }
}

async function reinitialize_engine() {
    if (engine) {
        send_engine_uci('quit');
        if (engine instanceof Worker) engine.terminate();
        engine = null;
    }
    last_eval = {fen: '', activeLines: 0, lines: []};
    toggle_calculating(false);
    await initialize_engine();
}

async function reloadVariantNnue(variant) {
    if (config.engine !== 'fairy-stockfish-14-nnue') return;
    const vn = VARIANT_NNUE_MAP[variant]; if (!vn) return;
    send_engine_uci(`setoption name UCI_Variant value ${variant}`);
    const res = await fetch(`/lib/engine/fairy-stockfish-14/nnue/${vn}`);
    engine.setNnueBuffer(new Uint8Array(await res.arrayBuffer()), 0);
    send_engine_uci('ucinewgame'); send_engine_uci('isready');
}

function send_engine_uci(msg) {
    if (config.engine === 'lc0') engine.postMessage(msg, '*');
    else if (engine instanceof Worker) engine.postMessage(msg);
    else if (engine && 'uci' in engine) engine.uci(msg);
}

function on_engine_best_move(best, threat, isTerminal=false) {
    const pmap = {P: 'Pawn', R: 'Rook', N: 'Knight', B: 'Bishop', Q: 'Queen', K: 'King'};
    const toplay = (turn === 'w') ? 'White' : 'Black';
    const next = (turn === 'w') ? 'Black' : 'White';

    if (best === '(none)') {
        const pv = last_eval.lines[0] || '';
        if ('mate' in pv) {
            update_evaluation('Checkmate!');
            update_best_move(config.variant === 'antichess' ? `${toplay} Wins` : `${next} Wins`, '');
        } else {
            update_evaluation('Stalemate!');
            update_best_move(config.variant === 'antichess' ? `${toplay} Wins` : 'Draw', '');
        }
    } else if (config.simon_says_mode) {
        if (toplay.toLowerCase() === board.orientation()) {
            const startPiece = board.position()[best.substring(0, 2)];
            if (startPiece) update_best_move(pmap[startPiece.substring(1)]);
        } else update_best_move('');
    } else {
        update_best_move(`${toplay} to play, best move is ${best}`, (threat && threat !== '(none)') ? `Best response for ${next} is ${threat}` : '');
    }

    if (toplay.toLowerCase() === board.orientation()) {
        last_eval.bestmove = best; last_eval.threat = threat;
        if (config.simon_says_mode && board.position()[best.substring(0, 2)]) {
            const line = last_eval.lines[0];
            if (line) request_console_log(`${pmap[board.position()[best.substring(0, 2)].substring(1)]} ==> ${'mate' in line ? '#'+line.mate : line.score/100.0}`);
            if (config.threat_analysis) { clear_annotations(); draw_threat(); }
        }
        if (config.autoplay && isTerminal) request_automove(best);
    }
    if (!config.simon_says_mode) { draw_moves(); if (config.threat_analysis) draw_threat(); }
    toggle_calculating(false);
}

function on_engine_evaluation(info) {
    if (!info.lines[0]) return;
    const line = info.lines[0];
    update_evaluation('mate' in line ? `Checkmate in ${line.mate}` : `Score: ${line.score / 100.0} at depth ${line.depth}`);
}

function on_engine_response(message) {
    if (config.engine === 'remote') {
        last_eval = Object.assign(last_eval, message);
        on_engine_evaluation(last_eval);
        on_engine_best_move(last_eval.bestmove, last_eval.threat, true);
        return;
    }
    if (message.includes('lowerbound') || message.includes('upperbound') || message.includes('currmove')) return;
    if (message.startsWith('bestmove')) {
        const arr = message.split(' '); on_engine_best_move(arr[1], arr[3], true);
    } else if (message.startsWith('info depth')) {
        const lineInfo = {}; const tokens = message.split(' ').slice(1);
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i] === 'score') { lineInfo.rawScore = `${tokens[i+1]} ${tokens[i+2]}`; i += 2; }
            else if (tokens[i] === 'pv') { lineInfo['move'] = tokens[i+1]; lineInfo['pv'] = tokens.slice(i+1).join(' '); break; }
            else { const n = parseInt(tokens[i+1]); lineInfo[tokens[i]] = isNaN(n) ? tokens[i+1] : n; i++; }
        }
        const scoreNum = Number(lineInfo.rawScore.substring(lineInfo.rawScore.indexOf(' ') + 1));
        lineInfo[lineInfo.rawScore.includes('cp') ? 'score' : 'mate'] = (turn === 'w' ? 1 : -1) * scoreNum;
        const idx = (lineInfo.multipv - 1) || 0;
        last_eval.activeLines = Math.max(last_eval.activeLines, lineInfo.multipv);
        if (idx === 0) {
            if (last_eval.lines[0]) { const p = last_eval.lines[0].pv.split(' '); on_engine_best_move(p[0], p[1]); }
            last_eval.lines = new Array(config.multiple_lines);
            last_eval.lines[idx] = lineInfo; on_engine_evaluation(last_eval);
        } else last_eval.lines[idx] = lineInfo;
    }
    if (is_calculating) { prog++; let m = 100 * (1 - Math.exp(-prog / 30)); document.getElementById('progBar')?.setAttribute('value', Math.round(m)); }
}

function on_new_pos(fen, startFen, moves) {
    toggle_calculating(true);
    if (config.engine === 'remote') {
        request_remote_analysis(moves ? startFen : fen, config.compute_time, moves).then(on_engine_response);
    } else {
        send_engine_uci('stop');
        send_engine_uci(moves ? `position fen ${startFen} moves ${moves}` : `position fen ${fen}`);
        send_engine_uci(`go movetime ${config.compute_time}`);
    }
    board.position(fen); clear_annotations();
    last_eval = {fen, activeLines: 0, lines: new Array(config.multiple_lines)};
}

function parse_position_from_response(txt) {
    const pMap = { li: 'Lichess.org', cc: 'Chess.com', bt: 'BlitzTactics.com' };
    const pMoves = (t, s = null) => {
        const dk = s ? `${s}_${t}` : t; const dh = fen_cache.get(dk);
        if (dh) { turn = dh.fen.charAt(dh.fen.indexOf(' ') + 1); return dh; }
        let rec; const regex = /([\w-+=#@]+[*]+)$/; const ik = dk.replace(regex, ''); const ih = fen_cache.get(ik);
        if (ih) {
            const c = new Chess(config.variant, ih.fen); const m = c.move(t.match(regex)[0].split('*****')[0]);
            turn = c.turn(); rec = {fen: c.fen(), startFen: ih.startFen, moves: ih.moves + ' ' + m.lan};
        } else {
            const c = new Chess(config.variant, s); const sans = t.split('*****').slice(0, -1);
            let ms = ''; for (const san of sans) ms += c.move(san).lan + ' ';
            turn = c.turn(); rec = {fen: c.fen(), startFen: c.startFen(), moves: ms.trim()};
        }
        fen_cache.set(dk, rec); return rec;
    };
    const pPieces = (t) => {
        const dh = fen_cache.get(t); if (dh) { turn = dh.fen.charAt(dh.fen.indexOf(' ') + 1); return dh; }
        const c = new Chess(config.variant); c.clear(); const [pt, ...ps] = t.split('*****').slice(0, -1);
        for (const p of ps) { const a = p.split('-'); c.put({type: a[1], color: a[0]}, a[2]); }
        c.setTurn(pt); turn = c.turn(); const r = {fen: c.fen()}; fen_cache.set(t, r); return r;
    };
    const tag = txt.substring(3, 8); document.getElementById('game-detection').innerText = `Game detected on ${pMap[tag.substring(0, 2)]}`;
    txt = txt.substring(11);
    if (tag.includes('var')) {
        if (config.variant === 'fischerandom') {
            const s = pPieces(txt.substring(0, txt.indexOf('&'))).fen.replace('-', 'KQkq');
            return pMoves(txt.substring(txt.indexOf('&') + 6), s);
        } else return pMoves(txt);
    } else if (tag.includes('puz')) return pPieces(txt);
    else return pMoves(txt);
}

function update_evaluation(s) { if (s && config.computer_evaluation) document.getElementById('evaluation').innerHTML = s; }
function update_best_move(l1, l2) { if (l1 !== null) document.getElementById('chess_line_1').innerHTML = l1; if (l2 !== null) document.getElementById('chess_line_2').innerHTML = l2; }

function clear_annotations() { document.getElementById('move-annotations').innerHTML = ''; document.getElementById('response-annotations').innerHTML = ''; }
function toggle_calculating(on) { prog = 0; is_calculating = on; if (on) update_best_move(`<div>Calculating...<div><progress id='progBar' value='2' max='100'>`, ''); }

function draw_moves() {
    if (!last_eval.lines[0]) return;
    const sFunc = (l) => {
        const top = last_eval.lines[0]; const ts = (turn === 'w' ? 1 : -1) * top.score / 100;
        const s = (turn === 'w' ? 1 : -1) * l.score / 100;
        if (top.move === l.move) return 0.25;
        if (isNaN(ts) || ts >= 4) return isNaN(s) ? 0.21 : (s < 4 ? 0 : 0.18);
        const d = ts - s; return (isNaN(s) || d >= 4) ? 0 : Math.min(0.225, Math.max(0.075, 0.225 - d/15));
    };
    clear_annotations();
    for (let i = 0; i < last_eval.activeLines; i++) {
        if (last_eval.lines[i]) draw_move(last_eval.lines[i].move, i === 0 ? '#004db8' : '#4a4a4a', document.getElementById('move-annotations'), sFunc(last_eval.lines[i]));
    }
}

function draw_threat() { if (last_eval.threat) draw_move(last_eval.threat, '#bf0000', document.getElementById('response-annotations')); }

function draw_move(m, c, o, sw = 0.225) {
    if (!m || m === '(none)' || sw === 0) return;
    const gCoord = (s) => {
        const x = s[0].charCodeAt(0) - 96; const y = parseInt(s[1]);
        return (board.orientation() === 'white') ? {x, y} : {x: 9 - x, y: 9 - y};
    };
    if (m.includes('@')) {
        const co = gCoord(m.substring(2, 4)); const x = 0.5 + (co.x-1), y = 8 - (0.5 + (co.y-1));
        const [ps, ex] = config.pieces.split('.');
        o.innerHTML += `<img style='position: absolute; z-index: -1; left: ${43*(co.x-1)}px; top: ${43*(8-co.y)}px; opacity: 0.4;' width='43px' height='43px' src='/res/chesspieces/${ps}/${turn+m[0]}.${ex}'>
            <svg style='position: absolute; z-index: -1; left: 0; top: 0;' width='344px' height='344px' viewBox='0, 0, 8, 8'><circle cx='${x}' cy='${y}' r='0.45' fill='transparent' opacity='0.4' stroke='${c}' stroke-width='${sw}' /></svg>`;
    } else {
        const c0 = gCoord(m.substring(0, 2)), c1 = gCoord(m.substring(2, 4));
        const x0 = 0.5 + (c0.x-1), y0 = 8 - (0.5 + (c0.y-1)), x1 = 0.5 + (c1.x-1), y1 = 8 - (0.5 + (c1.y-1));
        const dx = x1-x0, dy = y1-y0, d = Math.sqrt(dx*dx+dy*dy);
        const ax0 = x0+0.1*(dx/d), ay0 = y0+0.1*(dy/d), ax1 = x1-0.4*(dx/d), ay1 = y1-0.4*(dy/d);
        const mid = c.replace(/[ ,()]/g, '-');
        o.innerHTML += `<svg style='position: absolute; z-index: -1; left: 0; top: 0;' width='344px' height='344px' viewBox='0, 0, 8, 8'><defs><marker id='arrow-${mid}' markerWidth='13' markerHeight='13' refX='1' refY='7' orient='auto'><path d='M1,5.75 L3,7 L1,8.25' fill='${c}' /></marker></defs>
            <line x1='${ax0}' y1='${ay0}' x2='${ax1}' y2='${ay1}' stroke='${c}' fill='${c}' opacity='0.4' stroke-width='${sw}' marker-end='url(#arrow-${mid})'/></svg>`;
    }
}

async function dispatch_click_event(x, y) {
    if (config.python_autoplay_backend) await call_backend(`http://localhost:8080/performClick`, {x, y});
    else await request_debugger_click(x, y);
}

async function request_debugger_click(x, y) {
    const attach = (tid) => {
        const d = {tabId: tid};
        chrome.debugger.attach(d, '1.3', async () => {
            await new Promise(r => chrome.debugger.sendCommand(d, 'Input.dispatchMouseEvent', {type: 'mousePressed', button: 'left', clickCount: 1, x, y}, r));
            await new Promise(r => chrome.debugger.sendCommand(d, 'Input.dispatchMouseEvent', {type: 'mouseReleased', button: 'left', clickCount: 1, x, y}, r));
        });
    };
    if (targetTabId) attach(parseInt(targetTabId));
    else chrome.tabs.query({active: true, currentWindow: true}, (tabs) => { if (tabs[0]) attach(tabs[0].id); });
}

async function request_remote_configure(o) { return call_backend('http://localhost:9090/configure', o).then(res => res.json()); }
async function request_remote_analysis(f, t, m = null) { return call_backend('http://localhost:9090/analyse', {fen: f, moves: m, time: t}).then(res => res.json()); }
async function call_backend(url, d) { return fetch(url, {method: 'POST', credentials: 'include', cache: 'no-cache', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(d)}); }
function promise_timeout(t) { return new Promise(r => setTimeout(() => r(t), t)); }