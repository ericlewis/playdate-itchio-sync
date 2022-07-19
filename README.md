# playdate-itchio-sync

Keep your Playdate sideload games synced with your itch.io playdate game library.

## Directions
1. Rename `credentials.example.json` to `credentials.json` and fill out the file appropriately.
2. Run `npm install`.
3. Run `npm start` - initial sync creates a log file to prevent useless sideloading between runs.
4. Have fun!

## Notes
- Will not work with accounts that use two-factor authentication on itch.io.
- You *must* set a password for your itch.io account, oAuth is not supported.
- You will probably want to run this every once in a while, it's not a background process.
- Use at your own risk!

## License
MIT, copyright 2022 Eric Lewis.