package craftrank.skins;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.concurrent.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Skins and capes from CraftRank, by player name, with a small cache. */
final class Textures {
    static final class Entry {
        final String skin, cape; final boolean slim; final long at;
        Entry(String skin, boolean slim, String cape) { this.skin = skin; this.slim = slim; this.cape = cape; this.at = System.currentTimeMillis(); }
        boolean empty() { return skin == null && cape == null; }
    }
    static final Entry NONE = new Entry(null, false, null);

    private static String root;
    private static final ConcurrentHashMap<String, Entry> cache = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, Future<Entry>> loading = new ConcurrentHashMap<>();
    private static final ExecutorService pool = Executors.newFixedThreadPool(4, r -> { Thread t = new Thread(r, "CraftRank Skins"); t.setDaemon(true); return t; });
    private static final long FOUND_MS = 5 * 60_000, MISS_MS = 2 * 60_000;
    private static final Pattern NAME = Pattern.compile("^[A-Za-z0-9_]{1,16}$");

    static void init(String r) { root = r; }

    /** Cached answer, or null when it is not known yet. */
    static Entry cached(String name) {
        Entry e = cache.get(name.toLowerCase());
        if (e == null) return null;
        if (System.currentTimeMillis() - e.at > (e.empty() ? MISS_MS : FOUND_MS)) return null;
        return e;
    }

    /** Waits for the answer (at most a few seconds). Never throws. */
    static Entry get(String name) {
        if (name == null || !NAME.matcher(name).matches()) return NONE;
        Entry e = cached(name);
        if (e != null) return e;
        try { return start(name).get(6, TimeUnit.SECONDS); } catch (Throwable t) { return NONE; }
    }

    /** Starts loading in the background (for callers on the render thread). */
    static Future<Entry> start(String name) {
        String key = name.toLowerCase();
        return loading.computeIfAbsent(key, k -> pool.submit(() -> {
            Entry e;
            try { e = fetch(name); } catch (Throwable t) { e = NONE; }
            cache.put(key, e);
            loading.remove(key);
            return e;
        }));
    }

    /** CraftRank keeps a player's profile under the offline UUID of the name, the same one offline servers use. */
    private static Entry fetch(String name) throws Exception {
        String json = http(root + "sessionserver/session/minecraft/profile/" + offlineUuid(name));
        if (json == null || json.isEmpty()) return NONE;
        Matcher m = Pattern.compile("\"name\"\\s*:\\s*\"textures\"\\s*,\\s*\"value\"\\s*:\\s*\"([A-Za-z0-9+/=]+)\"").matcher(json);
        if (!m.find()) {
            m = Pattern.compile("\"value\"\\s*:\\s*\"([A-Za-z0-9+/=]+)\"").matcher(json);
            if (!m.find()) return NONE;
        }
        String tex = new String(Base64.getDecoder().decode(m.group(1)), StandardCharsets.UTF_8);
        String skin = url(tex, "SKIN"), cape = url(tex, "CAPE");
        boolean slim = Pattern.compile("\"SKIN\"\\s*:\\s*\\{[^}]*\"model\"\\s*:\\s*\"slim\"").matcher(tex).find();
        Entry e = new Entry(skin, slim, cape);
        Log.info(name + ": " + (e.empty() ? "no CraftRank skin" : (skin != null ? "skin" : "") + (cape != null ? (skin != null ? " + " : "") + "cape" : "")));
        return e;
    }

    private static String url(String tex, String type) {
        Matcher m = Pattern.compile("\"" + type + "\"\\s*:\\s*\\{\\s*\"url\"\\s*:\\s*\"([^\"]+)\"").matcher(tex);
        return m.find() ? m.group(1).replace("\\/", "/") : null;
    }

    private static String http(String u) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(4000); c.setReadTimeout(5000);
        c.setRequestProperty("User-Agent", "CraftRankSkins/1.0");
        c.setRequestProperty("Accept", "application/json");
        int code = c.getResponseCode();
        if (code != 200) return null;
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) > 0) { out.write(b, 0, n); if (out.size() > 65536) break; }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    static String offlineUuid(String name) throws Exception {
        byte[] h = MessageDigest.getInstance("MD5").digest(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
        h[6] = (byte) (h[6] & 0x0f | 0x30);
        h[8] = (byte) (h[8] & 0x3f | 0x80);
        StringBuilder s = new StringBuilder();
        for (byte b : h) s.append(String.format("%02x", b));
        return s.toString();
    }
}
