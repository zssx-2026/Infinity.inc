  // ------------------------------------------------------------- preview
  //
  // A preview reads the file in 256 KiB windows, so the first window can be on
  // screen while the rest is still in the cloud. Reading is stateless between
  // requests. The only state is a pair of numbers: the epoch handed to the
  // newest preview, and the epoch the user closed. A window is cancelled when
  // its own epoch is the closed one, so closing one preview can never cancel
  // the one opened right after it.
  static std::atomic<long long> previewEpoch(0);
  static std::atomic<long long> previewClosed(-1);
  static PreviewUrlCache previewUrls;

  server.route("GET", "/api/preview/meta", [&](const UiRequest& request) {
    if (!manifestLoaded) return uiFailure("the manifest is not available", 503);
    PreviewSource source;
    std::string why;
    if (!previewSource(store, queryValue(request, "path"), &source, &why)) return uiFailure(why, 404);
    const long long epoch = previewEpoch.fetch_add(1) + 1;
    return UiResponse::json(previewSourceJson(source, epoch));
  });

  server.route("GET", "/api/preview/chunk", [&](const UiRequest& request) {
    if (!manifestLoaded) return uiFailure("the manifest is not available", 503);
    PreviewSource source;
    std::string why;
    if (!previewSource(store, queryValue(request, "path"), &source, &why)) return uiFailure(why, 404);
    const long long epoch = atoll(queryValue(request, "epoch").c_str());
    std::function<bool()> closedByUser = [epoch]() {
      return epoch > 0 && previewClosed.load() == epoch;
    };
    if (closedByUser()) return uiFailure("cancelled", 499);
    const long long offset = atoll(queryValue(request, "offset").c_str());
    long long length = atoll(queryValue(request, "length").c_str());
    if (length <= 0) length = kPreviewChunkBytes;
    // One window per answer, whatever the caller asks for.
    if (length > kPreviewChunkBytes) length = kPreviewChunkBytes;
    if (offset < 0 || offset >= source.size) return uiFailure("the window is outside the file", 416);
    if (offset + length > source.size) length = source.size - offset;
    PreviewReadOptions options;
    options.cancelCheck = &closedByUser;
    const unsigned long long started = GetTickCount64();
    std::string bytes;
    if (!previewRead(store, session.gh, previewUrls, source, offset, length, &bytes, &why, options)) {
      return uiFailure(why, why == "cancelled" ? 499 : 504);
    }
    UiResponse response;
    response.status = 206;
    response.contentType = "application/octet-stream";
    response.body = bytes;
    const long long last = offset + (long long)bytes.size() - 1;
    response.headers.push_back({ "Content-Range",
      "bytes " + std::to_string(offset) + "-" + std::to_string(last) + "/" + std::to_string(source.size) });
    // The time to this window is the number the first-screen target is stated
    // in, so it goes on the wire and a test reads it instead of guessing it.
    response.headers.push_back({ "X-Preview-Ms", std::to_string((long long)(GetTickCount64() - started)) });
    response.headers.push_back({ "X-Preview-Chunk", std::to_string((long long)bytes.size()) });
    response.headers.push_back({ "X-Preview-Offset", std::to_string(offset) });
    response.headers.push_back({ "X-Preview-Total", std::to_string(source.size) });
    response.headers.push_back({ "X-Preview-Epoch", std::to_string(epoch) });
    return response;
  });

  server.route("GET", "/api/preview/zip", [&](const UiRequest& request) {
    if (!manifestLoaded) return uiFailure("the manifest is not available", 503);
    PreviewSource source;
    std::string why;
    if (!previewSource(store, queryValue(request, "path"), &source, &why)) return uiFailure(why, 404);
    if (source.kind != PreviewKind::Zip) return uiFailure("not an archive", 400);
    const long long epoch = atoll(queryValue(request, "epoch").c_str());
    std::function<bool()> closedByUser = [epoch]() {
      return epoch > 0 && previewClosed.load() == epoch;
    };
    if (closedByUser()) return uiFailure("cancelled", 499);
    long long tail = atoll(queryValue(request, "tail").c_str());
    if (tail <= 0) tail = kPreviewZipTailBytes;
    PreviewReadOptions options;
    options.cancelCheck = &closedByUser;
    std::vector<ZipEntry> entries;
    const unsigned long long started = GetTickCount64();
    if (!previewZipTail(store, session.gh, previewUrls, source, &entries, &why, options, tail)) {
      return uiFailure(why, why == "cancelled" ? 499 : 502);
    }
    Json j = Json::object();
    j.set("epoch", epoch);
    j.set("entries", (long long)entries.size());
    j.set("firstTailBytes", tail);
    j.set("ms", (long long)(GetTickCount64() - started));
    Json list = Json::array();
    for (const ZipEntry& entry : entries) {
      Json item = Json::object();
      item.set("name", Json(entry.name));
      item.set("compressed", Json((long long)entry.compressed));
      item.set("uncompressed", Json((long long)entry.uncompressed));
      item.set("method", Json((long long)entry.method));
      item.set("headerOffset", Json((long long)entry.headerOffset));
      list.push(item);
    }
    j.set("list", list);
    return UiResponse::json(j.dump(2));
  });

  // One entry of an archive, fetched on demand: the central directory gave the
  // offset of its local header, the header gives the data offset, and only the
  // compressed bytes of that one entry are read in 256 KiB windows. Nothing
  // else in the archive is touched.
  server.route("GET", "/api/preview/zip/entry", [&](const UiRequest& request) {
    if (!manifestLoaded) return uiFailure("the manifest is not available", 503);
    PreviewSource source;
    std::string why;
    if (!previewSource(store, queryValue(request, "path"), &source, &why)) return uiFailure(why, 404);
    if (source.kind != PreviewKind::Zip) return uiFailure("not an archive", 400);
    const std::string wanted = queryValue(request, "name");
    if (wanted.empty()) return uiFailure("no entry name given", 400);
    const long long epoch = atoll(queryValue(request, "epoch").c_str());
    std::function<bool()> closedByUser = [epoch]() {
      return epoch > 0 && previewClosed.load() == epoch;
    };
    if (closedByUser()) return uiFailure("cancelled", 499);
    PreviewReadOptions options;
    options.cancelCheck = &closedByUser;
    std::vector<ZipEntry> entries;
    if (!previewZipTail(store, session.gh, previewUrls, source, &entries, &why, options, kPreviewZipTailBytes)) {
      return uiFailure(why, why == "cancelled" ? 499 : 502);
    }
    const ZipEntry* entry = nullptr;
    for (const ZipEntry& candidate : entries) if (candidate.name == wanted) { entry = &candidate; break; }
    if (!entry) return uiFailure("no such entry in the archive", 404);
    if (entry->compressed > (uint64_t)kPreviewEntryMaxBytes) {
      return uiFailure("the entry is larger than the on-demand ceiling", 413);
    }
    std::string header;
    if (!previewRead(store, session.gh, previewUrls, source, (long long)entry->headerOffset, 30,
                     &header, &why, options)) {
      return uiFailure(why, why == "cancelled" ? 499 : 504);
    }
    ZipLocalHeader local;
    if (!zipLocalHeader(header, entry->headerOffset, &local, &why)) return uiFailure(why, 502);
    Json meta = Json::object();
    meta.set("name", Json(entry->name));
    meta.set("method", Json((long long)entry->method));
    meta.set("localMethod", Json((long long)local.method));
    meta.set("compressed", Json((long long)entry->compressed));
    meta.set("uncompressed", Json((long long)entry->uncompressed));
    meta.set("crc", Json((long long)(unsigned long long)entry->crc));
    meta.set("headerOffset", Json((long long)entry->headerOffset));
    meta.set("dataOffset", Json((long long)local.dataOffset));
    meta.set("epoch", epoch);
    if (queryValue(request, "meta") == "1" || entry->compressed == 0) {
      return UiResponse::json(meta.dump(2));
    }
    const unsigned long long started = GetTickCount64();
    std::string bytes;
    if (!previewRead(store, session.gh, previewUrls, source, (long long)local.dataOffset,
                     (long long)entry->compressed, &bytes, &why, options)) {
      return uiFailure(why, why == "cancelled" ? 499 : 504);
    }
    UiResponse response;
    response.status = 200;
    response.contentType = "application/octet-stream";
    response.body = bytes;
    response.headers.push_back({ "X-Zip-Method", std::to_string((long long)entry->method) });
    response.headers.push_back({ "X-Zip-Compressed", std::to_string((long long)bytes.size()) });
    response.headers.push_back({ "X-Zip-Uncompressed", std::to_string((long long)entry->uncompressed) });
    response.headers.push_back({ "X-Zip-Crc", std::to_string((long long)(unsigned long long)entry->crc) });
    response.headers.push_back({ "X-Zip-DataOffset", std::to_string((long long)local.dataOffset) });
    response.headers.push_back({ "X-Preview-Ms", std::to_string((long long)(GetTickCount64() - started)) });
    return response;
  });

  server.route("POST", "/api/preview/cancel", [&](const UiRequest& request) {
    long long epoch = atoll(queryValue(request, "epoch").c_str());
    if (epoch <= 0) epoch = previewEpoch.load();
    previewClosed.store(epoch);
    Json j = Json::object();
    j.set("cancelled", Json(true));
    j.set("epoch", epoch);
    return UiResponse::json(j.dump());
  });
