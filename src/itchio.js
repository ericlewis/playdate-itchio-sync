import fetch from "node-fetch";
import fs from "fs";

export async function login(username, password) {
  const params = new URLSearchParams();
  params.append("username", username);
  params.append("password", password);
  params.append("source", "desktop");

  const response = await fetch("https://api.itch.io/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  return response.json();
}

export async function getGames(authorization) {
  const response = await fetch("https://api.itch.io/profile/owned-keys", {
    headers: {
      authorization,
    },
  });
  return response.json();
}

export async function getGameDownloads(game, authorization) {
  const { game_id, id } = game;
  const response = await fetch(
    `https://api.itch.io/games/${game_id}/uploads?download_key_id=${id}`,
    {
      headers: {
        authorization,
      },
    }
  );
  return response.json();
}

export async function downloadGame(game, authorization) {
  const { game_id, id } = game;
  const {
    uploads: [upload],
  } = await getGameDownloads(
    {
      game_id,
      id,
    },
    authorization
  );
  let response = await fetch(
    `https://api.itch.io/games/${game_id}/download-sessions`,
    {
      method: "POST",
      headers: {
        authorization,
      },
    }
  );
  response = await response.json();
  response = await fetch(
    `https://api.itch.io/uploads/${upload.id}/download?api_key=${authorization}&download_key_id=${id}&uuid=${response.uuid}`,
    {
      headers: {
        authorization,
      },
    }
  );
  const fileStream = fs.createWriteStream(upload.filename);
  await new Promise((resolve, reject) => {
    response.body.pipe(fileStream);
    response.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
  return upload.filename;
}

