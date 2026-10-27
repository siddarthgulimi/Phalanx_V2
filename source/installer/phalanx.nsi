; Phalanx Windows installer (per-user, no admin rights needed).
; Built with: makensis -DEDITION=original -DEDLABEL=Original -DSRC=<stage dir> -DOUT=<setup.exe> phalanx.nsi
Unicode true
!include "MUI2.nsh"

Name "Phalanx (${EDLABEL} edition)"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\Phalanx"
InstallDirRegKey HKCU "Software\Phalanx" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Phalanx 2.0 — DOM Integrity & Threat Monitor"

VIProductVersion "2.0.0.0"
VIAddVersionKey "ProductName" "Phalanx"
VIAddVersionKey "FileDescription" "Phalanx Setup (${EDLABEL} edition)"
VIAddVersionKey "FileVersion" "2.0.0"
VIAddVersionKey "ProductVersion" "2.0.0"
VIAddVersionKey "LegalCopyright" "Phalanx contributors"

!define MUI_ICON "${SRC}\icon.ico"
!define MUI_UNICON "${SRC}\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install Phalanx"
!define MUI_WELCOMEPAGE_TEXT "Phalanx protects your browser against fake login forms, malicious scripts, clickjacking, phishing / piracy sites and risky downloads.$\r$\n$\r$\nThis installs:$\r$\n  • Phalanx.exe — the desktop app (dashboard, threat analysis, history, settings)$\r$\n  • the browser extension folder (load it in Chrome / Edge)$\r$\n$\r$\nNo administrator rights are needed. Nothing is sent to the internet."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Phalanx.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Phalanx now"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\extension"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Open the extension folder (for Chrome → Load unpacked)"
!define MUI_FINISHPAGE_LINK "Installation guide"
!define MUI_FINISHPAGE_LINK_LOCATION "$INSTDIR\INSTALL.txt"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Phalanx" SecMain
  SectionIn RO
  ; stop a running engine so files can be replaced
  nsExec::Exec 'taskkill /IM Phalanx.exe /F'
  SetOutPath "$INSTDIR"
  File "${SRC}\Phalanx.exe"
  File "${SRC}\README.md"
  File "${SRC}\INSTALL.txt"
  File "${SRC}\icon.ico"
  SetOutPath "$INSTDIR\extension"
  File /r "${SRC}\extension\*.*"
  SetOutPath "$INSTDIR"

  CreateDirectory "$SMPROGRAMS\Phalanx"
  CreateShortcut "$SMPROGRAMS\Phalanx\Phalanx.lnk" "$INSTDIR\Phalanx.exe" "" "$INSTDIR\icon.ico"
  CreateShortcut "$SMPROGRAMS\Phalanx\Extension folder.lnk" "$INSTDIR\extension"
  CreateShortcut "$SMPROGRAMS\Phalanx\Uninstall Phalanx.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Phalanx.lnk" "$INSTDIR\Phalanx.exe" "" "$INSTDIR\icon.ico"

  WriteRegStr HKCU "Software\Phalanx" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phalanx" "DisplayName" "Phalanx (${EDLABEL} edition)"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phalanx" "DisplayVersion" "2.0.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phalanx" "Publisher" "Phalanx"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phalanx" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phalanx" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phalanx" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phalanx" "NoRepair" 1
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM Phalanx.exe /F'
  Delete "$INSTDIR\Phalanx.exe"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\INSTALL.txt"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\extension"
  MessageBox MB_YESNO "Also delete your Phalanx history, settings and cache (PhalanxData folder)?" IDNO keepdata
    RMDir /r "$INSTDIR\PhalanxData"
  keepdata:
  RMDir "$INSTDIR"
  Delete "$DESKTOP\Phalanx.lnk"
  RMDir /r "$SMPROGRAMS\Phalanx"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phalanx"
  DeleteRegKey HKCU "Software\Phalanx"
  DeleteRegKey HKCU "Software\Classes\phalanx"
SectionEnd
