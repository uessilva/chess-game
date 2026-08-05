import { START_FEN } from './core';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.textContent = `chess-game — core ready: ${START_FEN}`;
}
