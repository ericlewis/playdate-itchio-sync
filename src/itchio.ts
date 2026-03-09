export interface ItchUpload {
  id: number;
  filename: string;
  display_name?: string;
  md5_hash: string;
  p_android?: boolean;
  p_windows?: boolean;
  p_linux?: boolean;
  p_osx?: boolean;
}

export interface ItchGame {
  id: number;
  game_id: number;
  game: {
    id: number;
    title: string;
  };
}

interface LoginResponse {
  key: { key: string };
}

interface UploadsResponse {
  uploads: ItchUpload[];
}

interface OwnedKeysResponse {
  owned_keys: ItchGame[];
}

interface DownloadSessionResponse {
  uuid: string;
}

export async function login(
  username: string,
  password: string,
): Promise<LoginResponse> {
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

  if (!response.ok) {
    throw new Error(`itch.io login failed (HTTP ${response.status})`);
  }

  return response.json();
}

async function getGamesPage(
  authorization: string,
  page: number,
): Promise<OwnedKeysResponse> {
  const response = await fetch(
    `https://api.itch.io/profile/owned-keys?page=${page}`,
    { headers: { authorization } },
  );
  return response.json();
}

export async function getGames(authorization: string): Promise<ItchGame[]> {
  const result: ItchGame[] = [];
  let page = 1;

  while (true) {
    const { owned_keys: games } = await getGamesPage(authorization, page);
    if (!Array.isArray(games) || games.length === 0) break;
    result.push(...games);
    page++;
  }

  return result;
}

export async function getGameDownloads(
  game: Pick<ItchGame, "game_id" | "id">,
  authorization: string,
): Promise<UploadsResponse> {
  const response = await fetch(
    `https://api.itch.io/games/${game.game_id}/uploads?download_key_id=${game.id}`,
    { headers: { authorization } },
  );
  return response.json();
}

export function findPlaydateUpload(
  uploads: ItchUpload[],
): ItchUpload | null {
  if (!uploads || uploads.length === 0) return null;
  if (uploads.length === 1) return uploads[0];

  // Match .pdx.zip first across all uploads so a Playdate build tagged with
  // desktop platform flags (e.g. p_windows) is never excluded
  const pdxZip = uploads.find((u) =>
    u.filename?.toLowerCase().endsWith(".pdx.zip"),
  );
  if (pdxZip) return pdxZip;

  // Then look for "playdate" in filename or display name across all uploads
  const playdateMatch = uploads.find(
    (u) =>
      u.filename?.toLowerCase().includes("playdate") ||
      u.display_name?.toLowerCase().includes("playdate"),
  );
  if (playdateMatch) return playdateMatch;

  // Fall back to platform filtering: Playdate isn't a recognized itch.io platform,
  // so Playdate uploads typically have no platform flags set
  const nonTagged = uploads.filter(
    (u) => !u.p_android && !u.p_windows && !u.p_linux && !u.p_osx,
  );
  const candidates = nonTagged.length > 0 ? nonTagged : uploads;

  return candidates[0];
}

export async function downloadGame(
  game: Pick<ItchGame, "game_id" | "id">,
  authorization: string,
  upload: ItchUpload,
): Promise<string> {
  const sessionResponse = await fetch(
    `https://api.itch.io/games/${game.game_id}/download-sessions`,
    { method: "POST", headers: { authorization } },
  );
  const session: DownloadSessionResponse = await sessionResponse.json();

  const downloadResponse = await fetch(
    `https://api.itch.io/uploads/${upload.id}/download?api_key=${authorization}&download_key_id=${game.id}&uuid=${session.uuid}`,
    { headers: { authorization } },
  );

  await Bun.write(upload.filename, downloadResponse);

  return upload.filename;
}
