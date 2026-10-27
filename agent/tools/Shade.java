import org.objectweb.asm.*;
import org.objectweb.asm.commons.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.jar.*;
import java.util.zip.*;

/** Builds craftrank-skins.jar: the agent classes plus ASM, moved to craftrank/skins/asm so it never clashes with the game's ASM. */
public class Shade {
    public static void main(String[] a) throws Exception {
        String classes = a[0], out = a[1];
        String[] asmJars = Arrays.copyOfRange(a, 2, a.length);
        Remapper r = new Remapper() { @Override public String map(String n) { return n.startsWith("org/objectweb/asm/") ? "craftrank/skins/asm/" + n.substring(18) : n; } };
        Manifest mf = new Manifest();
        mf.getMainAttributes().put(Attributes.Name.MANIFEST_VERSION, "1.0");
        mf.getMainAttributes().putValue("Premain-Class", "craftrank.skins.Agent");
        mf.getMainAttributes().putValue("Agent-Class", "craftrank.skins.Agent");
        mf.getMainAttributes().putValue("Implementation-Title", "CraftRank Skin Agent");
        try (JarOutputStream jo = new JarOutputStream(new FileOutputStream(out), mf)) {
            Set<String> seen = new HashSet<>();
            Files.walk(Paths.get(classes)).filter(p -> p.toString().endsWith(".class")).sorted().forEach(p -> {
                try { put(jo, seen, Paths.get(classes).relativize(p).toString().replace('\\', '/'), remap(Files.readAllBytes(p), r)); } catch (IOException e) { throw new UncheckedIOException(e); }
            });
            for (String j : asmJars) try (ZipInputStream zi = new ZipInputStream(new FileInputStream(j))) {
                for (ZipEntry e; (e = zi.getNextEntry()) != null; ) {
                    String n = e.getName();
                    if (!n.startsWith("org/objectweb/asm/") || !n.endsWith(".class")) continue;
                    put(jo, seen, "craftrank/skins/asm/" + n.substring(18), remap(zi.readAllBytes(), r));
                }
            }
        }
    }
    static byte[] remap(byte[] b, Remapper r) { ClassReader cr = new ClassReader(b); ClassWriter cw = new ClassWriter(0); cr.accept(new ClassRemapper(cw, r), 0); return cw.toByteArray(); }
    static void put(JarOutputStream jo, Set<String> seen, String n, byte[] b) throws IOException {
        if (!seen.add(n)) return;
        JarEntry e = new JarEntry(n); e.setTime(0); jo.putNextEntry(e); jo.write(b); jo.closeEntry();
    }
}
