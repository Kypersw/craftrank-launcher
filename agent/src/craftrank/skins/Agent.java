package craftrank.skins;

import java.lang.instrument.Instrumentation;
import java.util.function.Function;

/**
 * CraftRank Skin Agent. Started with -javaagent:craftrank-skins.jar=https://craftrank.org/api/ygg/
 *
 * Minecraft gets the skin and cape of every player from Mojang's authlib library. On servers that do not
 * send skins (offline mode) players look like Steve or Alex. This agent changes two or three methods of
 * authlib while the game loads them: before Minecraft uses a player's textures, it asks CraftRank for the
 * player's name; when CraftRank has a skin or cape for that name, those are used, otherwise everything
 * goes on as before. The game files are not changed, and it works the same for vanilla, OptiFine, Forge,
 * Fabric, Quilt and NeoForge, because they all use authlib.
 *
 * The changed methods reach this agent through System properties (java.util.function.Function objects),
 * so they only use JDK classes and work in every class loader and module layer.
 */
public final class Agent {
    public static void premain(String args, Instrumentation inst) {
        String root = args == null ? "" : args.trim();
        if (!root.startsWith("https://") && !root.startsWith("http://")) { Log.info("no skin server given, off"); return; }
        if (!root.endsWith("/")) root += "/";
        Textures.init(root);
        put("craftrank.skins.packed", Bridge::packed);
        put("craftrank.skins.unpack", Bridge::unpack);
        put("craftrank.skins.old", Bridge::oldTextures);
        inst.addTransformer(new Patcher(), false);
        Log.info("ready, skin server " + root);
    }

    public static void agentmain(String args, Instrumentation inst) { premain(args, inst); }

    private static void put(String key, Function<Object, Object> f) { System.getProperties().put(key, f); }
}
