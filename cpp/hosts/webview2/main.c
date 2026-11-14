/*
 * main.c - minimal WebView2 (Evergreen) host for the Infinity Edge UI shell.
 *
 * The application ships no Chromium kernel: it uses the WebView2 Runtime that
 * is already installed on the machine (Evergreen channel). Only this exe, the
 * SDK's WebView2Loader.dll and the local UI assets are shipped.
 *
 * Flow: CreateCoreWebView2EnvironmentWithOptions -> ICoreWebView2Controller ->
 * ICoreWebView2 -> Navigate(file:///.../ui/index.html?host=1&theme=..) ->
 * NavigationCompleted -> DOM probe (ExecuteScript) -> screenshot
 * (CapturePreview) -> result JSON -> exit. Window/theme/kernel settings are
 * configured to drop browser chrome the shell draws itself.
 *
 * Build: see build.ps1 (MinGW-w64 gcc, C mode; WebView2.h is MIDL C bindings).
 */
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <objbase.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include "WebView2.h"

#define MAXP 4096

typedef struct {
  HWND hwnd;
  ICoreWebView2Environment *env;
  ICoreWebView2Controller *controller;
  ICoreWebView2 *webview;
  IStream *shotStream;

  wchar_t uiDir[MAXP];
  wchar_t url[MAXP];
  wchar_t query[512];
  wchar_t screenshot[MAXP];
  wchar_t probeOut[MAXP];
  wchar_t resultOut[MAXP];
  wchar_t userData[MAXP];
  wchar_t fixedRuntime[MAXP];
  wchar_t browserArgs[1024];
  wchar_t runtimeVersion[128];
  wchar_t theme[16];
  wchar_t error[1024];
  /* Shell mode: the host owns the product window, so it can start the app's UI
   * server itself (--spawn/--port), stay on screen until the user closes it
   * (--show) and carry the product name in the title (--title). */
  wchar_t title[MAXP];
  wchar_t spawnExe[MAXP];
  wchar_t spawnArgs[1024];
  wchar_t appName[64];
  HANDLE job;
  int port, waitMs;
  int show, interactive;
  int width, height, holdMs, timeoutMs;
  int ok;

  LARGE_INTEGER qpc0, freq;
  double tEnv, tController, tNav, tProbe, tShot, tTotal;

  int navDone, probeDone, shotDone, finished;
  wchar_t probeJson[8192];
  wchar_t bridge[4096];
  int bridgeCount;
  /* Window protocol: the shell draws the only chrome the user sees, so its
   * buttons post shell.window and the host is the side that can move a real
   * window. Every action is applied here and recorded for the probe report. */
  wchar_t winLog[1024];
  int winAcks;
  int msgTest, msgTestDone;
} Host;

static Host g;

/* ---------- small helpers ---------- */

static void copyW(wchar_t *dst, const wchar_t *src, size_t cap) {
  if (!cap) return;
  wcsncpy(dst, src ? src : L"", cap - 1);
  dst[cap - 1] = 0;
}

static double nowMs(void) {
  LARGE_INTEGER t;
  QueryPerformanceCounter(&t);
  return (double)(t.QuadPart - g.qpc0.QuadPart) * 1000.0 / (double)g.freq.QuadPart;
}

static void logLine(const wchar_t *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  vfwprintf(stdout, fmt, ap);
  va_end(ap);
  fputc('\n', stdout);
  fflush(stdout);
}

static int fileExistsW(const wchar_t *p) {
  DWORD a = GetFileAttributesW(p);
  return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

/* Join a directory and a file with a backslash. */
static void joinW(wchar_t *out, size_t cap, const wchar_t *dir, const wchar_t *name) {
  wchar_t tmp[MAXP];
  copyW(tmp, dir, MAXP);
  size_t n = wcslen(tmp);
  if (n && tmp[n - 1] == L'\\') tmp[n - 1] = 0;
  _snwprintf(out, cap, L"%ls\\%ls", tmp, name);
  out[cap - 1] = 0;
}

static void pathToFileUrl(wchar_t *out, size_t cap, const wchar_t *path) {
  wchar_t p[MAXP];
  copyW(p, path, MAXP);
  for (wchar_t *q = p; *q; q++) if (*q == L'\\') *q = L'/';
  _snwprintf(out, cap, L"file:///%ls", p);
  out[cap - 1] = 0;
}

/* Read HKCU\...\Themes\Personalize\AppsUseLightTheme: 1 = light, 0 = dark. */
static void systemTheme(wchar_t *out, size_t cap) {
  DWORD v = 0, sz = sizeof(v), type = 0;
  LSTATUS s = RegGetValueW(HKEY_CURRENT_USER,
                           L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                           L"AppsUseLightTheme", RRF_RT_REG_DWORD, &type, &v, &sz);
  copyW(out, (s == ERROR_SUCCESS && v == 1) ? L"light" : L"dark", cap);
}

static void jsonEscape(wchar_t *dst, size_t cap, const wchar_t *src) {
  size_t o = 0;
  for (const wchar_t *p = src; p && *p && o + 8 < cap; p++) {
    if (*p == L'"' || *p == L'\\') { dst[o++] = L'\\'; dst[o++] = *p; }
    else if (*p == L'\n') { dst[o++] = L'\\'; dst[o++] = L'n'; }
    else if (*p == L'\r') { dst[o++] = L'\\'; dst[o++] = L'r'; }
    else if (*p == L'\t') { dst[o++] = L'\\'; dst[o++] = L't'; }
    else if (*p < 32) { dst[o++] = L' '; }
    else dst[o++] = *p;
  }
  dst[o] = 0;
}

/* Pull one string field out of a small flat JSON object. The host reads a
 * single value per message, so a scan beats carrying a parser here. */
static int jsonStr(const wchar_t *json, const wchar_t *key, wchar_t *out, size_t cap) {
  wchar_t pat[64];
  const wchar_t *p;
  size_t i = 0;
  if (!out || !cap) return 0;
  out[0] = 0;
  if (!json || !key || !key[0]) return 0;
  _snwprintf(pat, 64, L"\"%ls\":\"", key);
  p = wcsstr(json, pat);
  if (!p) return 0;
  p += wcslen(pat);
  while (*p && *p != L'\"' && i + 1 < cap) out[i++] = *p++;
  out[i] = 0;
  return 1;
}

/* A boolean field in a small flat JSON object (jsonStr only reads strings). */
static int jsonBool(const wchar_t *json, const wchar_t *key, int dflt) {
  wchar_t pat[64];
  const wchar_t *p;
  if (!json || !key || !key[0]) return dflt;
  _snwprintf(pat, 64, L"\"%ls\":", key);
  p = wcsstr(json, pat);
  if (!p) return dflt;
  p += wcslen(pat);
  while (*p == L' ') p++;
  if (!wcsncmp(p, L"true", 4)) return 1;
  if (!wcsncmp(p, L"false", 5)) return 0;
  return dflt;
}

static int dirExistsW(const wchar_t *p) {
  DWORD a = GetFileAttributesW(p);
  return a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY);
}

/* Which products the installers actually put on this machine. The page labels a
 * card "not installed" from this answer instead of letting the click fail, so
 * the list has to come from the disk, not from a constant. */
static void appsJson(wchar_t *out, size_t cap) {
  static const struct { const wchar_t *prefix, *dir; } P[] = {
    {L"inc", L"Infinity Cloud"},
    {L"ipm", L"InfinityPackageManager"},
    {L"int", L"InfinityToolbox"},
    {L"ifm", L"InfinityFileManager"},
  };
  wchar_t local[MAXP], root[MAXP];
  size_t o = 0;
  DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", local, MAXP);
  if (!n || n >= MAXP) local[0] = 0;
  joinW(root, MAXP, local, L"Programs\\Infinity.Inc");
  out[0] = 0;
  for (size_t i = 0; i < sizeof(P) / sizeof(P[0]); i++) {
    wchar_t d[MAXP], one[128];
    joinW(d, MAXP, root, P[i].dir);
    _snwprintf(one, 128, L"%ls\"%ls\":{\"installed\":%ls}",
               o ? L"," : L"", P[i].prefix,
               dirExistsW(d) ? L"true" : L"false");
    one[127] = 0;
    if (o + wcslen(one) + 1 < cap) { wcscat(out, one); o += wcslen(one); }
  }
}

/* A second window is a second host process pointed at the same UI server: the
 * page asks for it from its own tab-strip menu, so the child must not start a
 * second server (--spawn/--port are deliberately left out). */
static void newWindow(void) {
  wchar_t exe[MAXP], cmd[3 * MAXP];
  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  if (!g.url[0]) return;
  GetModuleFileNameW(NULL, exe, MAXP);
  if (g.userData[0]) {
    _snwprintf(cmd, 3 * MAXP, L"\"%ls\" \"--url=%ls\" --show --width=%d --height=%d \"--user-data=%ls\"",
               exe, g.url, g.width ? g.width : 1280, g.height ? g.height : 800, g.userData);
  } else {
    _snwprintf(cmd, 3 * MAXP, L"\"%ls\" \"--url=%ls\" --show --width=%d --height=%d",
               exe, g.url, g.width ? g.width : 1280, g.height ? g.height : 800);
  }
  cmd[3 * MAXP - 1] = 0;
  memset(&si, 0, sizeof(si));
  si.cb = sizeof(si);
  memset(&pi, 0, sizeof(pi));
  if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
    logLine(L"[host] shell.window new -> pid %lu", (unsigned long)pi.dwProcessId);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
  } else {
    logLine(L"[host] shell.window new failed err=%lu", (unsigned long)GetLastError());
  }
}

/* ---------- WebView2EnvironmentOptions (own Chromium switches) ---------- */

typedef struct { ICoreWebView2EnvironmentOptions iface; LONG ref; wchar_t args[1024]; } EnvOptions;

static HRESULT STDMETHODCALLTYPE Opt_QI(ICoreWebView2EnvironmentOptions *This, REFIID riid, void **ppv) {
  if (!ppv) return E_POINTER;
  if (IsEqualIID(riid, &IID_IUnknown) || IsEqualIID(riid, &IID_ICoreWebView2EnvironmentOptions)) {
    *ppv = This;
    ((EnvOptions *)This)->ref++;
    return S_OK;
  }
  *ppv = NULL;
  return E_NOINTERFACE;
}
static ULONG STDMETHODCALLTYPE Opt_AddRef(ICoreWebView2EnvironmentOptions *This) { return (ULONG)++((EnvOptions *)This)->ref; }
static ULONG STDMETHODCALLTYPE Opt_Release(ICoreWebView2EnvironmentOptions *This) { return (ULONG)--((EnvOptions *)This)->ref; }
static HRESULT STDMETHODCALLTYPE Opt_get_AdditionalBrowserArguments(ICoreWebView2EnvironmentOptions *This, LPWSTR *value) {
  if (!value) return E_POINTER;
  size_t n = wcslen(((EnvOptions *)This)->args) + 1;
  *value = (LPWSTR)CoTaskMemAlloc(n * sizeof(wchar_t));
  if (!*value) return E_OUTOFMEMORY;
  wcscpy(*value, ((EnvOptions *)This)->args);
  return S_OK;
}
static HRESULT STDMETHODCALLTYPE Opt_put_AdditionalBrowserArguments(ICoreWebView2EnvironmentOptions *This, LPCWSTR value) {
  copyW(((EnvOptions *)This)->args, value, 1024);
  return S_OK;
}
static HRESULT STDMETHODCALLTYPE Opt_get_Language(ICoreWebView2EnvironmentOptions *This, LPWSTR *value) {
  (void)This; if (!value) return E_POINTER;
  *value = (LPWSTR)CoTaskMemAlloc(6 * sizeof(wchar_t));
  if (!*value) return E_OUTOFMEMORY;
  wcscpy(*value, L"zh-CN");
  return S_OK;
}
static HRESULT STDMETHODCALLTYPE Opt_put_Language(ICoreWebView2EnvironmentOptions *This, LPCWSTR value) { (void)This; (void)value; return S_OK; }
static HRESULT STDMETHODCALLTYPE Opt_get_TargetCompatibleBrowserVersion(ICoreWebView2EnvironmentOptions *This, LPWSTR *value) {
  (void)This; if (!value) return E_POINTER;
  size_t n = wcslen(g.runtimeVersion) + 1;
  if (n < 2) n = 16;
  *value = (LPWSTR)CoTaskMemAlloc(n * sizeof(wchar_t));
  if (!*value) return E_OUTOFMEMORY;
  if (g.runtimeVersion[0]) wcscpy(*value, g.runtimeVersion); else wcscpy(*value, L"154.0.0.0");
  return S_OK;
}
static HRESULT STDMETHODCALLTYPE Opt_put_TargetCompatibleBrowserVersion(ICoreWebView2EnvironmentOptions *This, LPCWSTR value) { (void)This; (void)value; return S_OK; }
static HRESULT STDMETHODCALLTYPE Opt_get_AllowSingleSignOnUsingOSPrimaryAccount(ICoreWebView2EnvironmentOptions *This, BOOL *allow) {
  (void)This; if (!allow) return E_POINTER; *allow = FALSE; return S_OK;
}
static HRESULT STDMETHODCALLTYPE Opt_put_AllowSingleSignOnUsingOSPrimaryAccount(ICoreWebView2EnvironmentOptions *This, BOOL allow) { (void)This; (void)allow; return S_OK; }

static ICoreWebView2EnvironmentOptionsVtbl optVtbl = {
  Opt_QI, Opt_AddRef, Opt_Release,
  Opt_get_AdditionalBrowserArguments, Opt_put_AdditionalBrowserArguments,
  Opt_get_Language, Opt_put_Language,
  Opt_get_TargetCompatibleBrowserVersion, Opt_put_TargetCompatibleBrowserVersion,
  Opt_get_AllowSingleSignOnUsingOSPrimaryAccount, Opt_put_AllowSingleSignOnUsingOSPrimaryAccount
};
static EnvOptions g_opt;

/* ---------- handlers ---------- */

#define QI_IMPL(TYPE, NAME, VTBL, IMPL)                                                     \
  static HRESULT STDMETHODCALLTYPE IMPL##_QI(TYPE *This, REFIID riid, void **ppv) {          \
    if (!ppv) return E_POINTER;                                                              \
    if (IsEqualIID(riid, &IID_IUnknown) || IsEqualIID(riid, &IID_##NAME)) {                  \
      *ppv = This; ((IMPL##_H *)This)->ref++; return S_OK;                                   \
    }                                                                                        \
    *ppv = NULL; return E_NOINTERFACE;                                                       \
  }                                                                                          \
  static ULONG STDMETHODCALLTYPE IMPL##_AddRef(TYPE *This) { return (ULONG)++((IMPL##_H *)This)->ref; } \
  static ULONG STDMETHODCALLTYPE IMPL##_Release(TYPE *This) { return (ULONG)--((IMPL##_H *)This)->ref; }

/* environment completed */
typedef struct { ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler iface; LONG ref; } EnvCompleted_H;
QI_IMPL(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler, ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler, EnvVtbl, EnvCompleted)
static HRESULT STDMETHODCALLTYPE EnvCompleted_Invoke(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This, HRESULT errorCode, ICoreWebView2Environment *result);
static ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandlerVtbl envVtbl = { EnvCompleted_QI, EnvCompleted_AddRef, EnvCompleted_Release, EnvCompleted_Invoke };
static EnvCompleted_H g_envCompleted = { { &envVtbl }, 1 };

/* controller completed */
typedef struct { ICoreWebView2CreateCoreWebView2ControllerCompletedHandler iface; LONG ref; } CtrlCompleted_H;
QI_IMPL(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler, ICoreWebView2CreateCoreWebView2ControllerCompletedHandler, CtrlVtbl, CtrlCompleted)
static HRESULT STDMETHODCALLTYPE CtrlCompleted_Invoke(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This, HRESULT errorCode, ICoreWebView2Controller *result);
static ICoreWebView2CreateCoreWebView2ControllerCompletedHandlerVtbl ctrlVtbl = { CtrlCompleted_QI, CtrlCompleted_AddRef, CtrlCompleted_Release, CtrlCompleted_Invoke };
static CtrlCompleted_H g_ctrlCompleted = { { &ctrlVtbl }, 1 };

/* navigation completed */
typedef struct { ICoreWebView2NavigationCompletedEventHandler iface; LONG ref; } NavCompleted_H;
QI_IMPL(ICoreWebView2NavigationCompletedEventHandler, ICoreWebView2NavigationCompletedEventHandler, NavVtbl, NavCompleted)
static HRESULT STDMETHODCALLTYPE NavCompleted_Invoke(ICoreWebView2NavigationCompletedEventHandler *This, ICoreWebView2 *sender, ICoreWebView2NavigationCompletedEventArgs *args);
static ICoreWebView2NavigationCompletedEventHandlerVtbl navVtbl = { NavCompleted_QI, NavCompleted_AddRef, NavCompleted_Release, NavCompleted_Invoke };
static NavCompleted_H g_navCompleted = { { &navVtbl }, 1 };

/* execute script completed */
typedef struct { ICoreWebView2ExecuteScriptCompletedHandler iface; LONG ref; } ScriptCompleted_H;
QI_IMPL(ICoreWebView2ExecuteScriptCompletedHandler, ICoreWebView2ExecuteScriptCompletedHandler, ScriptVtbl, ScriptCompleted)
static HRESULT STDMETHODCALLTYPE ScriptCompleted_Invoke(ICoreWebView2ExecuteScriptCompletedHandler *This, HRESULT errorCode, LPCWSTR result);
static ICoreWebView2ExecuteScriptCompletedHandlerVtbl scriptVtbl = { ScriptCompleted_QI, ScriptCompleted_AddRef, ScriptCompleted_Release, ScriptCompleted_Invoke };
static ScriptCompleted_H g_scriptCompleted = { { &scriptVtbl }, 1 };

/* capture preview completed */
typedef struct { ICoreWebView2CapturePreviewCompletedHandler iface; LONG ref; } ShotCompleted_H;
QI_IMPL(ICoreWebView2CapturePreviewCompletedHandler, ICoreWebView2CapturePreviewCompletedHandler, ShotVtbl, ShotCompleted)
static HRESULT STDMETHODCALLTYPE ShotCompleted_Invoke(ICoreWebView2CapturePreviewCompletedHandler *This, HRESULT errorCode);
static ICoreWebView2CapturePreviewCompletedHandlerVtbl shotVtbl = { ShotCompleted_QI, ShotCompleted_AddRef, ShotCompleted_Release, ShotCompleted_Invoke };
static ShotCompleted_H g_shotCompleted = { { &shotVtbl }, 1 };

/* web message received */
typedef struct { ICoreWebView2WebMessageReceivedEventHandler iface; LONG ref; } MsgReceived_H;
QI_IMPL(ICoreWebView2WebMessageReceivedEventHandler, ICoreWebView2WebMessageReceivedEventHandler, MsgVtbl, MsgReceived)
static HRESULT STDMETHODCALLTYPE MsgReceived_Invoke(ICoreWebView2WebMessageReceivedEventHandler *This, ICoreWebView2 *sender, ICoreWebView2WebMessageReceivedEventArgs *args);
static ICoreWebView2WebMessageReceivedEventHandlerVtbl msgVtbl = { MsgReceived_QI, MsgReceived_AddRef, MsgReceived_Release, MsgReceived_Invoke };
static MsgReceived_H g_msgReceived = { { &msgVtbl }, 1 };

/* ---------- result writing ---------- */

static void writeResult(void) {
  if (!g.resultOut[0]) return;
  wchar_t esc[2048];
  jsonEscape(esc, 2048, g.error);
  /* probe already is JSON (ExecuteScript serialises objects) - embed raw */
  const wchar_t *probe = g.probeJson[0] ? g.probeJson : L"null";
  wchar_t bridge[4300];
  jsonEscape(bridge, 4300, g.bridge);
  wchar_t shotName[MAXP];
  copyW(shotName, g.screenshot[0] ? g.screenshot : L"", MAXP);
  wchar_t shotEsc[8300];
  jsonEscape(shotEsc, 8300, shotName);
  wchar_t uiEsc[8300];
  jsonEscape(uiEsc, 8300, g.uiDir);
  wchar_t urlEsc[8300];
  jsonEscape(urlEsc, 8300, g.url);
  wchar_t winEsc[2200];
  jsonEscape(winEsc, 2200, g.winLog);

  wchar_t body[19000];
  _snwprintf(body, 19000,
    L"{\n"
    L"  \"schema\": \"infinity.webview2.run/1\",\n"
    L"  \"ok\": %ls,\n"
    L"  \"ui\": \"%ls\",\n"
    L"  \"url\": \"%ls\",\n"
    L"  \"runtime_version\": \"%ls\",\n"
    L"  \"theme\": \"%ls\",\n"
    L"  \"window\": { \"width\": %d, \"height\": %d },\n"
    L"  \"times_ms\": { \"env_ready\": %.1f, \"controller_ready\": %.1f, \"nav_completed\": %.1f, \"probe_done\": %.1f, \"screenshot_done\": %.1f, \"total\": %.1f },\n"
    L"  \"probe\": %ls,\n"
    L"  \"bridge\": \"%ls\",\n"
    L"  \"bridge_count\": %d,\n"
    L"  \"window_actions\": \"%ls\",\n"
    L"  \"window_ack_count\": %d,\n"
    L"  \"screenshot\": \"%ls\",\n"
    L"  \"error\": \"%ls\"\n"
    L"}\n",
    g.ok ? L"true" : L"false", uiEsc, urlEsc, g.runtimeVersion, g.theme,
    g.width, g.height, g.tEnv, g.tController, g.tNav, g.tProbe, g.tShot, g.tTotal,
    probe, bridge, g.bridgeCount, winEsc, g.winAcks, shotEsc, esc);
  body[18999] = 0;

  FILE *f = _wfopen(g.resultOut, L"wb");
  if (f) {
    /* write UTF-8 */
    int n = WideCharToMultiByte(CP_UTF8, 0, body, -1, NULL, 0, NULL, NULL);
    if (n > 1) {
      char *utf8 = (char *)malloc((size_t)n);
      if (utf8) {
        WideCharToMultiByte(CP_UTF8, 0, body, -1, utf8, n, NULL, NULL);
        fwrite(utf8, 1, (size_t)n - 1, f);
        free(utf8);
      }
    }
    fclose(f);
  }
}

static void writeProbeFile(void) {
  if (!g.probeOut[0] || !g.probeJson[0]) return;
  FILE *f = _wfopen(g.probeOut, L"wb");
  if (!f) return;
  int n = WideCharToMultiByte(CP_UTF8, 0, g.probeJson, -1, NULL, 0, NULL, NULL);
  if (n > 1) {
    char *utf8 = (char *)malloc((size_t)n);
    if (utf8) {
      WideCharToMultiByte(CP_UTF8, 0, g.probeJson, -1, utf8, n, NULL, NULL);
      fwrite(utf8, 1, (size_t)n - 1, f);
      free(utf8);
    }
  }
  fclose(f);
}

static void saveStreamToFile(IStream *st, const wchar_t *path) {
  if (!st || !path[0]) return;
  LARGE_INTEGER zero; zero.QuadPart = 0;
  st->lpVtbl->Seek(st, zero, STREAM_SEEK_SET, NULL);
  STATSTG stat; memset(&stat, 0, sizeof(stat));
  if (FAILED(st->lpVtbl->Stat(st, &stat, STATFLAG_NONAME))) return;
  ULONG size = (ULONG)stat.cbSize.QuadPart;
  if (!size) return;
  char *buf = (char *)malloc(size);
  if (!buf) return;
  ULONG got = 0;
  st->lpVtbl->Read(st, buf, size, &got);
  FILE *f = _wfopen(path, L"wb");
  if (f) { fwrite(buf, 1, got, f); fclose(f); }
  free(buf);
}

/* ---------- probe + capture ---------- */

/* Injected before any page script: proves the runtime handed us the WebView2
 * bridge at document-created time and records what the shell sends back. */
static const wchar_t *INJECT_JS =
  L"(function(){try{window.__wv2HostProbe={at:Date.now(),hasChrome:typeof window.chrome,"
  L"hasWebview:!!(window.chrome&&window.chrome.webview),"
  L"hasPost:!!(window.chrome&&window.chrome.webview&&typeof window.chrome.webview.postMessage==='function'),toShell:[]};"
  L"window.chrome.webview.addEventListener('message',function(e){try{window.__wv2HostProbe.toShell.push("
  L"typeof e.data==='string'?e.data.slice(0,200):JSON.stringify(e.data).slice(0,200));}catch(x){}});"
  L"}catch(err){window.__wv2HostProbe={error:String(err)};}})()";

typedef struct { ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler iface; LONG ref; } Inject_H;
QI_IMPL(ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler, ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler, InjectVtbl, Inject)
static HRESULT STDMETHODCALLTYPE Inject_Invoke(ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler *This, HRESULT errorCode, LPCWSTR id) {
  (void)This; (void)id;
  if (FAILED(errorCode)) logLine(L"[host] AddScriptToExecuteOnDocumentCreated failed 0x%08lx", (unsigned long)errorCode);
  return S_OK;
}
static ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandlerVtbl injectVtbl = { Inject_QI, Inject_AddRef, Inject_Release, Inject_Invoke };
static Inject_H g_inject = { { &injectVtbl }, 1 };

/* --msg-test: replay the five shell.window actions the titlebar buttons send,
 * from inside the page itself, so the host round trip is proven end to end
 * without a human clicking a button. */
static const wchar_t *MSG_TEST_JS =
  L"(function(){var seq=[['minimize',150],['restore',700],['maximize',1250],['restore',1800],['new',2300]];"
  L"function post(a){try{window.chrome.webview.postMessage({channel:'infinity-shell',v:1,dir:'to-host',"
  L"type:'shell.window',payload:{action:a},ts:Date.now(),id:'msg-test'});}catch(e){}}"
  L"seq.forEach(function(s){setTimeout(function(){post(s[0]);},s[1]);});return 'scheduled '+seq.length;})()";

typedef struct { ICoreWebView2ExecuteScriptCompletedHandler iface; LONG ref; } Test_H;
QI_IMPL(ICoreWebView2ExecuteScriptCompletedHandler, ICoreWebView2ExecuteScriptCompletedHandler, TestVtbl, Test)
static HRESULT STDMETHODCALLTYPE Test_Invoke(ICoreWebView2ExecuteScriptCompletedHandler *This, HRESULT errorCode, LPCWSTR result) {
  (void)This;
  logLine(L"[host] msg-test scheduled err=0x%08lx %ls", (unsigned long)errorCode, result ? result : L"");
  return S_OK;
}
static ICoreWebView2ExecuteScriptCompletedHandlerVtbl testVtbl = { Test_QI, Test_AddRef, Test_Release, Test_Invoke };
static Test_H g_test = { { &testVtbl }, 1 };

static const wchar_t *PROBE_JS =
  L"(function(){try{var d=document.documentElement;var tabs=document.querySelectorAll('.tab');var sh=window.__InfinityShell||null;"
  L"var log=sh&&sh.log?sh.log():[];var tail=log.slice(-14).map(function(e){return e.dir+':'+e.type;});"
  L"return {readyState:document.readyState,title:document.title,"
  L"htmlDataHost:d.dataset.host||null,hostForceParam:d.dataset.hostforce||null,"
  L"theme:d.dataset.theme||null,tabCount:tabs.length,hasShell:!!sh,"
  L"shellScriptLoaded:!!document.querySelector('script[src*=\"shell.js\"]'),"
  L"webviewBridge:!!(window.chrome&&window.chrome.webview),"
  L"bridgeAtDocumentCreated:(window.__wv2HostProbe?window.__wv2HostProbe.hasPost:null),"
  L"shellFrames:tail,"
  L"hostInfoPayload:(function(){for(var i=log.length-1;i>=0;i--){if(log[i].dir==='to-shell'&&log[i].type==='host.info'){return log[i].payload;}}return null;})(),"
  L"localStorageOk:(function(){try{localStorage.setItem('__probe','1');var v=localStorage.getItem('__probe');localStorage.removeItem('__probe');return v==='1';}catch(e){return false;}})(),"
  L"ua:navigator.userAgent};}catch(e){return {error:String(e)};}})()";

static void finish(void) {
  if (g.finished) return;
  g.finished = 1;
  g.tTotal = nowMs();
  writeResult();
  logLine(L"[host] finished ok=%d nav=%.0fms shot=%.0fms total=%.0fms", g.ok, g.tNav, g.tShot, g.tTotal);
  if (g.hwnd) PostMessageW(g.hwnd, WM_CLOSE, 0, 0);
}

static void startCapture(void) {
  if (!g.webview) { finish(); return; }
  g.shotStream = NULL;
  if (SUCCEEDED(CreateStreamOnHGlobal(NULL, TRUE, &g.shotStream))) {
    g.webview->lpVtbl->CapturePreview(g.webview, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                                      g.shotStream, &g_shotCompleted.iface);
  } else {
    finish();
  }
}

static HRESULT STDMETHODCALLTYPE ScriptCompleted_Invoke(ICoreWebView2ExecuteScriptCompletedHandler *This, HRESULT errorCode, LPCWSTR result) {
  (void)This;
  if (SUCCEEDED(errorCode) && result) copyW(g.probeJson, result, 8192);
  else copyW(g.probeJson, L"null", 8192);
  g.tProbe = nowMs();
  g.probeDone = 1;
  writeProbeFile();
  logLine(L"[host] probe done err=0x%08lx %ls", (unsigned long)errorCode, g.probeJson);
  startCapture();
  return S_OK;
}

static HRESULT STDMETHODCALLTYPE ShotCompleted_Invoke(ICoreWebView2CapturePreviewCompletedHandler *This, HRESULT errorCode) {
  (void)This;
  if (SUCCEEDED(errorCode)) {
    saveStreamToFile(g.shotStream, g.screenshot);
    g.shotDone = 1;
    if (g.navDone && g.probeDone) g.ok = 1;
  } else {
    logLine(L"[host] capture preview failed 0x%08lx", (unsigned long)errorCode);
  }
  g.tShot = nowMs();
  if (g.shotStream) { g.shotStream->lpVtbl->Release(g.shotStream); g.shotStream = NULL; }
  /* The window protocol test runs after the frame is captured, so the shot
   * still shows a normal window and the four actions get time to arrive. */
  if (g.msgTest && !g.msgTestDone && g.webview) {
    g.msgTestDone = 1;
    g.webview->lpVtbl->ExecuteScript(g.webview, MSG_TEST_JS, &g_test.iface);
    SetTimer(g.hwnd, 3, 4200, NULL);
    return S_OK;
  }
  finish();
  return S_OK;
}

static HRESULT STDMETHODCALLTYPE MsgReceived_Invoke(ICoreWebView2WebMessageReceivedEventHandler *This, ICoreWebView2 *sender, ICoreWebView2WebMessageReceivedEventArgs *args) {
  (void)This; (void)sender;
  if (!args) return S_OK;
  LPWSTR json = NULL;
  /* the shell posts objects, so get_WebMessageAsJson is the reliable reader */
  if (SUCCEEDED(args->lpVtbl->get_WebMessageAsJson(args, &json)) && json) {
    if (g.bridgeCount < 6) {
      wchar_t one[600];
      copyW(one, json, 600);
      if (wcslen(g.bridge) + wcslen(one) + 4 < 4096) {
        if (g.bridge[0]) wcscat(g.bridge, L" | ");
        wcscat(g.bridge, one);
      }
    }
    g.bridgeCount++;
    logLine(L"[host] web message #%d: %ls", g.bridgeCount, json);
    if (g.webview && wcsstr(json, L"\"shell.ready\"")) {
      wchar_t reply[1200];
      _snwprintf(reply, 1200,
        L"{\"channel\":\"infinity-shell\",\"v\":1,\"dir\":\"to-shell\",\"type\":\"host.info\","
        L"\"payload\":{\"host\":\"webview2\",\"engine\":\"WebView2 Evergreen\",\"runtime\":\"%ls\","
        L"\"protocol\":\"infinity-shell/1\",\"shell\":\"InfinityEdgeShell\"},\"ts\":%lu,\"id\":\"host-info\"}",
        g.runtimeVersion, (unsigned long)GetTickCount64());
      HRESULT hrReply = g.webview->lpVtbl->PostWebMessageAsJson(g.webview, reply);
      logLine(L"[host] host.info reply hr=0x%08lx", (unsigned long)hrReply);
    } else if (g.webview && wcsstr(json, L"\"shell.window\"")) {
      /* The page's own titlebar is the only chrome the user sees, so its
       * buttons have to drive the real window through this message. */
      wchar_t action[32];
      if (jsonStr(json, L"action", action, 32) && action[0]) {
        HWND hwnd = g.hwnd;
        if (!wcscmp(action, L"minimize")) {
          ShowWindow(hwnd, SW_MINIMIZE);
        } else if (!wcscmp(action, L"maximize")) {
          ShowWindow(hwnd, IsZoomed(hwnd) ? SW_RESTORE : SW_MAXIMIZE);
        } else if (!wcscmp(action, L"restore")) {
          ShowWindow(hwnd, SW_RESTORE);
        } else if (!wcscmp(action, L"close")) {
          PostMessageW(hwnd, WM_CLOSE, 0, 0);
        } else if (!wcscmp(action, L"new")) {
          newWindow();
        }
        g.winAcks++;
        {
          wchar_t one[64];
          _snwprintf(one, 64, L"%ls%ls", g.winLog[0] ? L" " : L"", action);
          wcsncat(g.winLog, one, 1024 - wcslen(g.winLog) - 1);
        }
        logLine(L"[host] shell.window action=%ls iconic=%d zoomed=%d", action, IsIconic(hwnd), IsZoomed(hwnd));
        {
          /* Say what the window actually became, so a toggle button can draw
           * the right glyph instead of guessing its own state. */
          wchar_t reply[320];
          _snwprintf(reply, 320,
            L"{\"channel\":\"infinity-shell\",\"v\":1,\"dir\":\"to-shell\",\"type\":\"host.window\","
            L"\"payload\":{\"action\":\"%ls\",\"minimized\":%ls,\"maximized\":%ls},\"ts\":%lu,\"id\":\"host-window\"}",
            action, IsIconic(hwnd) ? L"true" : L"false", IsZoomed(hwnd) ? L"true" : L"false",
            (unsigned long)GetTickCount64());
          g.webview->lpVtbl->PostWebMessageAsJson(g.webview, reply);
        }
      }
    } else if (g.webview && wcsstr(json, L"\"viewer.apps\"")) {
      /* The page asks once per start; answer from the disk so a card can say
       * "not installed" instead of letting the click fail. */
      wchar_t apps[1024], reply[2048];
      appsJson(apps, 1024);
      _snwprintf(reply, 2048,
        L"{\"channel\":\"infinity-shell\",\"v\":1,\"dir\":\"to-shell\",\"type\":\"host.apps\","
        L"\"payload\":{\"apps\":{%ls}},\"ts\":%lu,\"id\":\"host-apps\"}",
        apps, (unsigned long)GetTickCount64());
      reply[2047] = 0;
      g.webview->lpVtbl->PostWebMessageAsJson(g.webview, reply);
      logLine(L"[host] host.apps reply apps=%ls", apps);
    } else if (g.webview && wcsstr(json, L"\"shell.devtools\"")) {
      /* WebView2 has no scriptable "close inspector", so open for real and say
       * plainly that closing is not supported here instead of faking a toggle. */
      int open = jsonBool(json, L"open", 1);
      wchar_t reply[400];
      if (open) g.webview->lpVtbl->OpenDevToolsWindow(g.webview);
      _snwprintf(reply, 400,
        L"{\"channel\":\"infinity-shell\",\"v\":1,\"dir\":\"to-shell\",\"type\":\"host.devtools\","
        L"\"payload\":{\"open\":%ls,\"target\":\"webview\",\"error\":\"%ls\"},\"ts\":%lu,\"id\":\"host-devtools\"}",
        open ? L"true" : L"false",
        open ? L"" : L"close is not scriptable in the WebView2 host",
        (unsigned long)GetTickCount64());
      reply[399] = 0;
      g.webview->lpVtbl->PostWebMessageAsJson(g.webview, reply);
      logLine(L"[host] shell.devtools open=%d", open);
    } else if (g.webview) {
      /* Anything this host cannot do (product launch, downloads, session save)
       * is answered instead of dropped: a silent drop makes the page look
       * broken, while host.unsupported lets it say so out loud. */
      wchar_t type[64], reply[400];
      jsonStr(json, L"type", type, 64);
      _snwprintf(reply, 400,
        L"{\"channel\":\"infinity-shell\",\"v\":1,\"dir\":\"to-shell\",\"type\":\"host.unsupported\","
        L"\"payload\":{\"type\":\"%ls\",\"host\":\"webview2\"},\"ts\":%lu,\"id\":\"host-unsupported\"}",
        type, (unsigned long)GetTickCount64());
      reply[399] = 0;
      g.webview->lpVtbl->PostWebMessageAsJson(g.webview, reply);
      logLine(L"[host] unsupported type=%ls", type);
    }
    CoTaskMemFree(json);
  }
  return S_OK;
}

static HRESULT STDMETHODCALLTYPE NavCompleted_Invoke(ICoreWebView2NavigationCompletedEventHandler *This, ICoreWebView2 *sender, ICoreWebView2NavigationCompletedEventArgs *args) {
  (void)This; (void)sender;
  BOOL success = FALSE;
  if (args) args->lpVtbl->get_IsSuccess(args, &success);
  g.tNav = nowMs();
  g.navDone = 1;
  logLine(L"[host] NavigationCompleted success=%d at %.0fms", (int)success, g.tNav);
  if (!success) {
    copyW(g.error, L"navigation failed", 1024);
    finish();
    return S_OK;
  }
  /* let the shell settle (animations, first paint), then probe + capture */
  SetTimer(g.hwnd, 1, (UINT)g.holdMs, NULL);
  return S_OK;
}

static HRESULT STDMETHODCALLTYPE EnvCompleted_Invoke(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This, HRESULT errorCode, ICoreWebView2Environment *result) {
  (void)This;
  g.tEnv = nowMs();
  if (FAILED(errorCode) || !result) {
    _snwprintf(g.error, 1024, L"CreateCoreWebView2EnvironmentWithOptions failed 0x%08lx", (unsigned long)errorCode);
    logLine(L"[host] %ls", g.error);
    finish();
    return S_OK;
  }
  g.env = result;
  result->lpVtbl->AddRef(result);
  LPWSTR ver = NULL;
  if (SUCCEEDED(result->lpVtbl->get_BrowserVersionString(result, &ver)) && ver) {
    copyW(g.runtimeVersion, ver, 128);
    CoTaskMemFree(ver);
  }
  logLine(L"[host] environment ready at %.0fms runtime=%ls", g.tEnv, g.runtimeVersion);
  result->lpVtbl->CreateCoreWebView2Controller(result, g.hwnd, &g_ctrlCompleted.iface);
  return S_OK;
}

static void applySettings(ICoreWebView2 *wv) {
  ICoreWebView2Settings *st = NULL;
  if (FAILED(wv->lpVtbl->get_Settings(wv, &st)) || !st) return;
  st->lpVtbl->put_AreDefaultContextMenusEnabled(st, FALSE);   /* shell draws its own menu */
  st->lpVtbl->put_IsStatusBarEnabled(st, FALSE);              /* no hover URL status bar */
  st->lpVtbl->put_IsBuiltInErrorPageEnabled(st, FALSE);       /* shell shows its own offline page */
  st->lpVtbl->put_AreDefaultScriptDialogsEnabled(st, FALSE);
  st->lpVtbl->put_IsZoomControlEnabled(st, FALSE);
  st->lpVtbl->put_AreDevToolsEnabled(st, TRUE);
  st->lpVtbl->put_IsWebMessageEnabled(st, TRUE);
  st->lpVtbl->put_IsScriptEnabled(st, TRUE);

  ICoreWebView2Settings3 *st3 = NULL;
  if (SUCCEEDED(st->lpVtbl->QueryInterface(st, &IID_ICoreWebView2Settings3, (void **)&st3)) && st3) {
    st3->lpVtbl->put_AreBrowserAcceleratorKeysEnabled(st3, FALSE); /* no Ctrl+P/F/... chrome keys */
    st3->lpVtbl->Release(st3);
  }
  st->lpVtbl->Release(st);
}

static HRESULT STDMETHODCALLTYPE CtrlCompleted_Invoke(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This, HRESULT errorCode, ICoreWebView2Controller *result) {
  (void)This;
  g.tController = nowMs();
  if (FAILED(errorCode) || !result) {
    _snwprintf(g.error, 1024, L"CreateCoreWebView2Controller failed 0x%08lx", (unsigned long)errorCode);
    logLine(L"[host] %ls", g.error);
    finish();
    return S_OK;
  }
  g.controller = result;
  result->lpVtbl->AddRef(result);
  RECT rc = { 0, 0, g.width, g.height };
  result->lpVtbl->put_Bounds(result, rc);
  result->lpVtbl->put_IsVisible(result, TRUE);
  if (FAILED(result->lpVtbl->get_CoreWebView2(result, &g.webview)) || !g.webview) {
    copyW(g.error, L"get_CoreWebView2 failed", 1024);
    finish();
    return S_OK;
  }
  applySettings(g.webview);
  EventRegistrationToken tok;
  g.webview->lpVtbl->add_NavigationCompleted(g.webview, &g_navCompleted.iface, &tok);
  g.webview->lpVtbl->add_WebMessageReceived(g.webview, &g_msgReceived.iface, &tok);
  g.webview->lpVtbl->AddScriptToExecuteOnDocumentCreated(g.webview, INJECT_JS, &g_inject.iface);
  logLine(L"[host] controller ready at %.0fms, navigating %ls", g.tController, g.url);
  g.webview->lpVtbl->Navigate(g.webview, g.url);
  return S_OK;
}

/* ---------- window ---------- */

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_SIZE:
      if (g.controller) {
        RECT rc; GetClientRect(hwnd, &rc);
        g.controller->lpVtbl->put_Bounds(g.controller, rc);
      }
      return 0;
    case WM_TIMER:
      if (wp == 1) {
        KillTimer(hwnd, 1);
        if (!g.probeDone && g.webview) g.webview->lpVtbl->ExecuteScript(g.webview, PROBE_JS, &g_scriptCompleted.iface);
        else finish();
      } else if (wp == 3) {
        KillTimer(hwnd, 3);
        finish();
      } else if (wp == 2) {
        KillTimer(hwnd, 2);
        if (!g.finished) {
          copyW(g.error, L"timeout waiting for first frame", 1024);
          logLine(L"[host] timeout after %d ms", g.timeoutMs);
          g.tTotal = nowMs();
          g.finished = 1;
          writeResult();
          PostMessageW(hwnd, WM_CLOSE, 0, 0);
        }
      }
      return 0;
    case WM_CLOSE:
      DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

static HWND createWindow(int w, int h, const wchar_t *title) {
  WNDCLASSEXW wc;
  memset(&wc, 0, sizeof(wc));
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = WndProc;
  wc.hInstance = GetModuleHandleW(NULL);
  wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
  wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
  wc.lpszClassName = L"InfinityWebView2Host";
  RegisterClassExW(&wc);
  RECT rc = { 0, 0, w, h };
  AdjustWindowRect(&rc, WS_OVERLAPPEDWINDOW, FALSE);
  int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
  int ww = rc.right - rc.left, wh = rc.bottom - rc.top;
  return CreateWindowExW(0, wc.lpszClassName, title && title[0] ? title : L"Infinity WebView2 Host", WS_OVERLAPPEDWINDOW,
                         (sw - ww) / 2, (sh - wh) / 2, ww, wh, NULL, NULL, wc.hInstance, NULL);
}

/* ---------- runtime presence ---------- */

static void runtimeRegistry(wchar_t *version, size_t vcap, wchar_t *location, size_t lcap) {
  const wchar_t *key = L"SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
  DWORD sz = 0, type = 0;
  version[0] = 0; location[0] = 0;
  sz = (DWORD)(vcap * sizeof(wchar_t));
  if (RegGetValueW(HKEY_LOCAL_MACHINE, key, L"pv", RRF_RT_REG_SZ, &type, version, &sz) != ERROR_SUCCESS) version[0] = 0;
  sz = (DWORD)(lcap * sizeof(wchar_t));
  if (RegGetValueW(HKEY_LOCAL_MACHINE, key, L"location", RRF_RT_REG_SZ, &type, location, &sz) != ERROR_SUCCESS) location[0] = 0;
}

/* ---------- app UI server (shell mode) ---------- */

/* Is something already listening on 127.0.0.1:<port>? */
static int portOpen(int port) {
  SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (s == INVALID_SOCKET) return 0;
  struct sockaddr_in a;
  memset(&a, 0, sizeof(a));
  a.sin_family = AF_INET;
  a.sin_port = htons((unsigned short)port);
  a.sin_addr.s_addr = inet_addr("127.0.0.1");
  int up = connect(s, (struct sockaddr *)&a, sizeof(a)) == 0;
  closesocket(s);
  return up;
}

static int waitPort(int port, int timeoutMs) {
  double t0 = nowMs();
  for (;;) {
    if (portOpen(port)) return 1;
    if (nowMs() - t0 > (double)timeoutMs) return 0;
    Sleep(120);
  }
}

/* Start the app's UI server as a child of this process. The child joins a job
 * object with KILL_ON_JOB_CLOSE, so closing the window (or the host dying for
 * any reason) takes the server down with it - no orphan processes. */
static int spawnChild(const wchar_t *exe, const wchar_t *args) {
  wchar_t cmd[MAXP * 2];
  _snwprintf(cmd, MAXP * 2, L"\"%ls\" %ls", exe, (args && args[0]) ? args : L"--serve-ui");
  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  memset(&si, 0, sizeof(si));
  si.cb = sizeof(si);
  memset(&pi, 0, sizeof(pi));
  if (!CreateProcessW(NULL, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
    _snwprintf(g.error, 1024, L"cannot start the UI server (error %lu)", (unsigned long)GetLastError());
    logLine(L"[host] %ls", g.error);
    return 0;
  }
  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (job) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION li;
    memset(&li, 0, sizeof(li));
    li.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &li, sizeof(li));
    AssignProcessToJobObject(job, pi.hProcess);
    g.job = job;
  }
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  logLine(L"[host] ui server started: %ls", cmd);
  return 1;
}

/* ---------- main ---------- */

static void usage(void) {
  wprintf(L"webview2-host.exe --ui=<ui dir> [options]\n"
          L"  --query=<qs>          extra query string (default host=1&theme=<system>)\n"
          L"  --url=<url>           navigate an explicit URL instead of the local ui\n"
          L"  --width=N --height=N  window size (default 1280x800)\n"
          L"  --user-data=<dir>     WebView2 user data folder\n"
          L"  --runtime=<dir>       fixed-version runtime folder (browserExecutableFolder)\n"
          L"  --browser-args=<s>    extra Chromium switches\n"
          L"  --screenshot=<png>    capture a PNG after the first frame\n"
          L"  --probe=<json>        write the DOM probe result here\n"
          L"  --result=<json>       write the run report here\n"
          L"  --hold-ms=N           settle time after NavigationCompleted (default 900)\n"
          L"  --timeout-ms=N        abort if no first frame (default 30000)\n"
          L"  --show                show the window and keep it open (shell mode)\n"
          L"  --title=<s>           window title (shell mode)\n"
          L"  --spawn=<exe>         start the app's UI server before navigating\n"
          L"  --app=<name>          spawn <name>_gui.exe from the host's own folder\n"
          L"  --spawn-args=<s>      arguments for --spawn (default --serve-ui)\n"
          L"  --port=N              UI server port: waits for it and navigates to it\n"
          L"  --wait-ms=N           how long to wait for the port (default 20000)\n"
          L"  --msg-test            replay the shell.window actions after the frame (probe)\n");
}

int wmain(int argc, wchar_t **argv) {
  memset(&g, 0, sizeof(g));
  QueryPerformanceFrequency(&g.freq);
  QueryPerformanceCounter(&g.qpc0);
  g.width = 1280; g.height = 800; g.holdMs = 900; g.timeoutMs = 30000; g.waitMs = 20000;
  g_opt.iface.lpVtbl = &optVtbl;
  g_opt.ref = 1;

  wchar_t exeDir[MAXP];
  GetModuleFileNameW(NULL, exeDir, MAXP);
  { wchar_t *p = wcsrchr(exeDir, L'\\'); if (p) *p = 0; }

  wchar_t queryArg[512] = L""; wchar_t urlArg[MAXP] = L"";
  int wantHelp = 0;

  for (int i = 1; i < argc; i++) {
    wchar_t *a = argv[i];
    if (!wcsncmp(a, L"--ui=", 5)) copyW(g.uiDir, a + 5, MAXP);
    else if (!wcsncmp(a, L"--query=", 8)) copyW(queryArg, a + 8, 512);
    else if (!wcsncmp(a, L"--url=", 6)) copyW(urlArg, a + 6, MAXP);
    else if (!wcsncmp(a, L"--width=", 8)) g.width = _wtoi(a + 8);
    else if (!wcsncmp(a, L"--height=", 9)) g.height = _wtoi(a + 9);
    else if (!wcsncmp(a, L"--user-data=", 12)) copyW(g.userData, a + 12, MAXP);
    else if (!wcsncmp(a, L"--runtime=", 10)) copyW(g.fixedRuntime, a + 10, MAXP);
    else if (!wcsncmp(a, L"--browser-args=", 15)) copyW(g.browserArgs, a + 15, 1024);
    else if (!wcsncmp(a, L"--screenshot=", 13)) copyW(g.screenshot, a + 13, MAXP);
    else if (!wcsncmp(a, L"--probe=", 8)) copyW(g.probeOut, a + 8, MAXP);
    else if (!wcsncmp(a, L"--result=", 9)) copyW(g.resultOut, a + 9, MAXP);
    else if (!wcsncmp(a, L"--hold-ms=", 10)) g.holdMs = _wtoi(a + 10);
    else if (!wcsncmp(a, L"--timeout-ms=", 13)) g.timeoutMs = _wtoi(a + 13);
    else if (!wcsncmp(a, L"--title=", 8)) {
      /* A shortcut's argument string cannot carry quotes reliably, so '+' is
       * the space separator on the command line. */
      copyW(g.title, a + 8, MAXP);
      for (wchar_t *t = g.title; *t; ++t) if (*t == L'+') *t = L' ';
    }
    else if (!wcsncmp(a, L"--spawn=", 8)) copyW(g.spawnExe, a + 8, MAXP);
    else if (!wcsncmp(a, L"--app=", 6)) copyW(g.appName, a + 6, 64);
    else if (!wcsncmp(a, L"--spawn-args=", 13)) copyW(g.spawnArgs, a + 13, 1024);
    else if (!wcsncmp(a, L"--port=", 7)) g.port = _wtoi(a + 7);
    else if (!wcsncmp(a, L"--wait-ms=", 10)) g.waitMs = _wtoi(a + 10);
    else if (!wcscmp(a, L"--show")) g.show = 1;
    else if (!wcscmp(a, L"--msg-test")) g.msgTest = 1;
    else if (!wcscmp(a, L"--help") || !wcscmp(a, L"-h")) wantHelp = 1;
  }
  if (wantHelp || (!g.uiDir[0] && !urlArg[0] && !g.port)) { usage(); return 2; }

  systemTheme(g.theme, 16);
  if (!queryArg[0]) _snwprintf(queryArg, 512, L"host=1&theme=%ls", g.theme);

  /* --app=<name> resolves the server from the host's own folder, so a shortcut
   * only has to say which product it belongs to. */
  if (!g.spawnExe[0] && g.appName[0]) {
    joinW(g.spawnExe, MAXP, exeDir, g.appName);
    wcsncat(g.spawnExe, L"_gui.exe", MAXP - wcslen(g.spawnExe) - 1);
  }

  /* Shell mode: bring up the app's own UI server and point the window at it. */
  if (g.spawnExe[0] || g.port) {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
      copyW(g.error, L"WSAStartup failed", 1024);
      logLine(L"[host] FATAL %ls", g.error);
      writeResult();
      return 9;
    }
  }
  if (g.spawnExe[0]) {
    if (!spawnChild(g.spawnExe, g.spawnArgs)) { writeResult(); return 10; }
  }
  if (g.port && !waitPort(g.port, g.waitMs)) {
    _snwprintf(g.error, 1024, L"UI server did not open port %d within %d ms", g.port, g.waitMs);
    logLine(L"[host] FATAL %ls", g.error);
    writeResult();
    return 11;
  }

  if (urlArg[0]) {
    copyW(g.url, urlArg, MAXP);
  } else if (g.port) {
    _snwprintf(g.url, MAXP, L"http://127.0.0.1:%d/", g.port);
  } else {
    wchar_t index[MAXP], base[MAXP];
    joinW(index, MAXP, g.uiDir, L"index.html");
    if (!fileExistsW(index)) {
      wprintf(L"[host] FATAL ui not found: %ls\n", index);
      return 4;
    }
    pathToFileUrl(base, MAXP, index);
    _snwprintf(g.url, MAXP, L"%ls?%ls", base, queryArg);
  }

  if (!g.userData[0]) {
    wchar_t local[MAXP];
    const wchar_t *lad = _wgetenv(L"LOCALAPPDATA");
    if (lad) _snwprintf(local, MAXP, L"%ls\\InfinityWebView2Host", lad);
    else joinW(local, MAXP, exeDir, L".wv2-profile");
    copyW(g.userData, local, MAXP);
  }
  CreateDirectoryW(g.userData, NULL);

  /* Default Chromium switches: the host runs from an elevated shell, and the
   * UI is local-only, so skip the auto de-elevation relaunch and the Edge
   * first-run/PDF "out of process UI" experiments the shell replaces. */
  if (!g.browserArgs[0])
    copyW(g.browserArgs,
      L"--do-not-de-elevate --disable-background-timer-throttling --disable-backgrounding-occluded-windows "
      L"--disable-renderer-backgrounding "
      L"--disable-features=msWebOOUI,msPdfOOUIBrowser,msSmartScreenProtection,CalculateNativeWinOcclusion",
      1024);
  copyW(g_opt.args, g.browserArgs, 1024);

  wchar_t regVer[128], regLoc[MAXP];
  runtimeRegistry(regVer, 128, regLoc, MAXP);
  logLine(L"[host] start: ui=%ls", g.uiDir[0] ? g.uiDir : L"(url)");
  logLine(L"[host] Evergreen runtime registry: pv=%ls location=%ls", regVer[0] ? regVer : L"(none)", regLoc[0] ? regLoc : L"(none)");
  logLine(L"[host] user-data=%ls", g.userData);
  logLine(L"[host] browser-args=%ls", g_opt.args);

  /* load the loader from our own directory first */
  wchar_t loader[MAXP];
  joinW(loader, MAXP, exeDir, L"WebView2Loader.dll");
  HMODULE hLoad = LoadLibraryExW(loader, NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
  if (!hLoad) hLoad = LoadLibraryExW(L"WebView2Loader.dll", NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
  if (!hLoad) {
    copyW(g.error, L"WebView2Loader.dll not found next to the host or on PATH", 1024);
    logLine(L"[host] FATAL %ls", g.error);
    /* no dialogs: the failure is reported in the result JSON + stderr only */
    fwprintf(stderr, L"WebView2Loader.dll is missing; reinstall the app package "
                     L"(webview2-host.exe + WebView2Loader.dll).\n");
    writeResult();
    return 5;
  }

  typedef HRESULT(STDMETHODCALLTYPE *PFN_CreateEnv)(PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions *, ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *);
  PFN_CreateEnv pCreateEnv = (PFN_CreateEnv)GetProcAddress(hLoad, "CreateCoreWebView2EnvironmentWithOptions");
  if (!pCreateEnv) {
    copyW(g.error, L"CreateCoreWebView2EnvironmentWithOptions export missing", 1024);
    writeResult();
    return 6;
  }

  HRESULT hrInit = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  (void)hrInit;

  g.hwnd = createWindow(g.width, g.height, g.title);
  if (!g.hwnd) { copyW(g.error, L"CreateWindow failed", 1024); writeResult(); return 7; }
  /* Headless policy: the host must never put a window on the desktop. The
   * controller still paints because the browser args below disable Chromium's
   * occlusion / backgrounding throttling. */
  g.interactive = g.show && !g.screenshot[0] && !g.probeOut[0];
  ShowWindow(g.hwnd, g.show ? SW_SHOW : SW_HIDE);
  UpdateWindow(g.hwnd);
  if (!g.interactive) SetTimer(g.hwnd, 2, (UINT)g.timeoutMs, NULL);

  HRESULT hr = pCreateEnv(g.fixedRuntime[0] ? g.fixedRuntime : NULL,
                          g.userData, &g_opt.iface, &g_envCompleted.iface);
  if (FAILED(hr)) {
    _snwprintf(g.error, 1024,
      L"WebView2 runtime unavailable (0x%08lx). Install the Evergreen Runtime "
      L"(https://go.microsoft.com/fwlink/p/?LinkId=2124703) or pass --runtime=<fixed version folder>.",
      (unsigned long)hr);
    logLine(L"[host] FATAL %ls", g.error);
    /* no dialogs (headless policy): stderr + result JSON carry the message */
    fwprintf(stderr,
      L"Microsoft Edge WebView2 Runtime is not installed.\n"
      L"Install the Evergreen Runtime (https://go.microsoft.com/fwlink/p/?LinkId=2124703),\n"
      L"or ship a fixed-version runtime and start with\n"
      L"  webview2-host.exe --runtime=\"<folder>\\Microsoft.WebView2.FixedVersionRuntime.154.0.4258.53.x64\"\n");
    writeResult();
    return 20;
  }

  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  if (g.interactive && g.navDone) g.ok = 1;
  if (g.job) {
    /* Closing the job takes the UI server down with the window. */
    CloseHandle(g.job);
    g.job = NULL;
  }
  if (g.controller) g.controller->lpVtbl->Close(g.controller);
  if (g.controller) g.controller->lpVtbl->Release(g.controller);
  if (g.webview) g.webview->lpVtbl->Release(g.webview);
  if (g.env) g.env->lpVtbl->Release(g.env);
  CoUninitialize();
  logLine(L"[host] exit %d", g.ok ? 0 : 1);
  return g.ok ? 0 : 1;
}
