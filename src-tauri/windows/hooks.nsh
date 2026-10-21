; Installer hooks for Shelf's NSIS setup (per-user, no admin rights).
;
; Tauri's per-user default folder is %LOCALAPPDATA%\Shelf, which is where Shelf keeps its caches (art, scan cache).
; The program goes to %LOCALAPPDATA%\Programs\Shelf instead — the folder the earlier (C#) build was installed to, so
; installing this one replaces it in place. A folder the user picked by hand is left alone.

!macro NSIS_HOOK_PREINSTALL
  ${If} $INSTDIR == "$LOCALAPPDATA\Shelf"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Shelf"
    SetOutPath $INSTDIR
  ${EndIf}
!macroend

; Turning off "Start with Windows" on uninstall: the sign-in task would otherwise point at a missing program.
!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::Exec 'schtasks.exe /Delete /TN "Shelf" /F'
  Pop $0
!macroend
