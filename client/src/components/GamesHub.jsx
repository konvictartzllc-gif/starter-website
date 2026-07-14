import { useState, useCallback } from "react";
import { api } from "../utils/api";

// ─── Checkers ────────────────────────────────────────────────────────────────

const EMPTY = null;
const LIGHT = "l";
const DARK = "d";
const LIGHT_KING = "L";
const DARK_KING = "D";

function initCheckersBoard() {
  const board = Array(8).fill(null).map(() => Array(8).fill(EMPTY));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = DARK;
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = LIGHT;
    }
  }
  return board;
}

function isLight(p) { return p === LIGHT || p === LIGHT_KING; }
function isDark(p) { return p === DARK || p === DARK_KING; }
function isKing(p) { return p === LIGHT_KING || p === DARK_KING; }

function getCheckersJumps(board, r, c, piece, visited = new Set()) {
  const moves = [];
  const dirs = [];
  if (isLight(piece) || isKing(piece)) dirs.push([-1, -1], [-1, 1]);
  if (isDark(piece) || isKing(piece)) dirs.push([1, -1], [1, 1]);

  for (const [dr, dc] of dirs) {
    const mr = r + dr, mc = c + dc;
    const lr = r + 2 * dr, lc = c + 2 * dc;
    if (lr < 0 || lr > 7 || lc < 0 || lc > 7) continue;
    const mid = board[mr]?.[mc];
    if (!mid) continue;
    if (isLight(piece) && !isDark(mid)) continue;
    if (isDark(piece) && !isLight(mid)) continue;
    if (board[lr][lc] !== EMPTY) continue;
    const key = `${lr},${lc}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const newBoard = board.map((row) => [...row]);
    newBoard[r][c] = EMPTY;
    newBoard[mr][mc] = EMPTY;
    newBoard[lr][lc] = piece;
    const subJumps = getCheckersJumps(newBoard, lr, lc, piece, visited);
    if (subJumps.length > 0) {
      subJumps.forEach((sub) => moves.push({ path: [[r, c], [mr, mc], ...sub.path.slice(1)], captured: [[mr, mc], ...sub.captured] }));
    } else {
      moves.push({ path: [[r, c], [lr, lc]], captured: [[mr, mc]] });
    }
    visited.delete(key);
  }
  return moves;
}

function getCheckersSimpleMoves(board, r, c, piece) {
  const moves = [];
  const dirs = [];
  if (isLight(piece) || isKing(piece)) dirs.push([-1, -1], [-1, 1]);
  if (isDark(piece) || isKing(piece)) dirs.push([1, -1], [1, 1]);
  for (const [dr, dc] of dirs) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
    if (board[nr][nc] === EMPTY) moves.push({ path: [[r, c], [nr, nc]], captured: [] });
  }
  return moves;
}

function getAllMoves(board, isLightTurn) {
  const jumps = [];
  const simples = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      if (isLightTurn && !isLight(p)) continue;
      if (!isLightTurn && !isDark(p)) continue;
      const j = getCheckersJumps(board, r, c, p);
      jumps.push(...j);
      const s = getCheckersSimpleMoves(board, r, c, p);
      simples.push(...s);
    }
  }
  return jumps.length > 0 ? jumps : simples;
}

function applyCheckersMove(board, move) {
  const newBoard = board.map((row) => [...row]);
  const path = move.path;
  const [fr, fc] = path[0];
  const [tr, tc] = path[path.length - 1];
  let piece = newBoard[fr][fc];
  newBoard[fr][fc] = EMPTY;
  for (const [cr, cc] of move.captured) newBoard[cr][cc] = EMPTY;
  if (isLight(piece) && tr === 0) piece = LIGHT_KING;
  if (isDark(piece) && tr === 7) piece = DARK_KING;
  newBoard[tr][tc] = piece;
  return newBoard;
}

function checkersScore(board) {
  let score = 0;
  for (const row of board) {
    for (const p of row) {
      if (p === LIGHT) score++;
      else if (p === LIGHT_KING) score += 2;
      else if (p === DARK) score--;
      else if (p === DARK_KING) score -= 2;
    }
  }
  return score;
}

function minimax(board, depth, isMaximizing, alpha, beta) {
  const moves = getAllMoves(board, isMaximizing);
  if (depth === 0 || moves.length === 0) return checkersScore(board);

  if (isMaximizing) {
    let best = -Infinity;
    for (const move of moves) {
      const nb = applyCheckersMove(board, move);
      best = Math.max(best, minimax(nb, depth - 1, false, alpha, beta));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of moves) {
      const nb = applyCheckersMove(board, move);
      best = Math.min(best, minimax(nb, depth - 1, true, alpha, beta));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function bestDexCheckersMove(board) {
  const moves = getAllMoves(board, false);
  if (!moves.length) return null;
  let best = Infinity, bestMove = moves[0];
  for (const move of moves) {
    const nb = applyCheckersMove(board, move);
    const score = minimax(nb, 4, true, -Infinity, Infinity);
    if (score < best) { best = score; bestMove = move; }
  }
  return bestMove;
}

const DEX_CHECKERS_COMMENTS = [
  "Smart move, but I see a few steps ahead.",
  "I like your style. Here is mine.",
  "Your pressure is building. So is mine.",
  "Good game so far. Let me respond.",
  "That was clever. Now watch this.",
  "I have been waiting for that move.",
  "You are getting better. Keep it up.",
  "Nice! My turn.",
];

function CheckersGame() {
  const [board, setBoard] = useState(initCheckersBoard);
  const [selected, setSelected] = useState(null);
  const [isLightTurn, setIsLightTurn] = useState(true);
  const [validMoves, setValidMoves] = useState([]);
  const [dexComment, setDexComment] = useState("I go first after you. Light pieces move up. You are light!");
  const [gameOver, setGameOver] = useState(null);
  const [dexThinking, setDexThinking] = useState(false);
  const [moveHistory, setMoveHistory] = useState([]);

  function getMovesFromCell(b, r, c) {
    const p = b[r][c];
    if (!p) return [];
    const allMoves = getAllMoves(b, isLightTurn);
    return allMoves.filter((m) => m.path[0][0] === r && m.path[0][1] === c);
  }

  function handleCellClick(r, c) {
    if (!isLightTurn || dexThinking || gameOver) return;
    const cell = board[r][c];

    if (selected) {
      const move = validMoves.find((m) => m.path[m.path.length - 1][0] === r && m.path[m.path.length - 1][1] === c);
      if (move) {
        const nb = applyCheckersMove(board, move);
        const hist = [...moveHistory, `${selected[0]},${selected[1]}->${r},${c}`];
        setBoard(nb);
        setSelected(null);
        setValidMoves([]);
        setMoveHistory(hist);

        const darkLeft = nb.flat().some(isDark);
        if (!darkLeft) { setGameOver("You won! Dex ran out of pieces."); return; }

        setIsLightTurn(false);
        setDexThinking(true);

        setTimeout(() => {
          const dexMove = bestDexCheckersMove(nb);
          if (!dexMove) { setGameOver("You won! Dex has no moves left."); setDexThinking(false); return; }
          const nb2 = applyCheckersMove(nb, dexMove);
          setBoard(nb2);
          setDexComment(DEX_CHECKERS_COMMENTS[Math.floor(Math.random() * DEX_CHECKERS_COMMENTS.length)]);
          setMoveHistory([...hist, `dex:${dexMove.path[0][0]},${dexMove.path[0][1]}->${dexMove.path[dexMove.path.length - 1][0]},${dexMove.path[dexMove.path.length - 1][1]}`]);
          const lightLeft = nb2.flat().some(isLight);
          if (!lightLeft) { setGameOver("Dex wins! No light pieces remain."); }
          setIsLightTurn(true);
          setDexThinking(false);
        }, 600);
        return;
      }
      setSelected(null);
      setValidMoves([]);
    }

    if (cell && isLight(cell)) {
      const moves = getMovesFromCell(board, r, c);
      if (moves.length > 0) {
        setSelected([r, c]);
        setValidMoves(moves);
      }
    }
  }

  function resetGame() {
    setBoard(initCheckersBoard());
    setSelected(null);
    setValidMoves([]);
    setIsLightTurn(true);
    setDexComment("New game! You are light pieces. Make your move.");
    setGameOver(null);
    setDexThinking(false);
    setMoveHistory([]);
  }

  const validDests = validMoves.map((m) => {
    const last = m.path[m.path.length - 1];
    return `${last[0]},${last[1]}`;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-300 font-semibold">
            {gameOver ? "Game Over" : dexThinking ? "Dex is thinking..." : isLightTurn ? "Your turn (light ○)" : "Dex's turn"}
          </p>
          <p className="text-xs text-gray-500 mt-1 italic">"{dexComment}"</p>
        </div>
        <button
          type="button"
          onClick={resetGame}
          className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:border-gray-500"
        >
          New Game
        </button>
      </div>
      {gameOver && (
        <div className="rounded-md bg-brand/20 border border-brand/40 px-4 py-3 text-sm text-white font-semibold">
          {gameOver}
        </div>
      )}
      <div className="inline-block border border-gray-700 rounded-lg overflow-hidden">
        {board.map((row, r) => (
          <div key={r} className="flex">
            {row.map((cell, c) => {
              const isDark_ = (r + c) % 2 === 1;
              const isSelected = selected && selected[0] === r && selected[1] === c;
              const isValidDest = isDark_ && validDests.includes(`${r},${c}`);
              return (
                <div
                  key={c}
                  onClick={() => isDark_ && handleCellClick(r, c)}
                  className={`w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center cursor-pointer select-none
                    ${isDark_ ? "bg-gray-700" : "bg-gray-300"}
                    ${isSelected ? "ring-2 ring-brand ring-inset" : ""}
                    ${isValidDest ? "ring-2 ring-green-400 ring-inset" : ""}
                  `}
                >
                  {cell && (
                    <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold
                      ${isLight(cell) ? "bg-white border-gray-400 text-gray-700" : "bg-gray-900 border-gray-600 text-white"}
                    `}>
                      {isKing(cell) ? "♔" : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">Click one of your pieces, then click where to move it. Jumps are mandatory.</p>
    </div>
  );
}

// ─── Chess ────────────────────────────────────────────────────────────────────

const CHESS_PIECES = {
  wK: "♔", wQ: "♕", wR: "♖", wB: "♗", wN: "♘", wP: "♙",
  bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟",
};

function initChessBoard() {
  const b = Array(8).fill(null).map(() => Array(8).fill(null));
  const order = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  for (let c = 0; c < 8; c++) {
    b[0][c] = `b${order[c]}`;
    b[1][c] = "bP";
    b[6][c] = "wP";
    b[7][c] = `w${order[c]}`;
  }
  return b;
}

function isWhite(p) { return p?.startsWith("w"); }
function isBlack(p) { return p?.startsWith("b"); }

function getChessColor(p) {
  if (!p) return null;
  return p[0];
}

function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function slideMoves(board, r, c, dirs, color) {
  const moves = [];
  for (const [dr, dc] of dirs) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const target = board[nr][nc];
      if (!target) { moves.push([nr, nc]); }
      else {
        if (getChessColor(target) !== color) moves.push([nr, nc]);
        break;
      }
      nr += dr; nc += dc;
    }
  }
  return moves;
}

function getChessMoves(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const color = getChessColor(piece);
  const type = piece[1];
  const moves = [];

  if (type === "P") {
    const dir = color === "w" ? -1 : 1;
    const startRow = color === "w" ? 6 : 1;
    if (inBounds(r + dir, c) && !board[r + dir][c]) {
      moves.push([r + dir, c]);
      if (r === startRow && !board[r + 2 * dir][c]) moves.push([r + 2 * dir, c]);
    }
    for (const dc of [-1, 1]) {
      if (inBounds(r + dir, c + dc) && board[r + dir][c + dc] && getChessColor(board[r + dir][c + dc]) !== color)
        moves.push([r + dir, c + dc]);
    }
  } else if (type === "R") {
    moves.push(...slideMoves(board, r, c, [[-1,0],[1,0],[0,-1],[0,1]], color));
  } else if (type === "B") {
    moves.push(...slideMoves(board, r, c, [[-1,-1],[-1,1],[1,-1],[1,1]], color));
  } else if (type === "Q") {
    moves.push(...slideMoves(board, r, c, [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]], color));
  } else if (type === "N") {
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      if (inBounds(r+dr, c+dc) && getChessColor(board[r+dr][c+dc]) !== color) moves.push([r+dr, c+dc]);
    }
  } else if (type === "K") {
    for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      if (inBounds(r+dr, c+dc) && getChessColor(board[r+dr][c+dc]) !== color) moves.push([r+dr, c+dc]);
    }
  }
  return moves;
}

function applyChessMove(board, fr, fc, tr, tc) {
  const nb = board.map((row) => [...row]);
  let piece = nb[fr][fc];
  nb[fr][fc] = null;
  if (piece === "wP" && tr === 0) piece = "wQ";
  if (piece === "bP" && tr === 7) piece = "bQ";
  nb[tr][tc] = piece;
  return nb;
}

function boardToString(board) {
  return board.map((row) => row.map((cell) => cell || ".").join(" ")).join("\n");
}

const DEX_CHESS_COMMENTS = [
  "Interesting choice. Let me think...",
  "I see your plan. Here is my counter.",
  "Your development is solid. So is mine.",
  "Watch your queen's flank.",
  "That opens up the center nicely.",
  "Good positional play. My response.",
  "I like the pressure you are applying.",
  "Your king is safe for now.",
];

function ChessGame() {
  const [board, setBoard] = useState(initChessBoard);
  const [selected, setSelected] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [isWhiteTurn, setIsWhiteTurn] = useState(true);
  const [dexComment, setDexComment] = useState("You play White. Make the first move!");
  const [dexThinking, setDexThinking] = useState(false);
  const [gameOver, setGameOver] = useState(null);
  const [moveHistory, setMoveHistory] = useState([]);
  const [useAI, setUseAI] = useState(true);

  const dexMoveLocal = useCallback((nb, hist) => {
    const allMoves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (isBlack(nb[r][c])) {
          const ms = getChessMoves(nb, r, c);
          ms.forEach((m) => allMoves.push({ fr: r, fc: c, tr: m[0], tc: m[1] }));
        }
      }
    }
    if (!allMoves.length) { setGameOver("You win! Dex has no moves."); setDexThinking(false); return; }
    const captures = allMoves.filter((m) => nb[m.tr][m.tc]);
    const pool = captures.length > 0 ? captures : allMoves;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const nb2 = applyChessMove(nb, pick.fr, pick.fc, pick.tr, pick.tc);
    const wKing = nb2.flat().find((p) => p === "wK");
    setBoard(nb2);
    setDexComment(DEX_CHESS_COMMENTS[Math.floor(Math.random() * DEX_CHESS_COMMENTS.length)]);
    setMoveHistory([...hist, `b:${pick.fr},${pick.fc}->${pick.tr},${pick.tc}`]);
    if (!wKing) { setGameOver("Dex wins! Your king was captured."); }
    setIsWhiteTurn(true);
    setDexThinking(false);
  }, []);

  async function dexMoveAPI(nb, hist) {
    try {
      const data = await api.dexChessMove({ board: nb, history: hist });
      const moveStr = (data.move || "").trim();
      const comment = data.comment || "Your move.";

      const fileMap = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 };
      let parsed = null;

      // Handle castling O-O or O-O-O (black, row 0)
      if (moveStr === "O-O" || moveStr === "0-0") {
        if (nb[0][4] === "bK" && nb[0][7] === "bR" && !nb[0][5] && !nb[0][6]) {
          const nb2 = nb.map((row) => [...row]);
          nb2[0][4] = null; nb2[0][7] = null;
          nb2[0][6] = "bK"; nb2[0][5] = "bR";
          setBoard(nb2);
          setDexComment(comment);
          setMoveHistory([...hist, "b:castle-short"]);
          const wKing = nb2.flat().find((p) => p === "wK");
          if (!wKing) setGameOver("Dex wins! Your king was captured.");
          setIsWhiteTurn(true);
          setDexThinking(false);
          return;
        }
      }
      if (moveStr === "O-O-O" || moveStr === "0-0-0") {
        if (nb[0][4] === "bK" && nb[0][0] === "bR" && !nb[0][1] && !nb[0][2] && !nb[0][3]) {
          const nb2 = nb.map((row) => [...row]);
          nb2[0][4] = null; nb2[0][0] = null;
          nb2[0][2] = "bK"; nb2[0][3] = "bR";
          setBoard(nb2);
          setDexComment(comment);
          setMoveHistory([...hist, "b:castle-long"]);
          const wKing = nb2.flat().find((p) => p === "wK");
          if (!wKing) setGameOver("Dex wins! Your king was captured.");
          setIsWhiteTurn(true);
          setDexThinking(false);
          return;
        }
      }

      // Parse standard algebraic notation
      // Strip check/checkmate indicators
      const cleanMove = moveStr.replace(/[+#!?]/g, "");

      // Piece type prefix: K, Q, R, B, N or pawn (no prefix)
      const pieceTypeMap = { K: "K", Q: "Q", R: "R", B: "B", N: "N" };
      const pieceMatch = cleanMove.match(/^([KQRBN])?([a-h])?([1-8])?x?([a-h])([1-8])(?:=([QRBN]))?$/);

      if (pieceMatch) {
        const pieceChar = pieceMatch[1] || "P"; // no prefix = pawn
        const disambigFile = pieceMatch[2]; // optional from-file
        const disambigRank = pieceMatch[3]; // optional from-rank
        const toFile = pieceMatch[4];
        const toRank = pieceMatch[5];
        const tc = fileMap[toFile];
        const tr = 8 - parseInt(toRank);
        const pieceCode = `b${pieceTypeMap[pieceChar] || "P"}`;

        // Find matching black piece that can legally move to (tr, tc)
        const candidates = [];
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            if (nb[r][c] !== pieceCode) continue;
            if (disambigFile && fileMap[disambigFile] !== c) continue;
            if (disambigRank && (8 - parseInt(disambigRank)) !== r) continue;
            const moves = getChessMoves(nb, r, c);
            if (moves.some(([mr, mc]) => mr === tr && mc === tc)) {
              candidates.push({ fr: r, fc: c, tr, tc });
            }
          }
        }

        if (candidates.length > 0) parsed = candidates[0];
      }

      if (parsed) {
        const nb2 = applyChessMove(nb, parsed.fr, parsed.fc, parsed.tr, parsed.tc);
        const wKing = nb2.flat().find((p) => p === "wK");
        setBoard(nb2);
        setDexComment(comment);
        setMoveHistory([...hist, `b:${parsed.fr},${parsed.fc}->${parsed.tr},${parsed.tc}`]);
        if (!wKing) setGameOver("Dex wins! Your king was captured.");
        setIsWhiteTurn(true);
      } else {
        dexMoveLocal(nb, hist);
      }
    } catch {
      dexMoveLocal(nb, hist);
    } finally {
      setDexThinking(false);
    }
  }

  function handleCellClick(r, c) {
    if (!isWhiteTurn || dexThinking || gameOver) return;
    const cell = board[r][c];

    if (selected) {
      const isValid = validMoves.some(([mr, mc]) => mr === r && mc === c);
      if (isValid) {
        const nb = applyChessMove(board, selected[0], selected[1], r, c);
        const bKing = nb.flat().find((p) => p === "bK");
        const hist = [...moveHistory, `w:${selected[0]},${selected[1]}->${r},${c}`];
        setBoard(nb);
        setSelected(null);
        setValidMoves([]);
        setMoveHistory(hist);
        if (!bKing) { setGameOver("You win! Dex's king was captured."); return; }
        setIsWhiteTurn(false);
        setDexThinking(true);
        setTimeout(() => {
          if (useAI) dexMoveAPI(nb, hist);
          else dexMoveLocal(nb, hist);
        }, 500);
        return;
      }
      setSelected(null);
      setValidMoves([]);
    }

    if (cell && isWhite(cell)) {
      const moves = getChessMoves(board, r, c);
      if (moves.length > 0) { setSelected([r, c]); setValidMoves(moves); }
    }
  }

  function resetGame() {
    setBoard(initChessBoard());
    setSelected(null);
    setValidMoves([]);
    setIsWhiteTurn(true);
    setDexComment("New game! You are White. Make your move.");
    setGameOver(null);
    setDexThinking(false);
    setMoveHistory([]);
  }

  const validSet = new Set(validMoves.map(([r, c]) => `${r},${c}`));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-300 font-semibold">
            {gameOver ? "Game Over" : dexThinking ? "Dex is thinking..." : isWhiteTurn ? "Your turn (White)" : "Dex's turn (Black)"}
          </p>
          <p className="text-xs text-gray-500 mt-1 italic">"{dexComment}"</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetGame}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:border-gray-500"
          >
            New Game
          </button>
        </div>
      </div>
      {gameOver && (
        <div className="rounded-md bg-brand/20 border border-brand/40 px-4 py-3 text-sm text-white font-semibold">
          {gameOver}
        </div>
      )}
      <div className="inline-block border border-gray-700 rounded-lg overflow-hidden">
        {board.map((row, r) => (
          <div key={r} className="flex">
            {row.map((cell, c) => {
              const lightSq = (r + c) % 2 === 0;
              const isSelected = selected && selected[0] === r && selected[1] === c;
              const isValid = validSet.has(`${r},${c}`);
              return (
                <div
                  key={c}
                  onClick={() => handleCellClick(r, c)}
                  className={`w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center cursor-pointer select-none text-xl sm:text-2xl
                    ${lightSq ? "bg-amber-100" : "bg-amber-800"}
                    ${isSelected ? "ring-2 ring-brand ring-inset" : ""}
                    ${isValid ? "ring-2 ring-green-400 ring-inset" : ""}
                  `}
                >
                  {cell ? CHESS_PIECES[cell] || cell : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">Click a white piece, then click where to move it. Pawns promote to queens automatically.</p>
    </div>
  );
}

// ─── GamesHub ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: "checkers", label: "Checkers" },
  { id: "chess", label: "Chess" },
];

export default function GamesHub() {
  const [activeTab, setActiveTab] = useState("checkers");

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Games with Dex</h2>
        <p className="text-sm text-gray-400">Challenge Dex to a game of Checkers or Chess. Dex plays to win.</p>
      </div>
      <div className="flex gap-2 border-b border-gray-800 pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px
              ${activeTab === tab.id ? "border-brand text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === "checkers" && <CheckersGame />}
      {activeTab === "chess" && <ChessGame />}
    </section>
  );
}
