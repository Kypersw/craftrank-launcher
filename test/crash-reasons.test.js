// node test/crash-reasons.test.js — checks crashReason() against real-world log shapes from each loader
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const body = src.slice(src.indexOf('function crashReason(log)'), src.indexOf('\nfunction friendly('));
const crashReason = new Function('path', body + '\nreturn crashReason;')(path);
const cases = [
  ['NeoForge 26.x missing dependency', `[16:20:01] [main/ERROR] [net.neoforged.fml.loading.FMLLoader/]: Failed to start FML: net.neoforged.fml.ModLoadingException: Loading errors encountered:
	- Mod sodium requires fabric_api 0.92.0 or above
		Currently, fabric_api is not installed

	at net.neoforged.fml.ModLoader.dispatchAndHandleError(ModLoader.java:123)
	at net.neoforged.fml.ModLoader.gatherAndInitializeMods(ModLoader.java:99)`, /Mod loading failed: Mod sodium requires fabric_api.*Currently, fabric_api is not installed/],
  ['NeoForge invalid mod file', `Failed to start FML: net.neoforged.fml.ModLoadingException: Loading errors encountered:
	- File mods/OptiFine_1.21.jar is not a valid mod file
	at net.neoforged.fml.ModLoader.x(ModLoader.java:1)`, /not a valid mod file/],
  ['NeoForge wrong Minecraft version', `net.neoforged.fml.ModLoadingException: Loading errors encountered:
	- Mod create only supports Minecraft 1.21.1, but 26.3 is installed`, /only supports Minecraft 1\.21\.1/],
  ['Forge 1.20 crash report failure message', `---- Minecraft Crash Report ----
Description: Mod loading error has occurred

java.lang.Exception: Mod Loading has failed
	at net.minecraftforge.logging.CrashReportExtender.dumpModLoadingCrashReport(CrashReportExtender.java:55)

-- Mod loading issue for: create --
Details:
	Mod File: /C:/Users/Ali/AppData/Roaming/.craftrank/mods/create-1.20.1-0.5.1.jar
	Failure message: Create (create) has failed to load correctly
		java.lang.NoClassDefFoundError: com/jozufozu/flywheel/api/Material
	Mod Version: 0.5.1`, /Mod loading failed \(create\): Create \(create\) has failed to load correctly \(java\.lang\.NoClassDefFoundError/],
  ['Forge 1.20 missing mandatory dependency', `[main/ERROR] [net.minecraftforge.fml.loading.ModSorter/LOADING]: Missing or unsupported mandatory dependencies:
	Mod ID: 'flywheel', Requested by: 'create', Expected range: '[0.6.10,0.6.11)', Actual version: '[MISSING]'`, /Mod ID: 'flywheel', Requested by: 'create'/],
  ['Fabric missing dependency', `net.fabricmc.loader.impl.FormattedException: Mod resolution encountered an incompatible mod set!
A potential solution has been determined:
	 - Install fabric-api, any version.
Unmet dependency listing:
	 - Mod 'Sodium Extra' (sodium-extra) 0.5.1 requires any version of fabric-api, which is missing!`, /Incompatible mods: .*Sodium Extra.*requires/],
  ['Mixin needs Java 17', `java.lang.IllegalArgumentException: The requested compatibility level JAVA_17 could not be set. Level is not supported by the active JRE or ASM version`, /A mod needs Java 17/],
  ['Mixin apply failure', `[main/ERROR]: Mixin apply failed memoryleakfix.mixins.json:MixinX -> net.minecraft.class_1 from mod memoryleakfix
org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException: Critical injection failure`, /A mod does not work with this version: memoryleakfix/],
  ['Forge 1.12 wrong Java', `java.lang.ClassCastException: class jdk.internal.loader.ClassLoaders$AppClassLoader cannot be cast to class java.net.URLClassLoader`, /Wrong Java version/],
  ['Forge 1.12 exit trapped only', `[main/INFO]: Starting
net.minecraftforge.fml.relauncher.FMLSecurityManager$ExitTrappedException
	at net.minecraftforge.fml.relauncher.FMLSecurityManager.checkPermission(FMLSecurityManager.java:49)`, /A mod stopped the game during start-up/],
  ['Out of memory', `java.lang.OutOfMemoryError: Java heap space`, /OutOfMemoryError/],
  ['Plain crash report', `---- Minecraft Crash Report ----
Description: Rendering screen

java.lang.NullPointerException: Cannot invoke "x.y()" because "z" is null
	at a.b.c(d.java:1)`, /Rendering screen: java\.lang\.NullPointerException/],
  ['Generic wrapper with a real cause', `Exception in thread "main" java.lang.reflect.InvocationTargetException
	at sun.reflect.x
Caused by: java.lang.UnsatisfiedLinkError: Failed to load library lwjgl.dll`, /UnsatisfiedLinkError/],
  ['26.x Realms sign-in noise before the real crash', `[22:01:10] [Render thread/ERROR]: Couldn't fetch Realms info
com.mojang.realmsclient.exception.RealmsServiceException: Realms authentication error with message 'java.lang.RuntimeException: Failed to parse into SignedJWT: 0c9e384039ba326ebe61366a8bf5e96b'
	at com.mojang.realmsclient.client.RealmsClient.execute(RealmsClient.java:1)
[22:01:14] [Render thread/ERROR]: Unreported exception thrown!
java.lang.IllegalStateException: GLFW error 65543: WGL: OpenGL profile requested but WGL_ARB_create_context_profile is unavailable`, /GLFW error 65543/],
  ['26.x Realms sign-in noise only', `com.mojang.realmsclient.exception.RealmsServiceException: Realms authentication error with message 'java.lang.RuntimeException: Failed to parse into SignedJWT: 0c9e'
	at com.mojang.realmsclient.client.RealmsClient.execute(RealmsClient.java:1)`, /^(?![\s\S]*(Realms|SignedJWT))/],
];
let bad = 0;
for (const [name, log, want] of cases) {
  const got = crashReason(log);
  const ok = want.test(got);
  if (!ok) bad++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + '\n      ' + got);
}
console.log(bad ? bad + ' failed' : 'all ' + cases.length + ' passed');
process.exit(bad ? 1 : 0);
