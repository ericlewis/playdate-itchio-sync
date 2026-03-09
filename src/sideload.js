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
  try {
      await pd_login(pd.username, pd.password);
    const {
      key: { key },
    } = await itch_login(itch.username, itch.password);
    return key;
  } catch {
    await fs.remove(CRED_PATH);
    await enterCredentialsFlow();
  }
}

async function checkCredentialsExist() {
  const exists = await fs.pathExists(CRED_PATH);
  if (
    !exists &&
    !process.env.PD_USERNAME &&
    !process.env.PD_PASSWORD &&
    !process.env.ITCH_USERNAME &&
    !process.env.ITCH_PASSWORD
  ) {
    await enterCredentialsFlow();
  } else if (
    process.env.PD_USERNAME &&
    process.env.PD_PASSWORD &&
    process.env.ITCH_USERNAME &&
    process.env.ITCH_PASSWORD
  ) {
    await fs.writeJson(CRED_PATH, {
      pd: {
        username: process.env.PD_USERNAME,
        password: process.env.PD_PASSWORD,
      },
      itch: {
        username: process.env.ITCH_USERNAME,
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

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9 ]/gi, "").trim();
}

function getSignificantWords(str) {
  return normalize(str).split(/\s+/).filter((w) => w.length >= 3);
}

function titlesMatch(itchTitle, playdateTitle) {
  const a = itchTitle.toLowerCase();
  const b = playdateTitle.toLowerCase();

  // Exact match
  if (a === b) return true;

  // Bidirectional includes — only when the shorter string is long enough
  // to be meaningful (avoids short titles like "Go" matching everything)
  const MIN_SUBSTR_LEN = 4;
  if (a.length >= MIN_SUBSTR_LEN && b.includes(a)) return true;
  if (b.length >= MIN_SUBSTR_LEN && a.includes(b)) return true;

  // Bidirectional includes (spaces removed)
  const aNoSpaces = a.replaceAll(" ", "");
  const bNoSpaces = b.replaceAll(" ", "");
  if (aNoSpaces.length >= MIN_SUBSTR_LEN && bNoSpaces.includes(aNoSpaces))
    return true;
  if (bNoSpaces.length >= MIN_SUBSTR_LEN && aNoSpaces.includes(bNoSpaces))
    return true;

  // Bidirectional includes (alphanumeric only)
  const aNorm = normalize(itchTitle);
  const bNorm = normalize(playdateTitle);
  if (aNorm.length >= MIN_SUBSTR_LEN && bNorm.includes(aNorm)) return true;
  if (bNorm.length >= MIN_SUBSTR_LEN && aNorm.includes(bNorm)) return true;

  return false;
}

// Looser match: requires the first significant word (4+ chars) of each title
// to be the same. Game names lead with the actual title; subtitles and
// descriptors ("Demo", "Deluxe Edition") come after, so comparing leading
// words avoids false positives on generic terms.
// Only used on the small pool of unmatched candidates after strict matching.
function titlesFuzzyMatch(itchTitle, playdateTitle) {
  const firstA = getSignificantWords(itchTitle).find((w) => w.length >= 4);
  const firstB = getSignificantWords(playdateTitle).find((w) => w.length >= 4);
  return firstA != null && firstA === firstB;
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
  const [sideloads, games] = await Promise.all([
    getSideloads(),
    getGames(token),
  ]);
  const filteredGames = new Set(
    games.filter((o) => potentialGameNames.has(o.game.title))
  );

  // Pass 1: strict matching (bidirectional includes)
  const sideloaded = new Set();
  const matchedSideloads = new Set();
  sideloads.forEach((sideload) => {
    filteredGames.forEach((o) => {
      if (titlesMatch(o.game.title, sideload.title)) {
        sideloaded.add(o);
        matchedSideloads.add(sideload);
      }
    });
  });

  // Pass 2: fuzzy matching on only the unmatched remainders (small pool)
  const unmatchedGames = new Set();
  filteredGames.forEach((o) => {
    if (!sideloaded.has(o)) unmatchedGames.add(o);
  });
  const unmatchedSideloads = sideloads.filter((s) => !matchedSideloads.has(s));

  for (const { title } of unmatchedSideloads) {
    for (const o of unmatchedGames) {
      if (titlesFuzzyMatch(o.game.title, title)) {
        sideloaded.add(o);
        unmatchedGames.delete(o);
        break; // one sideload matches at most one game
      }
    }
  }

  const needsSideload = unmatchedGames;

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

