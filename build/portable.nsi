# CraftRank portable .exe (replaces electron-builder's portable.nsi, see build/portable-template.js)
#
# electron-builder's portable .exe unpacks the whole app (~250 MB) into a temp folder on every start and
# deletes it on exit, so every start waits for the unpacking with nothing on screen. This one:
#  - unpacks each version once, into %LOCALAPPDATA%\CraftRank Launcher Portable\<version>, and reuses it;
#  - shows the CraftRank loading picture at once while it unpacks (first start of a version only);
#  - starts the launcher and exits, without waiting for it.
# The launcher removes folders of older versions itself.

!include "common.nsh"
!include "extractAppPackage.nsh"

CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

Var splash

Function .onInit
  !insertmacro check64BitAndSetRegView
  StrCpy $INSTDIR "$LOCALAPPDATA\CraftRank Launcher Portable\${VERSION}"
  # already unpacked: no window at all
  IfFileExists "$INSTDIR\.ready" 0 +2
    SetSilent silent
FunctionEnd

Function .onGUIInit
  InitPluginsDir
  # the installer's own window stays out of sight
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i -32000, i -32000, i 0, i 0, i 0x15)'
  # the loading picture: a plain borderless window in the middle of the screen
  File /oname=$PLUGINSDIR\splash.bmp "${BUILD_RESOURCES_DIR}\splash.bmp"
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\splash.bmp", i 0, i 0, i 0, i 0x10) p .r1'
  System::Call 'user32::GetSystemMetrics(i 0) i .r2'
  System::Call 'user32::GetSystemMetrics(i 1) i .r3'
  IntOp $2 $2 - 412
  IntOp $2 $2 / 2
  IntOp $3 $3 - 592
  IntOp $3 $3 / 2
  System::Call 'user32::CreateWindowExW(i 0x40000, w "STATIC", w "CraftRank Launcher", i 0x9000000E, i r2, i r3, i 412, i 592, p 0, p 0, p 0, p 0) p .r4'
  System::Call 'user32::SendMessageW(p r4, i 0x172, i 0, p r1)'
  StrCpy $splash $4
FunctionEnd

Section
  IfFileExists "$INSTDIR\.ready" run 0

  HideWindow
  RMDir /r $INSTDIR
  SetOutPath $INSTDIR

  !ifdef APP_DIR_64
    File /r "${APP_DIR_64}\*.*"
  !else
    !insertmacro extractEmbeddedAppPackage
  !endif

  FileOpen $0 "$INSTDIR\.ready" w
  FileWrite $0 "${VERSION}"
  FileClose $0

  run:
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0

  SetOutPath $INSTDIR
  Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0'
  # keep the picture up a moment, until the launcher's own loading window shows
  StrCmp $splash "" done
    Sleep 2500
    SendMessage $splash 0x0010 0 0
  done:
  SetOutPath $EXEDIR
SectionEnd
