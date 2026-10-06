import './style.css';
import { Game } from './game/Game';

const app = document.getElementById('app')!;
const game = new Game(app);
// Handy for debugging in the browser console.
(window as unknown as { game: Game }).game = game;
