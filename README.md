# playdate-itchio-sync

Keep your Playdate sideload games synced with your itch.io playdate game library.

## Requirements
- [Bun](https://bun.sh) v1.0+

## Install

From npm:
```
bun install playdate-itchio-sync -g
```

From GitHub Packages:
```
npm install -g @<github-owner>/playdate-itchio-sync --registry=https://npm.pkg.github.com
```

## Directions
1. Run `syncpd`.
2. Follow the prompts for your credentials, they will be saved locally.
3. A sync will kick off.
4. You are done! From now on, just run `syncpd`, your credentials are saved.


## Release automation

Releases and package publishing are automated through `.github/workflows/release.yml`:

1. Create and push a version tag (for example `v3.1.0`).
2. GitHub Actions will:
   - install dependencies and run type checking
   - publish `playdate-itchio-sync` to npm
   - publish `@<github-owner>/playdate-itchio-sync` to GitHub Packages
   - create a GitHub release with generated notes

Repository secrets required:

- `NPM_TOKEN`: npm automation token with publish permission

## Environment Variables

You can also provide credentials via environment variables instead of the interactive prompt:

- `PD_USERNAME` — play.date account email
- `PD_PASSWORD` — play.date account password
- `ITCH_USERNAME` — itch.io username
- `ITCH_PASSWORD` — itch.io password

## Notes
- Will not work with accounts that use two-factor authentication on itch.io.
- You *must* set a password for your itch.io account, oAuth is not supported.
- Only works with games you have __paid for__ currently.
- You will probably want to run this every once in a while, it's not a background process.
- Use at your own risk!

## License
MIT, copyright 2022-2026 Eric Lewis.
