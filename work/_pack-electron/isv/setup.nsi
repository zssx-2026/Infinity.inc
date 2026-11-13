Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!define PRODUCT "Infinity Server"
!define VERSION "1.0.0-pre8"
!define MUI_ICON "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\icons\isv.ico"
!define MUI_UNICON "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\icons\isv.ico"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Infinity.Inc.InfinityServer"
VIProductVersion "1.0.0.8"
VIAddVersionKey /LANG=2052 "ProductName" "Infinity Server"
VIAddVersionKey /LANG=2052 "CompanyName" "Infinity.Inc"
VIAddVersionKey /LANG=2052 "FileDescription" "Infinity Server Setup"
VIAddVersionKey /LANG=2052 "FileVersion" "1.0.0-pre8"
VIAddVersionKey /LANG=2052 "ProductVersion" "1.0.0-pre8"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Copyright (C) Infinity.Inc"
Name "${PRODUCT} ${VERSION}"
OutFile "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\cpp\release\v1.0pre8\InfinityServer_1.0.0-pre8_win64_setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Infinity.Inc\${PRODUCT}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails nevershow
ShowUninstDetails nevershow
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Install" SEC_INSTALL
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_pack-electron\isv\payload\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Infinity.Inc\Infinity Server"
  CreateShortCut "$SMPROGRAMS\Infinity.Inc\Infinity Server\Open.lnk" "$INSTDIR\InfinityServer.exe" "" "$INSTDIR\isv.ico" 0
  CreateShortCut "$SMPROGRAMS\Infinity.Inc\Infinity Server\Uninstall.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\isv.ico" 0
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\isv.ico"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "Infinity.Inc"
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  DeleteRegKey HKCU "${UNKEY}"
  Delete "$SMPROGRAMS\Infinity.Inc\Infinity Server\Open.lnk"
  Delete "$SMPROGRAMS\Infinity.Inc\Infinity Server\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Infinity.Inc\Infinity Server"
  RMDir "$SMPROGRAMS\Infinity.Inc"
  RMDir /r "$INSTDIR"
SectionEnd
