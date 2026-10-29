package craftrank.skins;

import org.objectweb.asm.*;

import java.lang.instrument.ClassFileTransformer;
import java.security.ProtectionDomain;

/**
 * Animated capes: adds a few lines to the start of four LWJGL methods (LWJGL 3 for Minecraft 1.13+,
 * LWJGL 2 for 1.8 to 1.12). Nothing in Minecraft itself is changed, so it works for every version and loader.
 *
 *   glTexSubImage2D(..)  a texture that looks like a cape is uploaded: tell Anim which GL texture it went to
 *   glDeleteTextures(id) a texture is gone: Anim forgets it
 *   glfwSwapBuffers / Display.swapBuffers  once a frame: Anim uploads the next cape frame when it is due
 *
 * The texture check runs in the bytecode first (offset 0,0, level 0, width = 2 × height, width >= 64),
 * so nearly every texture upload of the game costs only a few integer compares.
 */
final class GlPatcher implements ClassFileTransformer {
    static final String TEX = "craftrank.gl.tex", DEL = "craftrank.gl.del", SWAP = "craftrank.gl.swap";

    @Override
    public byte[] transform(ClassLoader loader, String name, Class<?> cls, ProtectionDomain pd, byte[] bytes) {
        if (name == null) return null;
        boolean gl = name.equals("org/lwjgl/opengl/GL11") || name.equals("org/lwjgl/opengl/GL11C");
        // Minecraft 26.x shows frames through SDL instead of GLFW
        boolean swap = name.equals("org/lwjgl/glfw/GLFW") || name.equals("org/lwjgl/opengl/Display") || name.equals("org/lwjgl/sdl/SDLVideo");
        if (!gl && !swap) return null;
        final String owner = name;
        try {
            ClassReader cr = new ClassReader(bytes);
            final boolean frames = (cr.readUnsignedShort(6) & 0xFFFF) >= 50;   // class files before Java 6 have no frames
            ClassWriter cw = new ClassWriter(cr, 0);
            final int[] n = {0};
            cr.accept(new ClassVisitor(Opcodes.ASM9, cw) {
                @Override
                public MethodVisitor visitMethod(int acc, String m, String desc, String sig, String[] ex) {
                    MethodVisitor mv = super.visitMethod(acc, m, desc, sig, ex);
                    if ((acc & Opcodes.ACC_STATIC) == 0 || (acc & Opcodes.ACC_NATIVE) != 0) return mv;
                    int kind = 0;
                    if (gl && m.equals("glTexSubImage2D") && (desc.equals("(IIIIIIIIJ)V") || desc.equals("(IIIIIIIILjava/nio/IntBuffer;)V") || desc.equals("(IIIIIIIILjava/nio/ByteBuffer;)V"))) kind = 1;
                    else if (gl && m.equals("glDeleteTextures") && desc.equals("(I)V")) kind = 2;
                    else if (swap && ((m.equals("glfwSwapBuffers") && desc.equals("(J)V")) || (m.equals("swapBuffers") && desc.equals("()V")) || (m.equals("SDL_GL_SwapWindow") && desc.equals("(J)Z")))) kind = 3;
                    if (kind == 0) return mv;
                    n[0]++;
                    return new Prologue(mv, kind, owner, desc, frames);
                }
            }, 0);
            if (n[0] == 0) return null;
            Log.info("animated capes ready (" + owner.substring(owner.lastIndexOf('/') + 1) + ")");
            return cw.toByteArray();
        } catch (Throwable t) {
            Log.info("animated capes off, could not patch " + owner + ": " + t);
            return null;
        }
    }

    static final class Prologue extends MethodVisitor {
        final int kind; final String owner, desc; final boolean frames;
        Prologue(MethodVisitor mv, int kind, String owner, String desc, boolean frames) { super(Opcodes.ASM9, mv); this.kind = kind; this.owner = owner; this.desc = desc; this.frames = frames; }

        @Override
        public void visitCode() {
            super.visitCode();
            Label skip = new Label(), nul = new Label();
            if (kind == 1) {
                // level 0, offset 0,0, width == 2 * height, width >= 64
                mv.visitVarInsn(Opcodes.ILOAD, 1); mv.visitJumpInsn(Opcodes.IFNE, skip);
                mv.visitVarInsn(Opcodes.ILOAD, 2); mv.visitJumpInsn(Opcodes.IFNE, skip);
                mv.visitVarInsn(Opcodes.ILOAD, 3); mv.visitJumpInsn(Opcodes.IFNE, skip);
                mv.visitVarInsn(Opcodes.ILOAD, 4); mv.visitVarInsn(Opcodes.ILOAD, 5); mv.visitInsn(Opcodes.ICONST_2); mv.visitInsn(Opcodes.IMUL);
                mv.visitJumpInsn(Opcodes.IF_ICMPNE, skip);
                mv.visitVarInsn(Opcodes.ILOAD, 4); mv.visitIntInsn(Opcodes.BIPUSH, 64); mv.visitJumpInsn(Opcodes.IF_ICMPLT, skip);
            }
            mv.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/System", "getProperties", "()Ljava/util/Properties;", false);
            mv.visitLdcInsn(kind == 1 ? TEX : kind == 2 ? DEL : SWAP);
            mv.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/Properties", "get", "(Ljava/lang/Object;)Ljava/lang/Object;", false);
            mv.visitInsn(Opcodes.DUP);
            mv.visitJumpInsn(Opcodes.IFNULL, nul);
            mv.visitTypeInsn(Opcodes.CHECKCAST, "java/util/function/Function");
            if (kind == 1) {
                mv.visitIntInsn(Opcodes.BIPUSH, 6);
                mv.visitTypeInsn(Opcodes.ANEWARRAY, "java/lang/Object");
                for (int i = 0; i < 4; i++) {   // width, height, format, type
                    mv.visitInsn(Opcodes.DUP); mv.visitIntInsn(Opcodes.BIPUSH, i); mv.visitVarInsn(Opcodes.ILOAD, 4 + i);
                    mv.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Integer", "valueOf", "(I)Ljava/lang/Integer;", false);
                    mv.visitInsn(Opcodes.AASTORE);
                }
                mv.visitInsn(Opcodes.DUP); mv.visitIntInsn(Opcodes.BIPUSH, 4);
                if (desc.endsWith("J)V")) { mv.visitVarInsn(Opcodes.LLOAD, 8); mv.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Long", "valueOf", "(J)Ljava/lang/Long;", false); }
                else mv.visitVarInsn(Opcodes.ALOAD, 8);
                mv.visitInsn(Opcodes.AASTORE);
                mv.visitInsn(Opcodes.DUP); mv.visitIntInsn(Opcodes.BIPUSH, 5); mv.visitLdcInsn(Type.getObjectType(owner)); mv.visitInsn(Opcodes.AASTORE);
            } else if (kind == 2) {
                mv.visitVarInsn(Opcodes.ILOAD, 0);
                mv.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Integer", "valueOf", "(I)Ljava/lang/Integer;", false);
            } else {
                mv.visitLdcInsn(Type.getObjectType(owner));
            }
            mv.visitMethodInsn(Opcodes.INVOKEINTERFACE, "java/util/function/Function", "apply", "(Ljava/lang/Object;)Ljava/lang/Object;", true);
            mv.visitInsn(Opcodes.POP);
            mv.visitJumpInsn(Opcodes.GOTO, skip);
            mv.visitLabel(nul);
            if (frames) mv.visitFrame(Opcodes.F_SAME1, 0, null, 1, new Object[]{"java/lang/Object"});
            mv.visitInsn(Opcodes.POP);
            mv.visitLabel(skip);
            if (frames) mv.visitFrame(Opcodes.F_SAME, 0, null, 0, null);
        }

        @Override
        public void visitMaxs(int stack, int locals) { super.visitMaxs(Math.max(stack, 10), locals); }
    }
}
