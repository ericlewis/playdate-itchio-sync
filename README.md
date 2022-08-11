# playdate-itchio-sync

Keep your Playdate sideload games synced with your itch.io playdate game library.

## Requirements
- node.js 16+

## Install
```
npm install playdate-itchio-sync -g
```

## Directions
1. Run `syncpd`.
2. Follow the prompts for your credentials, they will be saved locally.
3. A sync will kick off.
4. You are done! From now on, just run `syncpd`.

## Notes
- Will not work with accounts that use two-factor authentication on itch.io.
- You *must* set a password for your itch.io account, oAuth is not supported.
- Only works with games you have __paid for__ currently.
- You will probably want to run this every once in a while, it's not a background process.
- Use at your own risk!

## License
MIT, copyright 2022 Eric Lewis.