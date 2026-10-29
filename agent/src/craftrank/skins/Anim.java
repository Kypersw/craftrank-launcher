package craftrank.skins;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.IntBuffer;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Animated capes, cheap on FPS.
 *
 * A CraftRank animated cape is a normal cape (its first frame, what every client shows) plus a strip of
 * frames (same size, stacked top to bottom). The game loads the normal cape as always; when it uploads
 * it to the graphics card we note which GL texture it went to (by a fingerprint of its pixels). Then,
 * once per screen frame, if the cape's next frame is due (usually 12 to 20 times a second) we copy that
 * frame into the same texture: one glTexSubImage2D of at most 2 MB, nothing else. Cape, elytra and every
 * player wearing the same cape follow, because they all draw that one texture.
 *
 * Frames are decoded once into direct memory and shared by everyone wearing that cape.
 */
final class Anim {
    // GL constants
    private static final int TEX_2D = 0x0DE1, BINDING_2D = 0x8069, UNPACK_BUFFER_BINDING = 0x88EF,
        ROW_LENGTH = 0x0CF2, SKIP_ROWS = 0x0CF3, SKIP_PIXELS = 0x0CF4, ALIGNMENT = 0x0CF5,
        RGBA = 0x1908, UBYTE = 0x1401, BGRA = 0x80E1, UINT_8888_REV = 0x8367;
    private static final long MAX_BYTES = 160L << 20;   // frames of all animated capes together

    static final class Strip {
        final String url; final int w, h, fps; final IntBuffer[] frames; final long fp;
        Strip(String url, int w, int h, int fps, IntBuffer[] frames, long fp) { this.url = url; this.w = w; this.h = h; this.fps = fps; this.frames = frames; this.fp = fp; }
    }
    static final class Bound { final int tex; final Strip s; int last = -1; Bound(int tex, Strip s) { this.tex = tex; this.s = s; } }

    private static final Set<String> asked = ConcurrentHashMap.newKeySet();
    private static final ConcurrentLinkedQueue<Strip> ready = new ConcurrentLinkedQueue<>();
    private static long bytes;

    // render thread only
    private static final Map<Long, Strip> strips = new HashMap<>();
    private static final LinkedHashMap<Long, Integer> recent = new LinkedHashMap<Long, Integer>(64, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<Long, Integer> e) { return size() > 96; }
    };
    private static final List<Bound> bound = new ArrayList<>();
    private static volatile boolean any;
    private static boolean busy;
    private static final boolean DEBUG = Boolean.getBoolean("craftrank.anim.debug");
    private static long spent, ups, since;
    private static Method getInt, bind, store, sub;
    private static Object unsafe; private static Method unsafeGetInt;

    /* ---------------- loading (background) ---------------- */

    /** Loads a cape strip once (in the background). */
    static void want(String url, int fps) {
        if (url == null || !asked.add(url)) return;
        Textures.pool().submit(() -> {
            try {
                Png p = Png.read(download(url));
                int w = p.w, h = w / 2;
                if (w < 64 || h <= 0 || p.h < h * 2 || p.h % h != 0) { Log.info("animated cape skipped, strip size " + p.w + "x" + p.h); return; }
                int n = Math.min(p.h / h, 64);
                long need = (long) n * w * h * 4;
                synchronized (Anim.class) { if (bytes + need > MAX_BYTES) { Log.info("animated cape skipped, memory limit"); return; } bytes += need; }
                IntBuffer[] fr = new IntBuffer[n];
                for (int i = 0; i < n; i++) {
                    IntBuffer b = ByteBuffer.allocateDirect(w * h * 4).order(ByteOrder.nativeOrder()).asIntBuffer();
                    b.put(p.argb, i * w * h, w * h); b.flip();
                    fr[i] = b;
                }
                long fp = fingerprint(w, h, i -> p.argb[i]);
                if (fp == 0) { Log.info("animated cape skipped, first frame is empty"); return; }
                ready.add(new Strip(url, w, h, Math.max(1, Math.min(fps, 30)), fr, fp));
                any = true;
                Log.info("animated cape loaded: " + n + " frames " + w + "x" + h + " @" + fps + "fps");
            } catch (Throwable t) { Log.info("animated cape failed: " + t); }
        });
    }

    private static byte[] download(String u) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(5000); c.setReadTimeout(15000);
        c.setRequestProperty("User-Agent", "CraftRankSkins/1.1");
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[65536]; int k;
            while ((k = in.read(b)) > 0) { out.write(b, 0, k); if (out.size() > (24 << 20)) throw new Exception("too big"); }
            return out.toByteArray();
        }
    }

    /* ---------------- fingerprint ---------------- */

    interface Px { int at(int i); }

    /** 32 opaque pixels of the cape's back, with the width: the same for the PNG and for what the game uploads. */
    static long fingerprint(int w, int h, Px px) {
        int k = w / 64; if (k <= 0) return 0;
        long f = 1469598103934665603L; int seen = 0;
        for (int j = 0; j < 8; j++) for (int i = 0; i < 4; i++) {
            int x = (int) ((1 + (i + 0.5) * 10 / 4.0) * k), y = (int) ((1 + (j + 0.5) * 16 / 8.0) * k);
            if (y >= h) continue;
            int c = px.at(y * w + x);
            if ((c >>> 24) != 0xFF) c = 0; else seen++;
            f = (f ^ c) * 1099511628211L;
        }
        return seen < 8 ? 0 : (f ^ w) * 1099511628211L;
    }

    /* ---------------- hooks (render thread) ---------------- */

    /** glTexSubImage2D at 0,0 level 0 with width = 2 × height: {w, h, format, type, pixels (address or IntBuffer), GL class}. */
    static Object tex(Object o) {
        if (busy) return null;
        try {
            Object[] a = (Object[]) o;
            int w = (Integer) a[0], h = (Integer) a[1], fmt = (Integer) a[2], type = (Integer) a[3];
            Px px;
            if (a[4] instanceof Long && fmt == RGBA && type == UBYTE) {
                long base = (Long) a[4];
                // Only read memory when the long really is an address: with a pixel buffer (PBO) bound it is an
                // offset into that buffer (Minecraft 26.x uploads this way), and reading it crashes the game.
                if (base < 0x10000L) return null;
                gl((Class<?>) a[5]);
                if (getInt == null || (Integer) getInt.invoke(null, UNPACK_BUFFER_BINDING) != 0) return null;
                int rl = (Integer) getInt.invoke(null, ROW_LENGTH);
                if ((rl != 0 && rl != w) || (Integer) getInt.invoke(null, SKIP_ROWS) != 0 || (Integer) getInt.invoke(null, SKIP_PIXELS) != 0) return null;
                px = i -> { int v = peek(base + 4L * i); return (v & 0xFF00FF00) | (v & 0xFF) << 16 | (v >>> 16) & 0xFF; };
            } else if (a[4] instanceof IntBuffer && fmt == BGRA && type == UINT_8888_REV) {
                IntBuffer b = (IntBuffer) a[4]; int pos = b.position();
                if (b.remaining() < w * h) return null;
                px = i -> b.get(pos + i);
            } else return null;
            long fp = fingerprint(w, h, px);
            if (fp == 0) return null;
            gl((Class<?>) a[5]);
            int id = (Integer) getInt.invoke(null, BINDING_2D);
            if (id <= 0) return null;
            for (Iterator<Bound> it = bound.iterator(); it.hasNext(); ) { Bound b = it.next(); if (b.tex == id && b.s.fp != fp) it.remove(); }
            Strip s = strips.get(fp);
            if (s != null && s.w == w) attach(id, s);
            else recent.put(fp, id);
        } catch (Throwable t) { /* never break the game's upload */ }
        return null;
    }

    static Object del(Object o) {
        if (busy || (!any && recent.isEmpty())) return null;
        int id = (Integer) o;
        bound.removeIf(b -> b.tex == id);
        recent.values().removeIf(v -> v == id);
        return null;
    }

    /** Once a frame, right before the picture is shown. */
    // -Dcraftrank.fps.log=true: frames per second in the log every 10 seconds (for comparing settings)
    private static final boolean FPS = Boolean.getBoolean("craftrank.fps.log");
    private static long fpsSince, fpsFrames;
    static Object swap(Object glClass) {
        if (FPS) {
            fpsFrames++; long now = System.nanoTime();
            if (fpsSince == 0) fpsSince = now;
            else if (now - fpsSince > 10_000_000_000L) { Log.info(String.format("fps: %.1f", fpsFrames * 1e9 / (now - fpsSince))); fpsFrames = 0; fpsSince = now; }
        }
        if (!any) return null;
        try {
            for (Strip s; (s = ready.poll()) != null; ) {
                strips.put(s.fp, s);
                Integer id = recent.remove(s.fp);
                if (id != null) attach(id, s);
            }
            if (bound.isEmpty()) return null;
            long ms = System.nanoTime() / 1_000_000L;
            List<Bound> due = null;
            for (Bound b : bound) {
                int f = (int) ((ms * b.s.fps / 1000L) % b.s.frames.length);
                if (f != b.last) { if (due == null) due = new ArrayList<>(); b.last = f; due.add(b); }
            }
            if (due == null) return null;
            long t0 = System.nanoTime();
            upload(glClass, due);
            if (DEBUG) { spent += System.nanoTime() - t0; ups++; if (ms - since > 10_000) { Log.info(String.format("animated capes: %d uploads, %.3f ms of GL time per second", ups, spent / 1e6 / ((ms - since) / 1000.0))); spent = 0; ups = 0; since = ms; } }
        } catch (Throwable t) { Log.info("animated cape paused: " + t); bound.clear(); }
        return null;
    }

    private static void attach(int id, Strip s) {
        for (Bound b : bound) if (b.tex == id) return;
        bound.add(new Bound(id, s));
        Log.info("animated cape on texture " + id);
    }

    private static void upload(Object glClass, List<Bound> due) throws Exception {
        gl(glClass instanceof Class ? (Class<?>) glClass : null);
        if (getInt == null) return;
        int pbo = 0;
        try { pbo = (Integer) getInt.invoke(null, UNPACK_BUFFER_BINDING); } catch (Throwable ignored) {}
        if (pbo != 0) return;   // the game is streaming through a pixel buffer right now, next frame then
        busy = true;
        int prev = (Integer) getInt.invoke(null, BINDING_2D);
        int rl = (Integer) getInt.invoke(null, ROW_LENGTH), sr = (Integer) getInt.invoke(null, SKIP_ROWS), sp = (Integer) getInt.invoke(null, SKIP_PIXELS), al = (Integer) getInt.invoke(null, ALIGNMENT);
        try {
            store.invoke(null, ROW_LENGTH, 0); store.invoke(null, SKIP_ROWS, 0); store.invoke(null, SKIP_PIXELS, 0); store.invoke(null, ALIGNMENT, 4);
            for (Bound b : due) {
                bind.invoke(null, TEX_2D, b.tex);
                sub.invoke(null, TEX_2D, 0, 0, 0, b.s.w, b.s.h, BGRA, UINT_8888_REV, b.s.frames[b.last]);
            }
        } finally {
            store.invoke(null, ROW_LENGTH, rl); store.invoke(null, SKIP_ROWS, sr); store.invoke(null, SKIP_PIXELS, sp); store.invoke(null, ALIGNMENT, al);
            bind.invoke(null, TEX_2D, prev);
            busy = false;
        }
    }

    /** GL11 of the game's LWJGL (2 or 3), through the loader of a class we were called from. */
    private static void gl(Class<?> from) throws Exception {
        if (getInt != null || from == null) return;
        ClassLoader cl = from.getClassLoader();
        Class<?> g = Class.forName("org.lwjgl.opengl.GL11", false, cl);
        getInt = g.getMethod("glGetInteger", int.class);
        bind = g.getMethod("glBindTexture", int.class, int.class);
        store = g.getMethod("glPixelStorei", int.class, int.class);
        sub = g.getMethod("glTexSubImage2D", int.class, int.class, int.class, int.class, int.class, int.class, int.class, int.class, IntBuffer.class);
    }

    private static int peek(long addr) {
        try {
            if (unsafe == null) {
                Class<?> u = Class.forName("sun.misc.Unsafe");
                Field f = u.getDeclaredField("theUnsafe"); f.setAccessible(true);
                unsafe = f.get(null);
                unsafeGetInt = u.getMethod("getInt", long.class);
            }
            return (Integer) unsafeGetInt.invoke(unsafe, addr);
        } catch (Throwable t) { throw new RuntimeException(t); }
    }
}
