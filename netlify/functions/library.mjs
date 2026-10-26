// Serves the current video list to the Shot Finder page, read from Steve's Google Sheet.
import { loadLibrary } from "../../lib/library.mjs";

export default async () => {
  const lib = await loadLibrary();
  return new Response(JSON.stringify({ requestUrl: lib.requestUrl, videos: lib.videos }), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=120", "x-library-source": lib.source }
  });
};

export const config = { path: "/api/library" };
