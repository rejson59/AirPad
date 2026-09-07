import * as kart from './kart.js';
import * as soccer from './soccer.js';
import * as platformer from './platformer.js';
import * as bomber from './bomber.js';
import * as tanks from './tanks.js';
import * as quiz from './quiz.js';
import * as snake from './snake.js';
import * as paint from './paint.js';
import * as hole from './hole.js';
import * as sumo from './sumo.js';
import * as coins from './coins.js';
import * as space from './space.js';
import * as tron from './tron.js';

export const GAMES = [kart, soccer, platformer, bomber, quiz, hole, paint, snake, tanks, space, tron, sumo, coins];

export const EMOJI = {
  kart: '🏎️', soccer: '⚽', platformer: '🗼', bomber: '💣', quiz: '🧠', hole: '🕳️',
  paint: '🎨', snake: '🐍', tanks: '🛡️', space: '🚀', tron: '🏍️', sumo: '🥏', coins: '🪙',
};

export const CATS = ['Wszystkie', 'WYŚCIG', 'AKCJA', 'PARTY', 'KLASYK', 'ARCADE', 'DRUŻYNY', 'AREA', 'HIT', 'RETRO'];

export function byId(id) { return GAMES.find(g => g.meta.id === id); }
