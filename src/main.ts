import './style.css';
import { Game } from './game/Game';
import { preloadImages } from './assets/loader';

const app = document.getElementById('app')!;
void preloadImages(['ui/key-art.jpg', 'ui/logo.png', 'ui/portrait-hero.png']);
const game = new Game(app);
// Handy for debugging in the browser console.
(window as unknown as { game: Game }).game = game;
