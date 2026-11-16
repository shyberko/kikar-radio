function decode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\\u0026/g, "&");
}

function walk(node, acc) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, acc);
    return;
  }
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("VideoObject") || types.includes("AudioObject")) {
    const url = typeof node.contentUrl === "string" ? node.contentUrl : "";
    if (url.includes("/play_480p.mp4")) acc.mediaUrl = url;
    if (node.duration && !acc.durationIso) acc.durationIso = String(node.duration);
    const thumb = node.thumbnailUrl;
    if (thumb && !acc.poster) acc.poster = Array.isArray(thumb) ? thumb[0] : thumb;
  }
  if (typeof node.articleSection === "string" && !acc.section) acc.section = node.articleSection;
  if (typeof node.headline === "string" && !acc.headline) acc.headline = node.headline;
  for (const v of Object.values(node)) walk(v, acc);
}

export function extractMedia(html) {
  const acc = { mediaUrl: null, durationIso: null, poster: null, section: null, headline: null };
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      walk(JSON.parse(m[1].trim()), acc);
    } catch {
      /* next block */
    }
  }
  if (!acc.mediaUrl) {
    const found = html.match(/https:\/\/stream\.kikar\.co\.il\/[0-9a-fA-F-]{36}\/play_480p\.mp4/);
    if (found) acc.mediaUrl = found[0];
  }
  if (acc.mediaUrl) acc.mediaUrl = decode(acc.mediaUrl);
  if (typeof acc.poster === "string") acc.poster = decode(acc.poster);
  return acc;
}
