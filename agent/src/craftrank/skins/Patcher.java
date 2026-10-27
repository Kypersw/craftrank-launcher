package craftrank.skins;

import org.objectweb.asm.*;

import java.lang.instrument.ClassFileTransformer;
import java.security.ProtectionDomain;
import java.util.ArrayList;
import java.util.List;

/**
 * Changes authlib's session service class when it is loaded.
 * Each method we use is renamed to craftrank$name with its body untouched, and a new method with the
 * old name asks the agent first:
 *
 *   Object r = ((Function) System.getProperties().get(KEY)).apply(arg);
 *   if (r instanceof RET) return (RET) r;                 // CraftRank has this player
 *   if (r instanceof ARG) return craftrank$name((ARG) r, ...);  // go on with another argument
 *   return craftrank$name(arg, ...);                      // as before
 *
 * The new methods only use JDK classes and authlib's own types, so they link in every class loader.
 */
final class Patcher implements ClassFileTransformer {
    // where the texture methods live: authlib 1.5 to 7 (Minecraft 1.8 to 1.21.x), authlib 10+ (Minecraft 26.x)
    static final java.util.Set<String> TARGETS = new java.util.HashSet<>(java.util.Arrays.asList(
        "com/mojang/authlib/yggdrasil/YggdrasilMinecraftSessionService",
        "com/mojang/authlib/services/MinecraftServicesSessionService"));

    static final class Hook {
        final String name, desc, key, ret, arg; final int access;
        Hook(String name, String desc, String key, String ret, String arg, int access) { this.name = name; this.desc = desc; this.key = key; this.ret = ret; this.arg = arg; this.access = access; }
    }

    @Override
    public byte[] transform(ClassLoader loader, String name, Class<?> cls, ProtectionDomain pd, byte[] bytes) {
        if (name == null || !TARGETS.contains(name)) return null;
        final String owner = name;
        try {
            ClassReader cr = new ClassReader(bytes);
            ClassWriter cw = new ClassWriter(cr, 0);
            List<Hook> hooks = new ArrayList<>();
            cr.accept(new ClassVisitor(Opcodes.ASM9, cw) {
                @Override
                public MethodVisitor visitMethod(int acc, String m, String desc, String sig, String[] ex) {
                    Hook h = null;
                    if ((acc & (Opcodes.ACC_STATIC | Opcodes.ACC_ABSTRACT)) == 0) {
                        if (m.equals("getPackedTextures") && desc.equals("(Lcom/mojang/authlib/GameProfile;)Lcom/mojang/authlib/properties/Property;"))
                            h = new Hook(m, desc, "craftrank.skins.packed", "com/mojang/authlib/properties/Property", "com/mojang/authlib/GameProfile", acc);
                        else if (m.equals("unpackTextures") && desc.equals("(Lcom/mojang/authlib/properties/Property;)Lcom/mojang/authlib/minecraft/MinecraftProfileTextures;"))
                            h = new Hook(m, desc, "craftrank.skins.unpack", "com/mojang/authlib/minecraft/MinecraftProfileTextures", "com/mojang/authlib/properties/Property", acc);
                        else if (m.equals("getTextures") && desc.equals("(Lcom/mojang/authlib/GameProfile;Z)Ljava/util/Map;"))
                            h = new Hook(m, desc, "craftrank.skins.old", "java/util/Map", "com/mojang/authlib/GameProfile", acc);
                    }
                    if (h == null) return super.visitMethod(acc, m, desc, sig, ex);
                    hooks.add(h);
                    // the original body under a new name
                    return super.visitMethod((acc & ~(Opcodes.ACC_PUBLIC | Opcodes.ACC_PROTECTED)) | Opcodes.ACC_PRIVATE, "craftrank$" + m, desc, sig, ex);
                }

                @Override
                public void visitEnd() {
                    for (Hook h : hooks) write(cv, h, owner);
                    super.visitEnd();
                }
            }, 0);
            if (hooks.isEmpty()) return null;
            Log.info("patched authlib (" + hooks.size() + " methods)");
            return cw.toByteArray();
        } catch (Throwable t) {
            Log.info("could not patch authlib, skins stay as they are: " + t);
            return null;
        }
    }

    private static void write(ClassVisitor cv, Hook h, String owner) {
        Type[] args = Type.getArgumentTypes(h.desc);
        MethodVisitor mv = cv.visitMethod(h.access, h.name, h.desc, null, null);
        mv.visitCode();
        int rLocal = 1;
        for (Type t : args) rLocal += t.getSize();
        // locals for the frames: this, the arguments, r
        Object[] locals = new Object[args.length + 2];
        locals[0] = owner;
        for (int i = 0; i < args.length; i++) locals[i + 1] = frameType(args[i]);
        locals[args.length + 1] = "java/lang/Object";

        mv.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/System", "getProperties", "()Ljava/util/Properties;", false);
        mv.visitLdcInsn(h.key);
        mv.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/Properties", "get", "(Ljava/lang/Object;)Ljava/lang/Object;", false);
        mv.visitTypeInsn(Opcodes.CHECKCAST, "java/util/function/Function");
        mv.visitVarInsn(Opcodes.ALOAD, 1);
        mv.visitMethodInsn(Opcodes.INVOKEINTERFACE, "java/util/function/Function", "apply", "(Ljava/lang/Object;)Ljava/lang/Object;", true);
        mv.visitVarInsn(Opcodes.ASTORE, rLocal);

        // if (r instanceof RET) return (RET) r;
        mv.visitVarInsn(Opcodes.ALOAD, rLocal);
        mv.visitTypeInsn(Opcodes.INSTANCEOF, h.ret);
        Label notRet = new Label();
        mv.visitJumpInsn(Opcodes.IFEQ, notRet);
        mv.visitVarInsn(Opcodes.ALOAD, rLocal);
        mv.visitTypeInsn(Opcodes.CHECKCAST, h.ret);
        mv.visitInsn(Opcodes.ARETURN);
        mv.visitLabel(notRet);
        mv.visitFrame(Opcodes.F_FULL, locals.length, locals, 0, new Object[0]);

        // if (r instanceof ARG) return orig((ARG) r, rest...);
        mv.visitVarInsn(Opcodes.ALOAD, rLocal);
        mv.visitTypeInsn(Opcodes.INSTANCEOF, h.arg);
        Label notArg = new Label();
        mv.visitJumpInsn(Opcodes.IFEQ, notArg);
        mv.visitVarInsn(Opcodes.ALOAD, 0);
        mv.visitVarInsn(Opcodes.ALOAD, rLocal);
        mv.visitTypeInsn(Opcodes.CHECKCAST, h.arg);
        loadRest(mv, args);
        mv.visitMethodInsn(Opcodes.INVOKESPECIAL, owner, "craftrank$" + h.name, h.desc, false);
        mv.visitInsn(Opcodes.ARETURN);
        mv.visitLabel(notArg);
        mv.visitFrame(Opcodes.F_FULL, locals.length, locals, 0, new Object[0]);

        // return orig(arg, rest...);
        mv.visitVarInsn(Opcodes.ALOAD, 0);
        mv.visitVarInsn(Opcodes.ALOAD, 1);
        loadRest(mv, args);
        mv.visitMethodInsn(Opcodes.INVOKESPECIAL, owner, "craftrank$" + h.name, h.desc, false);
        mv.visitInsn(Opcodes.ARETURN);
        mv.visitMaxs(2 + rLocal, rLocal + 1);
        mv.visitEnd();
    }

    private static void loadRest(MethodVisitor mv, Type[] args) {
        int idx = 1 + args[0].getSize();
        for (int i = 1; i < args.length; i++) { mv.visitVarInsn(args[i].getOpcode(Opcodes.ILOAD), idx); idx += args[i].getSize(); }
    }

    private static Object frameType(Type t) {
        switch (t.getSort()) {
            case Type.BOOLEAN: case Type.BYTE: case Type.CHAR: case Type.SHORT: case Type.INT: return Opcodes.INTEGER;
            case Type.LONG: return Opcodes.LONG;
            case Type.FLOAT: return Opcodes.FLOAT;
            case Type.DOUBLE: return Opcodes.DOUBLE;
            default: return t.getInternalName();
        }
    }
}
