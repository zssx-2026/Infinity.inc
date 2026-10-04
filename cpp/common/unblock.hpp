// unblock.hpp - a downloaded file unblocks itself.
//
// Windows marks a file that came from the browser with an alternate data
// stream named Zone.Identifier. The mark survives the download, the copy and
// the extraction; what it does not survive is the user's patience, because
// until it is gone Windows refuses to run the file without a right-click and a
// trip through Properties. The suite's own pages no longer hand out a script
// to do that, so the program does it itself, before anything else runs.
//
// Only that one stream is deleted. The file is never opened for writing, its
// contents are never touched, and the path always comes from the running
// module itself - never from an argument, so this cannot be pointed at a file
// the user did not start.
#pragma once

#include <string>

namespace inc {

/* Remove <path>:Zone.Identifier. Returns true when a stream was deleted,
 * false when there was none or it could not be removed. It never throws and
 * never reports a failure to the user: not being blocked is the normal case. */
bool unblockFile(const std::wstring& path);

/* The running executable. */
bool unblockSelf();

/* Everything under the running executable's own directory that this suite
 * ships as a file - .exe, .dll, .pak, .dat, .json, .txt - down to maxDepth
 * directories below it (default 2). This is the portable case: the zip is
 * extracted, and the first program started clears the mark from the whole
 * folder. Returns the number of streams deleted. */
int unblockSelfDirectory(int maxDepth = 2);

}  // namespace inc
