function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
}

export function parseRss(xml) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const enc = block.match(/<enclosure\b[^>]*>/i);
    let enclosure = "";
    if (enc) {
      const u = enc[0].match(/\burl=["']([^"']+)["']/i);
      enclosure = u ? decode(u[1]) : "";
    }
    items.push({
      title: tag(block, "title"),
      link: tag(block, "link") || tag(block, "guid"),
      guid: tag(block, "guid") || tag(block, "link"),
      pubDate: tag(block, "pubDate"),
      description: tag(block, "description"),
      enclosure,
    });
  }
  return items;
}
