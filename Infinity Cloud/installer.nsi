; =====================================================
;  Infinity Cloud installer
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
${StrRep}
${UnStrStr}
${UnStrRep}

!define PRODUCT_NAME    "Infinity Cloud"
!define PRODUCT_VERSION "@@VERSION@@"
!define UNINST_KEY      "Software\Microsoft\Windows\CurrentVersion\Uninstall\Infinity Cloud"
!define HASH_KEY        "Software\Infinity Cloud\Hashes"

OutFile "@@OUTFILE@@"
Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"

; 安装器、卸载器与所有快捷方式共用同一枚图标：make-setup.mjs 把
; Infinity.inc/icons/inc.ico（Infinity Cloud）复制进载荷，这里直接引用
; 载荷里的那一份，安装后它落在 $INSTDIR\inc.ico。
!define MUI_ICON   "@@APP_DIR@@\inc.ico"
!define MUI_UNICON "@@APP_DIR@@\inc.ico"

CRCCheck off
RequestExecutionLevel admin
SetCompressor /SOLID lzma

InstallDir "$PROGRAMFILES64\Infinity Cloud"
InstallDirRegKey HKLM "${UNINST_KEY}" "InstallLocation"

Var INSTALL_MODE      ; install / uninstall
Var IS_INSTALLED      ; "0" / "1"
Var RADIO_UPDATE      ; 更新：覆盖已安装的版本
Var RADIO_COEXIST     ; 安装：与已安装的版本共存
Var RADIO_UNINSTALL
Var INSTALLED_VERSION ; 注册表里记录的版本
Var VERSION_ORDER     ; -1 本包较新，0 相同，1 本包较旧
Var UNINST_KEY_THIS   ; 本次写入的卸载项；共存时带版本号
Var HASH_KEY_THIS     ; 本次写入的哈希项；共存时带版本号
Var LABEL_THIS        ; 目录与快捷方式上的名字；共存时带版本号

; =====================================================
; 版本比较
; =====================================================

; 把版本号压成一个整数：主 * 1000000 + 次 * 1000 + 修订。
;
; 这样排出来的顺序才是对的 —— 1.1.10 大于 1.1.6，而按字符串比较会得出相反的
; 结果。第三个数字之后的内容（例如 1.0pre1 的 pre1）终止解析，所以 1.0pre1 与
; 1.0 得到同一个数。压入字符串，弹出整数。
Function VersionInt
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $9

  ; 开头的 v 是装饰，不是数字
  StrCpy $1 $0 1
  ${If} $1 == "v"
    StrCpy $0 $0 "" 1
  ${ElseIf} $1 == "V"
    StrCpy $0 $0 "" 1
  ${EndIf}

  StrCpy $2 0          ; 累计结果
  StrCpy $3 0          ; 当前这一段的值
  StrCpy $4 0          ; 段序号：0 主，1 次，2 修订
  StrCpy $5 0          ; 字符位置
  StrLen $6 "0123456789"

  vi_loop:
    StrCpy $1 $0 1 $5
    StrCmp $1 "" vi_end
    StrCmp $1 "." vi_dot

    ; 一个字符的数值就是它在数字串里的位置，所以查找并量一下剩余长度，
    ; 比连写十次比较更短也更清楚。
    ${StrStr} $7 "0123456789" "$1"
    ${If} $7 == ""
      Goto vi_end
    ${EndIf}
    StrLen $7 $7
    IntOp $7 $6 - $7

    IntOp $3 $3 * 10
    IntOp $3 $3 + $7
    IntOp $5 $5 + 1
    Goto vi_loop

  vi_dot:
    Call vi_fold
    StrCpy $3 0
    IntOp $4 $4 + 1
    IntOp $5 $5 + 1
    ${If} $4 > 2
      Goto vi_end
    ${EndIf}
    Goto vi_loop

  vi_end:
    Call vi_fold

  Pop $9
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  StrCpy $0 $2
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; 把正在拼的那一段放进总数里。函数内的标签不能被 Call，所以这是第二个函数。
Function vi_fold
  ${If} $4 == 0
    IntOp $9 $3 * 1000000
  ${ElseIf} $4 == 1
    IntOp $9 $3 * 1000
  ${Else}
    StrCpy $9 $3
  ${EndIf}
  IntOp $2 $2 + $9
FunctionEnd

; =====================================================
; 初始化
; =====================================================
Function .onInit
  StrCpy $IS_INSTALLED "0"
  StrCpy $INSTALL_MODE "install"
  StrCpy $VERSION_ORDER "0"
  StrCpy $UNINST_KEY_THIS "${UNINST_KEY}"
  StrCpy $HASH_KEY_THIS "${HASH_KEY}"
  StrCpy $LABEL_THIS "${PRODUCT_NAME}"

  ; 是否已安装
  ReadRegStr $0 HKLM "${UNINST_KEY}" "InstallLocation"
  ReadRegStr $INSTALLED_VERSION HKLM "${UNINST_KEY}" "DisplayVersion"
  ${If} $0 != ""
    StrCpy $IS_INSTALLED "1"
    StrCpy $INSTDIR $0
    StrCpy $INSTALL_MODE "repair"

    Push "$INSTALLED_VERSION"
    Call VersionInt
    Pop $1
    Push "${PRODUCT_VERSION}"
    Call VersionInt
    Pop $2
    ${If} $1 > $2
      StrCpy $VERSION_ORDER "1"
    ${ElseIf} $1 < $2
      StrCpy $VERSION_ORDER "-1"
    ${EndIf}

    ; 本包较新或版本相同时，覆盖安装就是升级，不再多问一句。
    ; 只有本包比已装的旧，才会在模式页上问更新还是共存。
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
  ; 没装过，或者本包不比已装的新，都不必问。
  ${If} $IS_INSTALLED != "1"
    Abort
  ${EndIf}
  ${If} $VERSION_ORDER != "1"
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "选择操作" "已安装 $INSTALLED_VERSION，本安装包为 ${PRODUCT_VERSION}。"

  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateLabel} 0 0 100% 20u "已安装的版本较新。请选择如何处理。"
  Pop $0

  ${NSD_CreateRadioButton} 0 26u 100% 12u "更新（用 ${PRODUCT_VERSION} 覆盖已安装的 $INSTALLED_VERSION）"
  Pop $RADIO_UPDATE
  ${NSD_CreateRadioButton} 0 46u 100% 12u "安装（两个版本共存，各用各的目录）"
  Pop $RADIO_COEXIST
  ${NSD_CreateRadioButton} 0 66u 100% 12u "卸载（删除已安装的 ${PRODUCT_NAME}）"
  Pop $RADIO_UNINSTALL

  ; 更新会丢掉已装的新版本，所以默认选共存。
  ${If} $INSTALL_MODE == "uninstall"
    ${NSD_SetState} $RADIO_UNINSTALL ${BST_CHECKED}
  ${Else}
    ${NSD_SetState} $RADIO_COEXIST ${BST_CHECKED}
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function ModePageLeave
  ${NSD_GetState} $RADIO_COEXIST $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $INSTALL_MODE "coexist"
  ${EndIf}
  ${NSD_GetState} $RADIO_UNINSTALL $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $INSTALL_MODE "uninstall"
  ${EndIf}

  ; 选卸载就立刻交给已装的卸载器，本次安装到此为止。
  ${If} $INSTALL_MODE == "uninstall"
    ${If} ${FileExists} "$INSTDIR\Uninstall.exe"
      ExecWait '"$INSTDIR\Uninstall.exe" _?=$INSTDIR'
    ${EndIf}
    Quit
  ${EndIf}

  ; 共存：目录、卸载项、哈希项和显示名都带上版本号，
  ; 否则第二次安装会覆盖第一次留下的记录，两个版本就只剩一个能卸载。
  ${If} $INSTALL_MODE == "coexist"
    StrCpy $LABEL_THIS "${PRODUCT_NAME} ${PRODUCT_VERSION}"
    StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCT_NAME} ${PRODUCT_VERSION}"
    StrCpy $UNINST_KEY_THIS "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME} ${PRODUCT_VERSION}"
    StrCpy $HASH_KEY_THIS "Software\${PRODUCT_NAME}\Hashes\${PRODUCT_VERSION}"
  ${EndIf}
FunctionEnd

; =====================================================
; 页面
; =====================================================
!define MUI_ABORTWARNING
ShowInstDetails show
ShowUnInstDetails show
!insertmacro MUI_PAGE_WELCOME
Page custom ModePageCreate ModePageLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
; =====================================================
; 组件说明

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "TradChinese"
!insertmacro MUI_LANGUAGE "English"

; =====================================================
; 哈希计算
; =====================================================
Function ComputeHashes
  FileOpen $9 "$INSTDIR\hash.txt" w
  IfErrors hash_done

  Delete "$INSTDIR\hash.ini"
  DeleteRegKey HKLM "$HASH_KEY_THIS"

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
    WriteRegStr  HKLM "$HASH_KEY_THIS" "$5" "$3"
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
  File /r "@@APP_DIR@@\\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; 计算并记录哈希（在卸载器生成之后，确保 Uninstall.exe 也被纳入）
  Call ComputeHashes

  ; 写入本次安装自己的卸载项。共存的版本各占一个键，两个都能单独卸载。
  WriteRegStr HKLM "$UNINST_KEY_THIS" "DisplayName"     "$LABEL_THIS"
  WriteRegStr HKLM "$UNINST_KEY_THIS" "Publisher"       "Infinity.Inc"
  WriteRegStr HKLM "$UNINST_KEY_THIS" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKLM "$UNINST_KEY_THIS" "DisplayVersion"  "${PRODUCT_VERSION}"
  WriteRegStr HKLM "$UNINST_KEY_THIS" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "$UNINST_KEY_THIS" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "$UNINST_KEY_THIS" "DisplayIcon"     "$INSTDIR\inc.ico"
  WriteRegDWORD HKLM "$UNINST_KEY_THIS" "NoModify" 1
  WriteRegDWORD HKLM "$UNINST_KEY_THIS" "NoRepair" 1

  ; 卸载器是独立程序，安装时的变量不会跟过去，所以把本次安装用的
  ; 名字和两个注册表键写在安装目录里，卸载时读回来。
  WriteINIStr "$INSTDIR\uninstall.ini" "install" "Label" "$LABEL_THIS"
  WriteINIStr "$INSTDIR\uninstall.ini" "install" "UninstKey" "$UNINST_KEY_THIS"
  WriteINIStr "$INSTDIR\uninstall.ini" "install" "HashKey" "$HASH_KEY_THIS"
SectionEnd

; =====================================================
; 快捷方式
; =====================================================
Section "开始菜单快捷方式" SEC_STARTMENU
  ; 用本次安装的名字，共存的版本各有一个程序组，快捷方式不会互相覆盖。
  CreateDirectory "$SMPROGRAMS\$LABEL_THIS"
  ; 第四个参数是图标文件，0 是图标序号。不写的话（目标 exe 是注入过
  ; SEA 的 node.exe）快捷方式会显示 Node 的默认图标，而不是产品图标。
  CreateShortCut "$SMPROGRAMS\$LABEL_THIS\$LABEL_THIS.lnk" "$INSTDIR\@@EXE@@" "" "$INSTDIR\inc.ico" 0
  CreateShortCut "$SMPROGRAMS\$LABEL_THIS\卸载.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\inc.ico" 0
SectionEnd

Section "桌面快捷方式" SEC_DESKTOP
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\@@EXE@@" "" "$INSTDIR\inc.ico" 0
SectionEnd

Section /o "开机自启动" SEC_AUTOSTART
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "$LABEL_THIS" '"$INSTDIR\@@EXE@@"'
SectionEnd

Section "添加到PATH" SEC_ADDPATH
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  ${StrStr} $1 $0 "$INSTDIR"
  ${If} $1 == ""
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$0;$INSTDIR"
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ${EndIf}
SectionEnd

Section "安装后启动" SEC_RUN
  Exec '"$INSTDIR\@@EXE@@"'
SectionEnd

; =====================================================
; Infinity 环境变量
;
; 每个程序位置都写成一个环境变量，命令行与其它应用据此找到它，
; 不需要记住安装目录，也不依赖 PATH 的顺序。
;
; 写在 HKCU 而不是 HKLM：这些值里既有程序位置，也有属于当前用户的
; 东西（token、云盘仓库），换用户登录不应该继承上一个人的。
; 写完后广播 WM_SETTINGCHANGE，已经打开的进程才会看到新值。
; =====================================================
Section "注册环境变量" SEC_ENVVARS
  ; 用户 token 与云盘仓库链接：安装时只占位，登录后由程序写入。
  ; 用户名里的空格换成下划线，因为环境变量名不能有空格。
  ReadEnvStr $2 "USERNAME"
  ${StrRep} $2 $2 " " "_"

  ; 程序位置
  WriteRegStr HKCU "Environment" "inccli"      "$INSTDIR\inc_cli.exe"
  WriteRegStr HKCU "Environment" "inctui"      "$INSTDIR\inc_tui.exe"
  WriteRegStr HKCU "Environment" "incgui"      "$INSTDIR\inc_gui.exe"
  WriteRegStr HKCU "Environment" "inclauncher" "$INSTDIR\inc_launcher.exe"
  WriteRegStr HKCU "Environment" "inxcli"      "$INSTDIR\inx_cli.exe"
  WriteRegStr HKCU "Environment" "inxtui"      "$INSTDIR\inx_tui.exe"
  WriteRegStr HKCU "Environment" "inxgui"      "$INSTDIR\inx_gui.exe"
  WriteRegStr HKCU "Environment" "inxlauncher" "$INSTDIR\inx_launcher.exe"

  ; 内置插件
  WriteRegStr HKCU "Environment" "incfgit"    "$INSTDIR\plugins\fastgithub\FastGithub.UI.exe"
  WriteRegStr HKCU "Environment" "incaria"    "$INSTDIR\plugins\aria2\aria2c.exe"
  WriteRegStr HKCU "Environment" "incfreearc" "$INSTDIR\plugins\freearc\Arc.exe"
  WriteRegStr HKCU "Environment" "inc7z"      "$INSTDIR\plugins\7zip\7za.exe"

  ; 默认资源管理器：def 表示用系统默认，否则是资源管理器主程序的绝对路径。
  ; 已经设过就不覆盖 —— 用户可能指向了自己的文件管理器。
  ReadRegStr $3 HKCU "Environment" "def_fm"
  ${If} $3 == ""
    WriteRegStr HKCU "Environment" "def_fm" "def"
  ${EndIf}

  ; 代理地址，多个用逗号分隔。留空表示直连，由用户在设置里填。
  ReadRegStr $3 HKCU "Environment" "proxy_ip"
  ${If} $3 == ""
    WriteRegStr HKCU "Environment" "proxy_ip" ""
  ${EndIf}

  ; 属于本用户的键：只在还没有值的时候占位，避免覆盖已登录的信息。
  ReadRegStr $3 HKCU "Environment" "user_token-$2"
  ${If} $3 == ""
    WriteRegStr HKCU "Environment" "user_token-$2" ""
  ${EndIf}
  ReadRegStr $3 HKCU "Environment" "cloudhub-$2"
  ${If} $3 == ""
    WriteRegStr HKCU "Environment" "cloudhub-$2" ""
  ${EndIf}

  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
SectionEnd
; =====================================================
; 组件页默认只列出名字，勾选框旁边没有一句话说明它做什么。这几行把每个
; 组件的用途写在页面下方，选中哪个就显示哪个。
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MAIN} "主程序与运行库（必需）"
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_STARTMENU} "在开始菜单建立程序组和卸载入口"
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP} "在桌面建立快捷方式"
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_AUTOSTART} "登录后自动启动（默认不选）"
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_ADDPATH} "把安装目录加入 PATH，命令行可直接调用"
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_ENVVARS} "注册 inc*/inx* 程序位置与插件路径等环境变量"
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_RUN} "安装结束后立即运行"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; =====================================================
; 卸载器初始化
; =====================================================
; 从安装目录里的 uninstall.ini 把本次安装用的名字与键读回来。读不到就
; 退回编译时的默认值，这样早先装下的版本也能正常卸载。
Function un.onInit
  ReadINIStr $LABEL_THIS "$INSTDIR\uninstall.ini" "install" "Label"
  ReadINIStr $UNINST_KEY_THIS "$INSTDIR\uninstall.ini" "install" "UninstKey"
  ReadINIStr $HASH_KEY_THIS "$INSTDIR\uninstall.ini" "install" "HashKey"

  StrCmp $LABEL_THIS "" 0 +2
  StrCpy $LABEL_THIS "${PRODUCT_NAME}"
  StrCmp $UNINST_KEY_THIS "" 0 +2
  StrCpy $UNINST_KEY_THIS "${UNINST_KEY}"
  StrCmp $HASH_KEY_THIS "" 0 +2
  StrCpy $HASH_KEY_THIS "${HASH_KEY}"
FunctionEnd

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

  ; 只删本次安装留下的哈希记录。
  DeleteRegKey HKLM "$HASH_KEY_THIS"
  Delete "$INSTDIR\hash.ini"
  Delete "$INSTDIR\hash.txt"

  ; 环境变量：只删指向本次安装目录的那些，用户自己的 token 与仓库链接不动。
  ; 卸载器里的字符串函数必须用 Un 版，普通版会 Call 到安装段里不存在的标签。
  ReadEnvStr $2 "USERNAME"
  ${UnStrRep} $2 $2 " " "_"
  DeleteRegValue HKCU "Environment" "inccli"
  DeleteRegValue HKCU "Environment" "inctui"
  DeleteRegValue HKCU "Environment" "incgui"
  DeleteRegValue HKCU "Environment" "inclauncher"
  DeleteRegValue HKCU "Environment" "inxcli"
  DeleteRegValue HKCU "Environment" "inxtui"
  DeleteRegValue HKCU "Environment" "inxgui"
  DeleteRegValue HKCU "Environment" "inxlauncher"
  DeleteRegValue HKCU "Environment" "incfgit"
  DeleteRegValue HKCU "Environment" "incaria"
  DeleteRegValue HKCU "Environment" "incfreearc"
  DeleteRegValue HKCU "Environment" "inc7z"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; 快捷方式、自启动和卸载项都按本次安装的名字删，共存的另一个版本不动。
  Delete "$SMPROGRAMS\$LABEL_THIS\$LABEL_THIS.lnk"
  Delete "$SMPROGRAMS\$LABEL_THIS\卸载.lnk"
  RMDir "$SMPROGRAMS\$LABEL_THIS"
  Delete "$DESKTOP\$LABEL_THIS.lnk"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "$LABEL_THIS"
  DeleteRegKey HKLM "$UNINST_KEY_THIS"

  ; 最后一个版本走掉之后，把产品级的键也收干净。
  DeleteRegKey /ifempty HKLM "Software\${PRODUCT_NAME}\Hashes"
  DeleteRegKey /ifempty HKLM "Software\${PRODUCT_NAME}"

  Delete "$INSTDIR\uninstall.ini"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"
SectionEnd
