# CraftRank Skin Agent

A small Java agent the launcher starts with Minecraft (`-javaagent:craftrank-skins.jar=<skin server>`).
It shows CraftRank skins and capes on every server and every Minecraft version, without a mod.

Minecraft gets every player's skin and cape from Mojang's authlib library. The agent renames two or three
of authlib's methods while the game loads them and puts a short method in their place that asks CraftRank
first (by player name) and otherwise calls the original. Game files are never changed.

| Minecraft | authlib | methods |
|---|---|---|
| 1.8 – 1.20.1 | 1.5 – 4.x | `getTextures(GameProfile, boolean)` |
| 1.20.2 – 1.21.x | 5.x – 7.x | `getPackedTextures`, `unpackTextures` |
| 26.x | 10.x | same, in `MinecraftServicesSessionService` |

Tested in game: vanilla 1.21.3, OptiFine 1.21.3, Fabric 1.21.3 (with Sodium), vanilla 1.20.1, vanilla 1.12.2,
and vanilla 1.21.3 together with authlib-injector. authlib 1.5.21 (1.8.9) and 10.0.77 (26.x) tested on their own.

Build: `./build.sh` (needs a JDK; ASM 9.9 from `lib/` is moved to `craftrank/skins/asm` inside the jar).
