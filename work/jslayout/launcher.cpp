/*
 * launcher.cpp - the small executable that starts the real program.
 *
 * Infinity.Inc used to ship one 77 MiB single file executable per name:
 * every copy carried its own embedded Node runtime, so six names put six
 * runtimes on disk around one bundle of code that is barely a hundred
 * kilobytes. This file is what replaces that. It holds nothing but the
 * path arithmetic:
 *
 *   <dir>/ifm_gui.exe   this file            about 20 KiB
 *   <dir>/node.exe      the runtime, shared  about 77 MiB, once
 *   <dir>/app.cjs       the whole program    about 145 KiB
 *
 * It finds the directory it lives in, leaves its own name where the program
 * can read it, and runs the runtime against the bundle.
 *
 * Built twice per platform, and the difference between the two builds is the
 * whole point. CHILD_NO_WINDOW is defined for the windowed face so that the
 * runtime, which is a console program, does not flash a black console box on
 * double click; it is left undefined for the command line face so that the
 * ordinary console, and the output the user typed the command to see, is
 * kept. The two faces are otherwise the same file.
 *
 * There is deliberately no message box anywhere in this file. These
 * executables are started by installers, by scheduled tasks and by other
 * programs, and a dialog that waits for a click would stop every one of them
 * for a user who may not even be at the machine.
 */
#include <windows.h>
#include <stdio.h>
#include <wchar.h>

#define MAXW 32768

/* Failure goes to stderr and nowhere else. A windowed face has no stderr to
 * write to, so the message is simply lost and the exit code carries it. */
static void die(const wchar_t *msg) {
    if (stderr) fwprintf(stderr, L"Infinity.Inc: %ls\n", msg);
    ExitProcess(2);
}

/* The directory this executable lives in, with no trailing separator. */
static void selfDir(wchar_t *out) {
    wchar_t full[MAXW];
    DWORD n = GetModuleFileNameW(NULL, full, MAXW);
    if (n == 0 || n >= MAXW) die(L"cannot locate this executable");
    wchar_t *cut = wcsrchr(full, L'\\');
    if (!cut) die(L"cannot locate this executable");
    *cut = 0;
    wcscpy_s(out, MAXW, full);
}

static void joinPath(wchar_t *out, const wchar_t *dir, const wchar_t *name) {
    wcscpy_s(out, MAXW, dir);
    wcscat_s(out, MAXW, L"\\");
    wcscat_s(out, MAXW, name);
}

/* Everything after this executable's own name on the command line, quoted
 * or not, handed on untouched. Taken from the raw command line rather than
 * from argv so that the quoting survives exactly as the user typed it. */
static const wchar_t *commandTail(void) {
    const wchar_t *cl = GetCommandLineW();
    if (!cl) return L"";
    while (*cl == L' ') cl++;

    if (*cl == L'"') {
        cl++;
        while (*cl && *cl != L'"') cl++;
        if (*cl == L'"') cl++;
    } else {
        while (*cl && *cl != L' ' && *cl != L'\t') cl++;
    }
    while (*cl == L' ') cl++;
    return cl;
}

static int run(void) {
    wchar_t dir[MAXW], node[MAXW], app[MAXW], self[MAXW];

    selfDir(dir);
    joinPath(node, dir, L"node.exe");
    joinPath(app, dir, L"app.cjs");

    if (GetFileAttributesW(node) == INVALID_FILE_ATTRIBUTES)
        die(L"node.exe is missing next to this executable");
    if (GetFileAttributesW(app) == INVALID_FILE_ATTRIBUTES)
        die(L"app.cjs is missing next to this executable");

    /* The program reads its own name to choose a face, so the name has to
     * survive the handover: the shared runtime's own name is always
     * node.exe, and would tell the program nothing. */
    DWORD n = GetModuleFileNameW(NULL, self, MAXW);
    if (n == 0 || n >= MAXW) die(L"cannot locate this executable");
    wchar_t *cut = wcsrchr(self, L'\\');
    const wchar_t *base = cut ? cut + 1 : self;

    char nameA[MAXW];
    if (WideCharToMultiByte(CP_UTF8, 0, base, -1, nameA, MAXW, NULL, NULL) <= 0)
        die(L"cannot encode the executable name");
    if (!SetEnvironmentVariableA("INFINITY_EXE_NAME", nameA))
        die(L"cannot pass the executable name on");

    const wchar_t *tail = commandTail();
    wchar_t cmd[MAXW];
    if (_snwprintf_s(cmd, MAXW, _TRUNCATE, L"\"%s\" \"%s\"%s%s",
                     node, app, (*tail ? L" " : L""), (*tail ? tail : L"")) < 0)
        die(L"the command line is too long");

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    ZeroMemory(&pi, sizeof(pi));
    si.cb = sizeof(si);

    /* Hand our own standard handles to the child. Without this the runtime
     * starts with no console and no inherited pipes, and everything it writes
     * - including the loopback url the window face prints - is thrown away.
     * A windowed face is launched from a console often enough (an installer,
     * a script, a scheduled task) for that to matter, so the handles are
     * passed whenever they exist and left unset when they do not. */
    HANDLE inH  = GetStdHandle(STD_INPUT_HANDLE);
    HANDLE outH = GetStdHandle(STD_OUTPUT_HANDLE);
    HANDLE errH = GetStdHandle(STD_ERROR_HANDLE);
    if (inH != INVALID_HANDLE_VALUE && outH != INVALID_HANDLE_VALUE && errH != INVALID_HANDLE_VALUE) {
        si.dwFlags |= STARTF_USESTDHANDLES;
        si.hStdInput = inH;
        si.hStdOutput = outH;
        si.hStdError = errH;
    }
#ifdef CHILD_NO_WINDOW
    DWORD flags = CREATE_NO_WINDOW;
#else
    DWORD flags = 0;
#endif

    /* The caller's current directory is kept: a file manager given a
     * relative path has to resolve it against where the user was standing,
     * not against where the program happens to be installed. */
    if (!CreateProcessW(NULL, cmd, NULL, NULL, TRUE, flags, NULL, NULL, &si, &pi))
        die(L"cannot start node.exe");

    CloseHandle(pi.hThread);
    WaitForSingleObject(pi.hProcess, INFINITE);

    DWORD code = 1;
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hProcess);
    return (int)code;
}

/* Both entry points exist and do the same thing, so the program above has
 * only one copy: a windowed program is entered through WinMain and a
 * console one through wmain, and which one is used is decided by the link
 * step below, not here. */
extern "C" int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrev, LPSTR lpCmdLine, int nShowCmd) {
    (void)hInstance; (void)hPrev; (void)lpCmdLine; (void)nShowCmd;
    return run();
}

extern "C" int wmain(void) { return run(); }
