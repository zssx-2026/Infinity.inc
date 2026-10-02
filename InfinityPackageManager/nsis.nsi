; =====================================================
;  Infinity Package Manager 安装脚本
;  支持 install / repair / uninstall
;  记录每个文件的 SHA256 到 hash.ini / hash.txt / 注册表
;  编译前准备：
;    - Crypto.dll 位于 D:\丁陈子豪\Plugins\Crypto\x86-unicode
; =====================================================

!addplugindir "D:\丁陈子豪\Plugins\Crypto\x86-unicode"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "StrFunc.nsh"
!include "nsDialogs.nsh"

${StrStr}
${UnStrStr}
${UnStrRep}

!define PRODUCT_NAME    "Infinity Package Manager"
!define PRODUCT_VERSION "v1.0pre2"
!define UNINST_KEY      "Software\Microsoft\Windows\CurrentVersion\Uninstall\Infinity Package Manager"
!define HASH_KEY        "Software\Infinity Package Manager\Hashes"

OutFile "InfinityPackageManager_v1.0pre2_Setup.exe"
Name "${PRODUCT_NAME}"

CRCCheck off
RequestExecutionLevel admin

InstallDir "$PROGRAMFILES\Infinity Package Manager"
InstallDirRegKey HKLM "${UNINST_KEY}" "InstallLocation"

Var INSTALL_MODE     ; "install" / "repair" / "uninstall"
Var IS_INSTALLED     ; "0" / "1"
Var RADIO_INSTALL
Var RADIO_REPAIR
Var RADIO_UNINSTALL

; =====================================================
; 初始化
; =====================================================
Function .onInit
  StrCpy $IS_INSTALLED "0"
  StrCpy $INSTALL_MODE "install"

  ; 是否已安装
  ReadRegStr $0 HKLM "${UNINST_KEY}" "InstallLocation"
  ${If} $0 != ""
    StrCpy $IS_INSTALLED "1"
    StrCpy $INSTDIR $0
    StrCpy $INSTALL_MODE "repair"
  ${EndIf}

  ; 命令行 /uninstall
  ${StrStr} $1 "$CMDLINE" "/uninstall"
  ${If} $1 != ""
    StrCpy $INSTALL_MODE "uninstall"
  ${EndIf}

  ; 卸载模式：直接调用卸载程序
  ${If} $INSTALL_MODE == "uninstall"
    ${If} ${FileExists} "$INSTDIR\Uninstall.exe"
      ExecWait '"$INSTDIR\Uninstall.exe" _?=$INSTDIR'
      Quit
    ${Else}
      MessageBox MB_OK|MB_ICONEXCLAMATION "未找到卸载程序，${PRODUCT_NAME} 可能未正确安装。"
      Quit
    ${EndIf}
  ${EndIf}
FunctionEnd

; =====================================================
; 模式选择页面
; =====================================================
Function ModePageCreate
  ${If} $IS_INSTALLED != "1"
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "选择操作" "请选择要对 ${PRODUCT_NAME} 执行的操作。"

  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateRadioButton} 0 0 100% 12u "安装（重新安装，覆盖现有文件）"
  Pop $RADIO_INSTALL
  ${NSD_CreateRadioButton} 0 20u 100% 12u "修复（重新复制所有文件并重建哈希记录）"
  Pop $RADIO_REPAIR
  ${NSD_CreateRadioButton} 0 40u 100% 12u "卸载（删除已安装的 ${PRODUCT_NAME}）"
  Pop $RADIO_UNINSTALL

  ${If} $INSTALL_MODE == "install"
    ${NSD_SetState} $RADIO_INSTALL ${BST_CHECKED}
  ${ElseIf} $INSTALL_MODE == "uninstall"
    ${NSD_SetState} $RADIO_UNINSTALL ${BST_CHECKED}
  ${Else}
    ${NSD_SetState} $RADIO_REPAIR ${BST_CHECKED}
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function ModePageLeave
  ${NSD_GetState} $RADIO_INSTALL $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $INSTALL_MODE "install"
  ${EndIf}
  ${NSD_GetState} $RADIO_REPAIR $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $INSTALL_MODE "repair"
  ${EndIf}
  ${NSD_GetState} $RADIO_UNINSTALL $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $INSTALL_MODE "uninstall"
  ${EndIf}

  ; 如果选了卸载，立刻调用卸载程序
  ${If} $INSTALL_MODE == "uninstall"
    ${If} ${FileExists} "$INSTDIR\Uninstall.exe"
      ExecWait '"$INSTDIR\Uninstall.exe" _?=$INSTDIR'
    ${EndIf}
    Quit
  ${EndIf}
FunctionEnd

; =====================================================
; 页面
; =====================================================
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
Page custom ModePageCreate ModePageLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

; =====================================================
; 哈希计算
; =====================================================
Function ComputeHashes
  FileOpen $9 "$INSTDIR\hash.txt" w
  IfErrors hash_done

  Delete "$INSTDIR\hash.ini"
  DeleteRegKey HKLM "${HASH_KEY}"

  Push "$INSTDIR"
  Call HashDir

  FileClose $9

  hash_done:
FunctionEnd

; 递归遍历目录，计算每个文件的 SHA256
Function HashDir
  Exch $0     ; 当前目录
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5

  FindFirst $1 $2 "$0\*.*"
  hash_loop:
    StrCmp $2 "" hash_done
    StrCmp $2 "." hash_next
    StrCmp $2 ".." hash_next
    IfFileExists "$0\$2\*.*" hash_isdir hash_isfile

  hash_isdir:
    Push "$0\$2"
    Call HashDir
    Goto hash_next

  hash_isfile:
    Crypto::HashFile "SHA256" "$0\$2"
    Pop $3
    ; 计算相对路径
    StrLen $4 "$INSTDIR"
    StrCpy $5 "$0\$2" "" $4
    StrCpy $5 $5 "" 1   ; 去掉前导反斜杠
    ; 写入三处
    WriteINIStr "$INSTDIR\hash.ini" "Files" "$5" "$3"
    WriteRegStr  HKLM "${HASH_KEY}" "$5" "$3"
    FileWrite    $9 "$5=$3$\r$\n"

  hash_next:
    FindNext $1 $2
    Goto hash_loop

  hash_done:
    FindClose $1

  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; =====================================================
; 主程序
; =====================================================
Section "主程序" SEC_MAIN
  SectionIn RO
  SetOutPath $INSTDIR
  File /r "D:\丁陈子豪\InfinityPackageManager\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; 计算并记录哈希（在卸载器生成之后，确保 Uninstall.exe 也被纳入）
  Call ComputeHashes

  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName"     "${PRODUCT_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion"  "${PRODUCT_VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon"     "$INSTDIR\ipm_launcher.exe"
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
SectionEnd

; =====================================================
; 快捷方式
; =====================================================
Section "开始菜单快捷方式" SEC_STARTMENU
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\ipm_launcher.exe"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\卸载.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "桌面快捷方式" SEC_DESKTOP
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\ipm_launcher.exe"
SectionEnd

Section /o "开机自启动" SEC_AUTOSTART
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}" '"$INSTDIR\ipm_launcher.exe"'
SectionEnd

Section "添加到PATH" SEC_ADDPATH
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  ${StrStr} $1 $0 "$INSTDIR"
  ${If} $1 == ""
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$0;$INSTDIR"
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ${EndIf}
SectionEnd

Section "注册环境变量" SEC_ENVVARS
  ; 将各模式可执行文件与内置插件路径写入当前用户环境变量
  WriteRegStr HKCU "Environment" "ipmcli"       "$INSTDIR\ipm_cli.exe"
  WriteRegStr HKCU "Environment" "ipmtui"       "$INSTDIR\ipm_tui.exe"
  WriteRegStr HKCU "Environment" "ipmgui"       "$INSTDIR\ipm_gui.exe"
  WriteRegStr HKCU "Environment" "ipmlauncher"  "$INSTDIR\ipm_launcher.exe"
  WriteRegStr HKCU "Environment" "ipmxcli"      "$INSTDIR\ipmx_cli.exe"
  WriteRegStr HKCU "Environment" "ipmxtui"      "$INSTDIR\ipmx_tui.exe"
  WriteRegStr HKCU "Environment" "ipmxgui"      "$INSTDIR\ipmx_gui.exe"
  WriteRegStr HKCU "Environment" "ipmxlauncher" "$INSTDIR\ipmx_launcher.exe"
  WriteRegStr HKCU "Environment" "ipmfgit"      "$INSTDIR\plugins\fastgithub\FastGithub.UI.exe"
  WriteRegStr HKCU "Environment" "ipmaria"      "$INSTDIR\plugins\aria2\aria2c.exe"
  WriteRegStr HKCU "Environment" "ipmfreearc"   "$INSTDIR\plugins\freearc\Arc.exe"
  WriteRegStr HKCU "Environment" "ipm7z"        "$INSTDIR\plugins\7zip\7za.exe"
  ; 代理地址占位符，程序运行后自行填充
  WriteRegStr HKCU "Environment" "proxy_ip"     ""
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
SectionEnd

Section "安装后启动" SEC_RUN
  Exec '"$INSTDIR\ipm_launcher.exe"'
SectionEnd

; =====================================================
; 卸载
; =====================================================
Section "Uninstall"
  ; 从 PATH 中移除
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  ${UnStrStr} $1 $0 "$INSTDIR"
  ${If} $1 != ""
    ${UnStrRep} $2 $0 ";$INSTDIR" ""
    ${UnStrRep} $3 $2 "$INSTDIR;" ""
    ${UnStrRep} $4 $3 "$INSTDIR" ""
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$4"
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ${EndIf}

  ; 删除哈希记录（文件和注册表）
  DeleteRegKey HKLM "${HASH_KEY}"
  Delete "$INSTDIR\hash.ini"
  Delete "$INSTDIR\hash.txt"

  ; 删除文件
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"

  ; 删除快捷方式
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\卸载.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"

  ; 删除环境变量
  DeleteRegValue HKCU "Environment" "ipmcli"
  DeleteRegValue HKCU "Environment" "ipmtui"
  DeleteRegValue HKCU "Environment" "ipmgui"
  DeleteRegValue HKCU "Environment" "ipmlauncher"
  DeleteRegValue HKCU "Environment" "ipmxcli"
  DeleteRegValue HKCU "Environment" "ipmxtui"
  DeleteRegValue HKCU "Environment" "ipmxgui"
  DeleteRegValue HKCU "Environment" "ipmxlauncher"
  DeleteRegValue HKCU "Environment" "ipmfgit"
  DeleteRegValue HKCU "Environment" "ipmaria"
  DeleteRegValue HKCU "Environment" "ipmfreearc"
  DeleteRegValue HKCU "Environment" "ipm7z"
  DeleteRegValue HKCU "Environment" "proxy_ip"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; 删除注册表
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegKey HKLM "Software\Infinity Package Manager"
SectionEnd

; =====================================================
; 组件说明（须置于所有 Section 声明之后）
; =====================================================
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_ENVVARS} "将 ipm 各模式可执行文件与内置插件路径写入当前用户环境变量（HKCU\Environment），并广播设置变更。"
!insertmacro MUI_FUNCTION_DESCRIPTION_END