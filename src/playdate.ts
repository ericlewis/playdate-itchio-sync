import { JSDOM } from "jsdom";
import fetchCookie from "fetch-cookie";

const fetchWithCookies = fetchCookie(fetch);

export interface SideloadedGame {
  id: string;
  date: string;
  title: string;
  version: string;
}

async function getCSRF(url: string): Promise<string> {
  const response = await fetchWithCookies(url);
  const text = await response.text();
  const dom = new JSDOM(text);
  return dom.window.document
    .querySelector<HTMLInputElement>(`input[name="csrfmiddlewaretoken"]`)!
    .getAttribute("value")!;
}

export async function login(
  username: string,
  password: string,
): Promise<Response> {
  const token = await getCSRF("https://play.date/signin/");

  const body = new URLSearchParams();
  body.append("csrfmiddlewaretoken", token);
  body.append("username", username);
  body.append("password", password);

  const response = await fetchWithCookies("https://play.date/signin/", {
    body: body.toString(),
    method: "POST",
    headers: {
      Referer: "https://play.date/signin/",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    redirect: "manual",
  });

  // A successful login redirects away from /signin/. If we're still
  // on the sign-in page (200 with form), credentials were wrong.
  if (response.status === 200) {
    throw new Error("play.date login failed (invalid credentials)");
  }

  return response;
}

export async function getSideloads(): Promise<SideloadedGame[]> {
  const games: SideloadedGame[] = [];

  const response = await fetchWithCookies("https://play.date/account/sideload/");
  const text = await response.text();

  const dom = new JSDOM(text);
  const gameList = dom.window.document.querySelector("#sideloadGameList");

  if (!gameList) {
    throw new Error(
      "Could not find #sideloadGameList on play.date sideload page. " +
        "The page may have changed or the session may not be authenticated.",
    );
  }

  if (!gameList.children[0]?.children.length) {
    return games;
  }
  const children = gameList.children[0].children;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    let url = child.querySelector("a")!.getAttribute("href")!;

    if (url.startsWith("//play.date")) {
      url = "https:" + url;
    } else if (!url.startsWith("https://play.date")) {
      url = "https://play.date" + url;
    }

    const detailResponse = await fetchWithCookies(url);
    const detailText = await detailResponse.text();
    const detailDom = new JSDOM(detailText);
    const main = detailDom.window.document.querySelector("#main")!;
    const build = main.querySelector('dl[class="game-build"]')!;

    const id = main
      .querySelector('h2[class="sideloadGameTitle"]')!
      .querySelector("a")!
      .getAttribute("href")!
      .split("/")[3];
    const date = build
      .querySelector('dd[class="game-date"]')!
      .textContent!.trim();
    const title = main
      .querySelector('h2[class="sideloadGameTitle"]')!
      .textContent!.trim();
    const version = build
      .querySelector('dd[class="game-version"]')!
      .textContent!.trim();

    games.push({ id, date, title, version });
  }

  return games;
}

export async function uploadGame(path: string): Promise<Response> {
  const token = await getCSRF("https://play.date/account/sideload/");

  const body = new FormData();
  body.set("csrfmiddlewaretoken", token);
  body.set("file", Bun.file(path));

  const response = await fetchWithCookies("https://play.date/account/sideload/", {
    method: "POST",
    body,
    headers: {
      Referer: "https://play.date/account/sideload/",
    },
  });

  if (!response.ok) {
    throw new Error(`play.date upload failed (HTTP ${response.status})`);
  }

  return response;
}
