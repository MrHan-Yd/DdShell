!include LogicLib.nsh

!define DDSHELL_UPDATE_BACKUP_DIR "$TEMP\DdShell-update-data"

!macro DDSHELL_BACKUP_RUNTIME_FILE FILE_NAME
  ${If} ${FileExists} "$INSTDIR\${FILE_NAME}"
    CopyFiles /SILENT "$INSTDIR\${FILE_NAME}" "${DDSHELL_UPDATE_BACKUP_DIR}\${FILE_NAME}"
  ${EndIf}
!macroend

!macro DDSHELL_RESTORE_RUNTIME_FILE FILE_NAME
  ${IfNot} ${FileExists} "$INSTDIR\${FILE_NAME}"
  ${AndIf} ${FileExists} "${DDSHELL_UPDATE_BACKUP_DIR}\${FILE_NAME}"
    CopyFiles /SILENT "${DDSHELL_UPDATE_BACKUP_DIR}\${FILE_NAME}" "$INSTDIR\${FILE_NAME}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} ${FileExists} "$INSTDIR\shell.db"
    RMDir /r "${DDSHELL_UPDATE_BACKUP_DIR}"
    CreateDirectory "${DDSHELL_UPDATE_BACKUP_DIR}"
    !insertmacro DDSHELL_BACKUP_RUNTIME_FILE "shell.db"
    !insertmacro DDSHELL_BACKUP_RUNTIME_FILE "shell.db-wal"
    !insertmacro DDSHELL_BACKUP_RUNTIME_FILE "shell.db-shm"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "${DDSHELL_UPDATE_BACKUP_DIR}\shell.db"
    !insertmacro DDSHELL_RESTORE_RUNTIME_FILE "shell.db"
    !insertmacro DDSHELL_RESTORE_RUNTIME_FILE "shell.db-wal"
    !insertmacro DDSHELL_RESTORE_RUNTIME_FILE "shell.db-shm"
    RMDir /r "${DDSHELL_UPDATE_BACKUP_DIR}"
  ${EndIf}
!macroend
