import { login as pd_login, getSideloads, uploadGame } from "./playdate.ts";
import {
  login as itch_login,
  getGames,
  downloadGame,
  getGameDownloads,
  findPlaydateUpload,
  type ItchGame,
} from "./itchio.ts";
import { PromisePool } from "@supercharge/promise-pool";
import { JSDOM } from "jsdom";
import { input, password } from "@inquirer/prompts";
import { homedir } from "node:os";
import { mkdir, exists, unlink } from "node:fs/promises";

const DATA_PATH = `${homedir()}/.pdsync`;
const LOG_PATH = `${DATA_PATH}/log.json`;
const CRED_PATH = `${DATA_PATH}/credentials.json`;

interface Credentials {
  pd: { username: string; password: string };
  itch: { username: string; password: string };
}

type LogFn = (...args: string[]) => void;

async function readJson<T>(path: string): Promise<T> {
  return Bun.file(path).json();
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(data, null, 2));
}

function hasEnvCredentials(): boolean {
  return !!(
    process.env.PD_USERNAME &&
    process.env.PD_PASSWORD &&
    process.env.ITCH_USERNAME &&
    process.env.ITCH_PASSWORD
  );
}

async function login(): Promise<string> {
  await checkCredentialsExist();

  const { pd, itch } = await readJson<Credentials>(CRED_PATH);
  try {
    await pd_login(pd.username, pd.password);
    const {
      key: { key },
    } = await itch_login(itch.username, itch.password);
    return key;
  } catch (err) {
    await unlink(CRED_PATH);
    if (hasEnvCredentials()) {
      throw new Error(
        "Authentication failed with credentials from environment variables.",
        { cause: err },
      );
    }
    await enterCredentialsFlow();
    return login();
  }
}

async function checkCredentialsExist(): Promise<void> {
  if (hasEnvCredentials()) {
    await writeJson(CRED_PATH, {
      pd: {
        username: process.env.PD_USERNAME!,
        password: process.env.PD_PASSWORD!,
      },
      itch: {
        username: process.env.ITCH_USERNAME!,
        password: process.env.ITCH_PASSWORD!,
      },
    });
    return;
  }

  if (!(await exists(CRED_PATH))) {
    await enterCredentialsFlow();
  }
}

async function enterCredentialsFlow(): Promise<void> {
  console.log("Your credentials are stored locally.");

  const pd_username = await input({ message: "play.date username:" });
  const pd_password = await password({
    message: "play.date password:",
    mask: "*",
  });
  const itch_username = await input({ message: "itch.io username:" });
  const itch_password = await password({
    message: "itch.io password:",
    mask: "*",
  });

  await writeJson(CRED_PATH, {
    pd: { username: pd_username, password: pd_password },
    itch: { username: itch_username, password: itch_password },
  });
}

async function getPotentialPlaydateGameNames(
  page: number,
): Promise<string[]> {
  const response = await fetch(
    `https://itch.io/games/tag-playdate?page=${page}&format=json`,
  );
  const { content, num_items } = (await response.json()) as {
    content: string;
    num_items: number;
  };

  if (num_items === 0) return [];

  const dom = new JSDOM(content);
  const games = dom.window.document.querySelectorAll(".game_cell_data");
  const processedGames: string[] = [];
  for (let i = 0; i < games.length; i++) {
    const titleElement = games[i].querySelector(".title");
    if (titleElement) processedGames.push(titleElement.textContent!);
  }
  return processedGames;
}

async function getAllPotentialPlaydateGameNames(): Promise<Set<string>> {
  const allNames = new Set<string>();
  let page = 1;

  while (true) {
    const names = await getPotentialPlaydateGameNames(page);
    if (names.length === 0) break;
    for (const name of names) allNames.add(name);
    page++;
  }

  return allNames;
}

export async function sideload(message: LogFn = console.log): Promise<void> {
  await mkdir(DATA_PATH, { recursive: true });

  if (!(await exists(LOG_PATH))) {
    await writeJson(LOG_PATH, {});
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
    games.filter((o) => potentialGameNames.has(o.game.title)),
  );

  const sideloaded = new Set<ItchGame>();
  for (const { title } of sideloads) {
    for (const o of filteredGames) {
      const gameTitle = o.game.title.toLowerCase();
      const sideloadTitle = title.toLowerCase();
      if (
        gameTitle.includes(sideloadTitle) ||
        gameTitle.includes(sideloadTitle.replaceAll(" ", "")) ||
        gameTitle
          .replace(/[^a-z0-9 ]/gi, "")
          .includes(sideloadTitle.replace(/[^a-z0-9 ]/gi, ""))
      ) {
        sideloaded.add(o);
      }
    }
  }

  const needsSideload = new Set<ItchGame>();
  for (const o of filteredGames) {
    if (!sideloaded.has(o)) needsSideload.add(o);
  }

  const stats = { added: 0, skipped: 0, updated: 0 };
  const log = await readJson<Record<string, { md5_hash: string }>>(LOG_PATH);

  const processGame = async (game: ItchGame, isNew: boolean) => {
    const { uploads } = await getGameDownloads(game, token);
    const download = findPlaydateUpload(uploads);

    if (!download) {
      message("[Skip]", "(No uploads)", game.game.title);
      stats.skipped++;
      return;
    }

    if (
      !isNew &&
      log[game.game_id] &&
      log[game.game_id].md5_hash === download.md5_hash
    ) {
      message("[Skip]", "(MD5 Matches)", game.game.title);
      stats.skipped++;
      return;
    }

    if (!isNew && log[game.game_id]) {
      message("[Update]", game.game.title);
    } else {
      message("[Sideload]", game.game.title);
    }

    const filename = await downloadGame(game, token, download);
    try {
      await uploadGame(filename);
    } finally {
      await unlink(filename);
    }
    if (!isNew && log[game.game_id]) {
      stats.updated++;
    } else {
      stats.added++;
    }
    log[game.game_id] = download;
  };

  await PromisePool.for(Array.from(sideloaded))
    .withConcurrency(6)
    .handleError((err, game) => {
      message("[Error]", game.game.title, String(err));
    })
    .process((game) => processGame(game, false));

  for (const game of needsSideload) {
    try {
      await processGame(game, true);
    } catch (err) {
      message("[Error]", game.game.title, String(err));
    }
  }

  await writeJson(LOG_PATH, log);
  message(
    "[Done]",
    `(Added: ${stats.added})`,
    `(Updated: ${stats.updated})`,
    `(Skipped: ${stats.skipped})`,
  );
}
