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
    private static final Entry BUSY = new Entry(null, false, null);   // no answer this time: ask again a minute later

    private static String root;
    private static final ConcurrentHashMap<String, Entry> cache = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, CompletableFuture<Entry>> loading = new ConcurrentHashMap<>();
    // names waiting for the next batch request (a full server is one request instead of hundreds)
    private static final ConcurrentLinkedQueue<String> queue = new ConcurrentLinkedQueue<>();
    private static final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "CraftRank Skins batch"); t.setDaemon(true); return t; });
    private static final java.util.concurrent.atomic.AtomicBoolean flushing = new java.util.concurrent.atomic.AtomicBoolean();
    private static volatile boolean batchOff;      // an older CraftRank site without the batch address
    private static volatile long quietUntil;       // the site asked us to slow down (429)
    private static final ExecutorService pool = Executors.newFixedThreadPool(4, r -> { Thread t = new Thread(r, "CraftRank Skins"); t.setDaemon(true); return t; });
    private static final long FOUND_MS = 10 * 60_000, MISS_MS = 10 * 60_000, BUSY_MS = 60_000;
    private static final Pattern NAME = Pattern.compile("^[A-Za-z0-9_]{1,16}$");

    static void init(String r) { root = r; }

    static ExecutorService pool() { return pool; }

    /** Cached answer, or null when it is not known yet. */
    static Entry cached(String name) {
        Entry e = cache.get(name.toLowerCase());
        if (e == null) return null;
        if (System.currentTimeMillis() - e.at > (e == BUSY ? BUSY_MS : e.empty() ? MISS_MS : FOUND_MS)) return null;
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
        return loading.computeIfAbsent(key, k -> {
            CompletableFuture<Entry> f = new CompletableFuture<>();
            queue.add(name);
            if (flushing.compareAndSet(false, true)) timer.schedule(Textures::flush, 150, TimeUnit.MILLISECONDS);
            return f;
        });
    }

    private static void done(String name, Entry e) {
        String key = name.toLowerCase();
        cache.put(key, e);
        CompletableFuture<Entry> f = loading.remove(key);
        if (f != null) f.complete(e == BUSY ? NONE : e);
    }

    /** Sends the waiting names, up to 100 per request. */
    private static void flush() {
        try {
            while (true) {
                java.util.List<String> names = new java.util.ArrayList<>();
                for (String n; names.size() < 100 && (n = queue.poll()) != null; ) names.add(n);
                if (names.isEmpty()) break;
                if (System.currentTimeMillis() < quietUntil) { for (String n : names) done(n, BUSY); continue; }
                if (!batchOff) {
                    try { batch(names); continue; }
                    catch (NoBatch nb) { batchOff = true; }
                    catch (Throwable t) { for (String n : names) done(n, BUSY); continue; }
                }
                for (String n : names) pool.submit(() -> { Entry e; try { e = fetch(n); } catch (Throwable t) { e = BUSY; } done(n, e); });
            }
        } finally {
            flushing.set(false);
            if (!queue.isEmpty() && flushing.compareAndSet(false, true)) timer.schedule(Textures::flush, 150, TimeUnit.MILLISECONDS);
        }
    }

    private static final class NoBatch extends Exception {}

    /** POST {root}craftrank/textures {"names": [...]} -> {"players": {"name": {"SKIN": {...}, "CAPE": {...}}}} */
    private static void batch(java.util.List<String> names) throws Exception {
        StringBuilder body = new StringBuilder("{\"names\":[");
        for (int i = 0; i < names.size(); i++) body.append(i > 0 ? "," : "").append('"').append(names.get(i)).append('"');
        body.append("]}");
        HttpURLConnection c = (HttpURLConnection) new URL(root + "craftrank/textures").openConnection();
        c.setConnectTimeout(4000); c.setReadTimeout(6000);
        c.setRequestMethod("POST"); c.setDoOutput(true);
        c.setRequestProperty("User-Agent", "CraftRankSkins/1.2");
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("Accept", "application/json");
        c.getOutputStream().write(body.toString().getBytes(StandardCharsets.UTF_8));
        int code = c.getResponseCode();
        if (code == 404 || code == 405 || code == 501) throw new NoBatch();
        if (code == 429) { quietUntil = System.currentTimeMillis() + 60_000; for (String n : names) done(n, BUSY); return; }
        if (code != 200) throw new Exception("HTTP " + code);
        String json;
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) > 0) { out.write(b, 0, n); if (out.size() > 1 << 20) break; }
            json = new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
        if (!json.contains("\"players\"")) throw new NoBatch();   // not our API (a challenge page, another server)
        int found = 0;
        for (String n : names) {
            String tex = object(json, "\"" + n.toLowerCase() + "\"");
            Entry e = tex == null ? NONE : parse(tex);
            if (!e.empty()) found++;
            done(n, e);
        }
        Log.info(names.size() + " players asked, " + found + " with CraftRank skins");
    }

    /** The {...} that follows a key in a JSON text, or null. */
    private static String object(String json, String key) {
        int i = json.indexOf(key + ":");
        if (i < 0) i = json.indexOf(key + " :");
        if (i < 0) return null;
        int a = json.indexOf('{', i + key.length());
        if (a < 0) return null;
        int depth = 0; boolean str = false;
        for (int j = a; j < json.length(); j++) {
            char ch = json.charAt(j);
            if (str) { if (ch == '\\') j++; else if (ch == '"') str = false; continue; }
            if (ch == '"') str = true;
            else if (ch == '{') depth++;
            else if (ch == '}' && --depth == 0) return json.substring(a, j + 1);
        }
        return null;
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
        return parse(new String(Base64.getDecoder().decode(m.group(1)), StandardCharsets.UTF_8));
    }

    /** Textures JSON ({"SKIN": {...}, "CAPE": {...}}) to an entry; starts loading an animated cape. */
    private static Entry parse(String tex) {
        String skin = url(tex, "SKIN"), cape = url(tex, "CAPE");
        boolean slim = Pattern.compile("\"SKIN\"\\s*:\\s*\\{[^}]*\"model\"\\s*:\\s*\"slim\"").matcher(tex).find();
        Entry e = new Entry(skin, slim, cape);
        // animated cape: CAPE metadata {"animated": strip URL, "fps": "12"}
        Matcher a = Pattern.compile("\"animated\"\\s*:\\s*\"([^\"]+)\"").matcher(tex);
        if (cape != null && a.find()) {
            Matcher f = Pattern.compile("\"fps\"\\s*:\\s*\"?(\\d+)").matcher(tex);
            Anim.want(a.group(1).replace("\\/", "/"), f.find() ? Integer.parseInt(f.group(1)) : 12);
        }
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
