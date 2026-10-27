package craftrank.skins;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;

/**
 * What the patched authlib methods call. authlib's types are only reached by reflection, through the
 * class loader of the objects we get, so this works whatever loader authlib lives in.
 *
 *  packed(GameProfile)  -> Property "textures" = "craftrank:NAME" (+ the server's own value after a newline)
 *  unpack(Property)     -> MinecraftProfileTextures from CraftRank, or the server's own Property, or null
 *  oldTextures(Profile) -> Map<Type, MinecraftProfileTexture> from CraftRank, or null (authlib goes on as before)
 */
final class Bridge {
    static final String MARK = "craftrank:";

    /** 1.20.2+. Runs where Minecraft asks for a player's textures (also the render thread): never waits. */
    static Object packed(Object profile) {
        try {
            String name = name(profile);
            if (name == null) return null;
            Object own = firstTextures(profile);
            ClassLoader cl = profile.getClass().getClassLoader();
            Class<?> prop = Class.forName("com.mojang.authlib.properties.Property", false, cl);
            String value = MARK + name + (own != null ? "\n" + str(own, "value", "getValue") : "");
            String sig = own != null ? str(own, "signature", "getSignature") : null;
            Textures.start(name);   // start loading now, it is ready sooner
            return sig != null ? prop.getConstructor(String.class, String.class, String.class).newInstance("textures", value, sig)
                               : prop.getConstructor(String.class, String.class).newInstance("textures", value);
        } catch (Throwable t) { return null; }
    }

    /** 1.20.2+. Runs in the background. */
    static Object unpack(Object property) {
        try {
            String value = str(property, "value", "getValue");
            if (value == null || !value.startsWith(MARK)) return null;
            int nl = value.indexOf('\n');
            String name = value.substring(MARK.length(), nl < 0 ? value.length() : nl);
            ClassLoader cl = property.getClass().getClassLoader();
            Textures.Entry e = Textures.get(name);
            if (!e.empty()) {
                Class<?> tex = Class.forName("com.mojang.authlib.minecraft.MinecraftProfileTexture", false, cl);
                Class<?> all = Class.forName("com.mojang.authlib.minecraft.MinecraftProfileTextures", false, cl);
                Class<?> state = Class.forName("com.mojang.authlib.SignatureState", false, cl);
                Object signed = state.getField("SIGNED").get(null);
                Object skin = e.skin != null ? texture(tex, e.skin, e.slim) : null;
                Object cape = e.cape != null ? texture(tex, e.cape, false) : null;
                Constructor<?> c = all.getConstructor(tex, tex, tex, state);
                return c.newInstance(skin, cape, null, signed);
            }
            // not on CraftRank: what the server sent, or nothing
            Class<?> prop = Class.forName("com.mojang.authlib.properties.Property", false, cl);
            if (nl >= 0) {
                String sig = str(property, "signature", "getSignature");
                String own = value.substring(nl + 1);
                return sig != null ? prop.getConstructor(String.class, String.class, String.class).newInstance("textures", own, sig)
                                   : prop.getConstructor(String.class, String.class).newInstance("textures", own);
            }
            Class<?> all = Class.forName("com.mojang.authlib.minecraft.MinecraftProfileTextures", false, cl);
            return all.getField("EMPTY").get(null);
        } catch (Throwable t) { return null; }
    }

    /** 1.8 to 1.20.1. Mostly runs in the background; on the render thread it never waits. */
    static Object oldTextures(Object profile) {
        try {
            String name = name(profile);
            if (name == null) return null;
            Textures.Entry e;
            if (renderThread()) { e = Textures.cached(name); if (e == null) { Textures.start(name); return null; } }
            else e = Textures.get(name);
            if (e.empty()) return null;
            ClassLoader cl = profile.getClass().getClassLoader();
            Class<?> tex = Class.forName("com.mojang.authlib.minecraft.MinecraftProfileTexture", false, cl);
            Class<?> type = Class.forName("com.mojang.authlib.minecraft.MinecraftProfileTexture$Type", false, cl);
            Map<Object, Object> map = new HashMap<>();
            if (e.skin != null) map.put(type.getField("SKIN").get(null), texture(tex, e.skin, e.slim));
            if (e.cape != null) map.put(type.getField("CAPE").get(null), texture(tex, e.cape, false));
            return map;
        } catch (Throwable t) { Log.info("old textures failed: " + t); return null; }
    }

    private static Object texture(Class<?> tex, String url, boolean slim) throws Exception {
        Map<String, String> meta = new HashMap<>();
        if (slim) meta.put("model", "slim");
        return tex.getConstructor(String.class, Map.class).newInstance(url, meta);
    }

    private static boolean renderThread() {
        String n = Thread.currentThread().getName();
        return n.equals("Render thread") || n.equals("Client thread") || n.equals("main");
    }

    private static String name(Object profile) {
        String n = str(profile, "name", "getName");
        return n != null && n.matches("[A-Za-z0-9_]{1,16}") ? n : null;
    }

    /** The first "textures" property of a profile, or null. */
    private static Object firstTextures(Object profile) {
        try {
            Object map = call(profile, "properties", "getProperties");
            if (map == null) return null;
            Method get = map.getClass().getMethod("get", Object.class);
            Object c = get.invoke(map, "textures");
            if (c instanceof Collection && !((Collection<?>) c).isEmpty()) return ((Collection<?>) c).iterator().next();
        } catch (Throwable ignored) {}
        return null;
    }

    private static String str(Object o, String a, String b) { Object v = call(o, a, b); return v == null ? null : String.valueOf(v); }

    private static Object call(Object o, String a, String b) {
        for (String m : new String[]{a, b}) {
            try { Method x = o.getClass().getMethod(m); return x.invoke(o); } catch (Throwable ignored) {}
        }
        return null;
    }
}
