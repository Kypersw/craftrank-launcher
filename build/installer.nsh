; CraftRank Launcher installer additions (electron-builder "nsis.include").

; electron-builder's own check for a running launcher starts PowerShell three times. On Windows 11
; those flash console windows during every update. The launcher closes itself before it runs the
; installer, so this check only waits until the .exe is free to overwrite (no extra programs, no
; windows), and only if it is still in use after 15 seconds closes it the way the default would.
!macro customCheckAppRunning
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    StrCpy $R8 0
    ${Do}
      ClearErrors
      FileOpen $R9 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" a
      ${IfNot} ${Errors}
        FileClose $R9
        ${Break}
      ${EndIf}
      IntOp $R8 $R8 + 1
      ${If} $R8 = 30
        ${IfNot} ${Silent}
          ${If} ${Cmd} `MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" IDCANCEL`
            Quit
          ${EndIf}
        ${EndIf}
        nsExec::Exec `taskkill /IM "${APP_EXECUTABLE_FILENAME}" /F`
        Pop $R9
      ${EndIf}
      ${If} $R8 > 40
        ${Break}
      ${EndIf}
      Sleep 500
    ${Loop}
  ${EndIf}
!macroend
