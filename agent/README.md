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

## Animated capes

A CraftRank animated cape is a normal cape (its first frame, which every client shows) plus a strip of
frames, sent as CAPE metadata `{"animated": "<strip url>", "fps": "12"}`. `GlPatcher` adds a few lines to
four LWJGL methods (LWJGL 3 for 1.13+, LWJGL 2 for 1.8 to 1.12): when the game uploads a texture that matches
the cape's first frame, `Anim` remembers the GL texture; once a frame, if the next animation frame is due,
it copies that frame into the same texture with one `glTexSubImage2D`. Cape, elytra and every player
wearing the same cape follow. Frames are decoded once (`Png`, no ImageIO) and shared. Start the game with
`-Dcraftrank.anim.debug=true` to log how much GL time the uploads take.
