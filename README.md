# CraftRank Launcher

A free Minecraft launcher for Windows, made for [craftrank.org](https://craftrank.org).

- Every Minecraft version, plus OptiFine, ForgeOptiFine, Forge, Fabric, Quilt and NeoForge in one click
- Join servers from the CraftRank list with one click
- Fast downloads checked against Mojang's hashes
- Run your own Paper, Purpur, Vanilla, BungeeCord or Velocity server

Download: [craftrank.org/launcher](https://craftrank.org/launcher) or the [latest release](../../releases/latest).

## Releases

Raising the version in `package.json` and pushing to `main` (or pushing a tag like `v1.3.4`) builds the Windows files with GitHub Actions
(`.github/workflows/release.yml`) and attaches them to the release:
`CraftRank-Launcher.exe` (portable), `CraftRank-Launcher-Setup.exe` (installer) and `SHA256SUMS.txt`.

## Development

```
npm ci
npm start
```

## Contributing

Bug reports and pull requests are welcome. Open an issue first for bigger changes.

## License

[MIT](LICENSE). Minecraft is a trademark of Mojang AB; this launcher is not affiliated with Mojang or Microsoft.
OptiFine is downloaded from optifine.net on the player's PC and is not part of this repository.
