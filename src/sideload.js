import { login as pd_login, getSideloads, uploadGame } from "./playdate.js";
import {
  login as itch_login,
  getGames,
  downloadGame,
  getGameDownloads,
} from "./itchio.js";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import fs from "fs-extra";

async function login() {
  const { pd, itch } = await fs.readJson("./credentials.json");
  await pd_login(pd.username, pd.password);
  const {
    key: { key },
  } = await itch_login(itch.username, itch.password);
  return key;
}

async function getPotentialPlaydateGameNames(page) {
  const response = await fetch(
    `https://itch.io/games/tag-playdate?page=${page}&format=json`
  );
  const { content, num_items } = await response.json();

  if (num_items === 0) {
    return [];
  }

  const dom = new JSDOM(content);
  const games = dom.window.document.querySelectorAll(`.game_cell_data`);
  const processedGames = [];
  for (let i = 0; i < games.length; i++) {
    const titleElement = games[i].querySelector(".title");
    processedGames.push(titleElement.textContent);
  }
  return processedGames;
}

async function getAllPotentialPlaydateGameNames() {
  const allNames = new Set();

  let loop = true;
  let page = 1;

  while (loop) {
    const names = await getPotentialPlaydateGameNames(page);
    if (names.length == 0) {
      loop = false;
    }
    names.forEach((name) => {
      allNames.add(name);
    });
    page++;
  }

  return allNames;
}

export async function sideload(message = console.log) {
  let exists = await fs.pathExists('log.json');
  if (!exists) {
    await fs.writeJson("log.json", {});
  }
  exists = await fs.pathExists('credentials.json');
  if (!exists) {
    throw new Error("You must create a credentials.json file!");
  }

  message("[System]", "Signing in");
  const [token, potentialGameNames] = await Promise.all([
    login(),
    getAllPotentialPlaydateGameNames(),
  ]);

  message("[System]", "Processing libraries");
  const [sideloads, { owned_keys: games }] = await Promise.all([
    getSideloads(),
    getGames(token),
  ]);
  const filteredGames = new Set(
    games.filter((o) => potentialGameNames.has(o.game.title))
  );

  const sideloaded = new Set();
  sideloads.forEach(({ title }) => {
    filteredGames.forEach((o) => {
      if (o.game.title.includes(title)) {
        sideloaded.add(o);
      }
    });
  });

  const needsSideload = new Set();
  filteredGames.forEach((o) => {
    if (!sideloaded.has(o)) {
      needsSideload.add(o);
    }
  });

  const stats = {
    added: 0,
    skipped: 0,
    updated: 0
  }

  const log = await fs.readJson("./log.json");
  if (sideloaded.size > 0) {
    for (const game of sideloaded) {
      const {
        uploads: [download],
      } = await getGameDownloads(game, token);
      if (
        log[game.game_id] &&
        log[game.game_id].md5_hash !== download.md5_hash
      ) {
        message(`[Update]`, game.game.title);
        const filename = await downloadGame(game, token);
        await uploadGame(filename);
        log[game.game_id] = download;
        stats.updated++;
      } else if (log[game.game_id] && log[game.game_id].md5_hash === download.md5_hash) {
        message(`[Skip]`, `(MD5 Matches)`, game.game.title);
        stats.skipped++;
      } else {
        message("[Sideload]", game.game.title);
        const {
          uploads: [download],
        } = await getGameDownloads(game, token);
        const filename = await downloadGame(game, token);
        await uploadGame(filename);
        log[game.game_id] = download;
        stats.added++;
      }
    }
  }

  if (needsSideload.size > 0) {
    for (const game of needsSideload) {
      message("[Sideload]", game.game.title);
      const {
        uploads: [download],
      } = await getGameDownloads(game, token);
      const filename = await downloadGame(game, token);
      await uploadGame(filename);
      log[game.game_id] = download;
      stats.added++;
    }
  }

  await fs.writeJson("log.json", log);
  message(`[Done]`, `(Added: ${stats.added})`, `(Updated: ${stats.updated})`, `(Skipped: ${stats.skipped})`);
}
