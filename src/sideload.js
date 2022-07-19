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
  const exists = await fs.pathExists('./log.json');

  if (!exists) {
    await fs.writeJson("./log.json", {});
  }

  message("Logging in...");
  const [token, potentialGameNames] = await Promise.all([
    login(),
    getAllPotentialPlaydateGameNames(),
  ]);

  message("Sideloading games...");
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
        message(`Sideloading ${game.game.title}...`);
        const filename = await downloadGame(game, token);
        await uploadGame(filename);
        log[game.game_id] = download;
      } else {
        message(`Skipping ${game.game.title}.`);
      }
    }
  }

  if (needsSideload.size > 0) {
    for (const game of needsSideload) {
      message(`Sideloading ${game.game.title}...`);
      const {
        uploads: [download],
      } = await getGameDownloads(game, token);
      const filename = await downloadGame(game, token);
      await uploadGame(filename);
      log[game.game_id] = download;
    }
  }

  await fs.writeJson("./log.json", log);
  message("Done!");
}
