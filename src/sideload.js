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
import inquirer from "inquirer";
import os from "os";
import { PromisePool } from "@supercharge/promise-pool";

const DATA_PATH = `${os.homedir()}/.pdsync`;
const LOG_PATH = `${DATA_PATH}/log.json`;
const CRED_PATH = `${DATA_PATH}/credentials.json`;

async function login() {
  await checkCredentialsExist();

  const { pd, itch } = await fs.readJson(CRED_PATH);
  await pd_login(pd.username, pd.password);
  const {
    key: { key },
  } = await itch_login(itch.username, itch.password);
  return key;
}

async function checkCredentialsExist() {
  const exists = await fs.pathExists(CRED_PATH);
  if (
    !exists &&
    !process.env.PD_EMAIL &&
    !process.env.PD_PASSWORD &&
    !process.env.ITCH_EMAIL &&
    !process.env.ITCH_PASSWORD
  ) {
    await enterCredentialsFlow();
  } else if (
    process.env.PD_EMAIL &&
    process.env.PD_PASSWORD &&
    process.env.ITCH_EMAIL &&
    process.env.ITCH_PASSWORD
  ) {
    await fs.writeJson(CRED_PATH, {
      pd: {
        username: process.env.PD_EMAIL,
        password: process.env.PD_PASSWORD,
      },
      itch: {
        username: process.env.ITCH_EMAIL,
        password: process.env.ITCH_PASSWORD,
      },
    });
  }
}

async function enterCredentialsFlow() {
  console.log("Your credentials are stored locally.");
  const results = await inquirer.prompt([
    {
      type: "input",
      name: "pd_username",
      message: "play.date username:",
    },
    {
      type: "password",
      name: "pd_password",
      message: "play.date password:",
      mask: "*",
    },
    {
      type: "input",
      name: "itch_email",
      message: "itch.io username:",
    },
    {
      type: "password",
      name: "itch_password",
      message: "itch.io password:",
      mask: "*",
    },
  ]);

  await fs.writeJson(CRED_PATH, {
    pd: {
      username: results.pd_username,
      password: results.pd_password,
    },
    itch: {
      username: results.itch_email,
      password: results.itch_password,
    },
  });
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
  let exists = await fs.pathExists(DATA_PATH);
  if (!exists) {
    await fs.mkdir(DATA_PATH);
  }

  exists = await fs.pathExists(LOG_PATH);
  if (!exists) {
    await fs.writeJson(LOG_PATH, {});
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
      if (o.game.title.toLowerCase().includes(title.toLowerCase())) {
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
    updated: 0,
  };

  const log = await fs.readJson(LOG_PATH);
  if (sideloaded.size > 0) {
    await PromisePool.for(Array.from(sideloaded))
      .withConcurrency(6)
      .process(async (game) => {
        const {
          uploads: [download],
        } = await getGameDownloads(game, token);
        if (
          log[game.game_id] &&
          log[game.game_id].md5_hash !== download.md5_hash
        ) {
          message(`[Update]`, game.game.title);
          const filename = await downloadGame(game, token);
          try {
            await uploadGame(filename);
          } finally {
            await fs.remove(filename);
          }
          log[game.game_id] = download;
          stats.updated++;
        } else if (
          log[game.game_id] &&
          log[game.game_id].md5_hash === download.md5_hash
        ) {
          message(`[Skip]`, `(MD5 Matches)`, game.game.title);
          stats.skipped++;
        } else {
          message("[Sideload]", game.game.title);
          const {
            uploads: [download],
          } = await getGameDownloads(game, token);
          const filename = await downloadGame(game, token);
          try {
            await uploadGame(filename);
          } finally {
            await fs.remove(filename);
          }
          log[game.game_id] = download;
          stats.added++;
        }
      });
  }

  if (needsSideload.size > 0) {
    for (const game of needsSideload) {
      message("[Sideload]", game.game.title);
      const {
        uploads: [download],
      } = await getGameDownloads(game, token);
      const filename = await downloadGame(game, token);
      try {
        await uploadGame(filename);
      } finally {
        await fs.remove(filename);
      }
      log[game.game_id] = download;
      stats.added++;
    }
  }

  await fs.writeJson(LOG_PATH, log);
  message(
    `[Done]`,
    `(Added: ${stats.added})`,
    `(Updated: ${stats.updated})`,
    `(Skipped: ${stats.skipped})`
  );
}

