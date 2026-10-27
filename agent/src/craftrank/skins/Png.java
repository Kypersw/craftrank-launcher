package craftrank.skins;

import java.io.ByteArrayOutputStream;
import java.util.zip.Inflater;

/**
 * A small PNG reader (8-bit RGBA, RGB, grey, grey+alpha or palette; not interlaced), giving ARGB pixels.
 * Our own so the agent never needs java.desktop (ImageIO), which some game runtimes leave out.
 */
final class Png {
    final int w, h; final int[] argb;
    private Png(int w, int h, int[] argb) { this.w = w; this.h = h; this.argb = argb; }

    static Png read(byte[] b) throws Exception {
        if (b.length < 8 || (b[0] & 0xFF) != 0x89 || b[1] != 'P' || b[2] != 'N' || b[3] != 'G') throw new Exception("not a PNG");
        int p = 8, w = 0, h = 0, depth = 0, type = 0, inter = 0;
        int[] pal = null; byte[] trns = null;
        ByteArrayOutputStream idat = new ByteArrayOutputStream();
        while (p + 8 <= b.length) {
            int len = i32(b, p), t = i32(b, p + 4), d = p + 8;
            if (len < 0 || d + len > b.length) throw new Exception("bad chunk");
            if (t == 0x49484452) { w = i32(b, d); h = i32(b, d + 4); depth = b[d + 8] & 0xFF; type = b[d + 9] & 0xFF; inter = b[d + 12] & 0xFF; }
            else if (t == 0x504C5445) { pal = new int[len / 3]; for (int i = 0; i < pal.length; i++) pal[i] = 0xFF000000 | (b[d + i * 3] & 0xFF) << 16 | (b[d + i * 3 + 1] & 0xFF) << 8 | (b[d + i * 3 + 2] & 0xFF); }
            else if (t == 0x74524E53) { trns = new byte[len]; System.arraycopy(b, d, trns, 0, len); }
            else if (t == 0x49444154) idat.write(b, d, len);
            else if (t == 0x49454E44) break;
            p = d + len + 4;
        }
        if (w <= 0 || h <= 0 || w > 4096 || h > 65536 || (long) w * h > 40_000_000L) throw new Exception("bad size");
        if (depth != 8 || inter != 0) throw new Exception("unsupported PNG (8-bit, not interlaced only)");
        int ch = type == 6 ? 4 : type == 2 ? 3 : type == 4 ? 2 : 1;
        if (type == 3 && pal == null) throw new Exception("no palette");
        if (type == 3 && trns != null) for (int i = 0; i < trns.length && i < pal.length; i++) pal[i] = (pal[i] & 0xFFFFFF) | (trns[i] & 0xFF) << 24;
        int stride = w * ch;
        byte[] raw = new byte[(stride + 1) * h];
        Inflater inf = new Inflater();
        inf.setInput(idat.toByteArray());
        int got = 0;
        while (got < raw.length) { int k = inf.inflate(raw, got, raw.length - got); if (k == 0 && (inf.finished() || inf.needsInput())) break; got += k; }
        inf.end();
        if (got < raw.length) throw new Exception("short image data");
        int[] out = new int[w * h];
        byte[] prev = new byte[stride], cur = new byte[stride];
        for (int y = 0; y < h; y++) {
            int f = raw[y * (stride + 1)] & 0xFF, o = y * (stride + 1) + 1;
            for (int x = 0; x < stride; x++) {
                int a = x >= ch ? cur[x - ch] & 0xFF : 0, up = prev[x] & 0xFF, c = x >= ch ? prev[x - ch] & 0xFF : 0, v = raw[o + x] & 0xFF;
                switch (f) {
                    case 1: v += a; break;
                    case 2: v += up; break;
                    case 3: v += (a + up) >> 1; break;
                    case 4: { int pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; break; }
                    default: break;
                }
                cur[x] = (byte) v;
            }
            for (int x = 0, i = y * w; x < w; x++, i++) {
                int q = x * ch;
                switch (type) {
                    case 6: out[i] = (cur[q + 3] & 0xFF) << 24 | (cur[q] & 0xFF) << 16 | (cur[q + 1] & 0xFF) << 8 | (cur[q + 2] & 0xFF); break;
                    case 2: out[i] = 0xFF000000 | (cur[q] & 0xFF) << 16 | (cur[q + 1] & 0xFF) << 8 | (cur[q + 2] & 0xFF); break;
                    case 4: { int g = cur[q] & 0xFF; out[i] = (cur[q + 1] & 0xFF) << 24 | g << 16 | g << 8 | g; break; }
                    case 3: { int k = cur[q] & 0xFF; out[i] = k < pal.length ? pal[k] : 0; break; }
                    default: { int g = cur[q] & 0xFF; out[i] = 0xFF000000 | g << 16 | g << 8 | g; }
                }
            }
            byte[] t = prev; prev = cur; cur = t;
        }
        return new Png(w, h, out);
    }

    private static int i32(byte[] b, int p) { return (b[p] & 0xFF) << 24 | (b[p + 1] & 0xFF) << 16 | (b[p + 2] & 0xFF) << 8 | (b[p + 3] & 0xFF); }
}
