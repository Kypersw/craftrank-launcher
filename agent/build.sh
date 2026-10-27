#!/bin/sh
# Builds craftrank-skins.jar (Java 8 bytecode) into ../src/agent/
set -e
cd "$(dirname "$0")"
CP=lib/asm.jar:lib/asm-commons.jar:lib/asm-tree.jar
rm -rf build && mkdir -p build/classes build/tools ../src/agent
javac --release 8 -nowarn -cp $CP -d build/classes $(find src -name '*.java')
javac -cp $CP -d build/tools tools/Shade.java
java -cp build/tools:$CP Shade build/classes ../src/agent/craftrank-skins.jar lib/asm.jar
echo built ../src/agent/craftrank-skins.jar
