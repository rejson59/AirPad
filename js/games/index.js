import * as kart from './kart.js';
import * as tanks from './tanks.js';
import * as sumo from './sumo.js';
import * as coins from './coins.js';
import * as space from './space.js';
import * as tron from './tron.js';

export const GAMES = [kart, tanks, sumo, coins, space, tron];
export const EMOJI = { kart: '🏎️', tanks: '💥', sumo: '🥏', coins: '🪙', space: '🚀', tron: '🏍️' };
export function byId(id) { return GAMES.find(g => g.meta.id === id); }
