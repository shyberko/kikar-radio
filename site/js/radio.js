import { isProtectedName, MANAGED_MARKER, MANAGED_PREFIX } from "./pure.js";
import { planAzuraError } from "./policy.js";

export function createRadio(getKey, getOrigin) {
  function origin() {
    return (getOrigin() || "https://radiocast.kikar.co.il").replace(/\/$/, "");
  }
  function apiBase() {
    return `${origin()}/api`;
  }

  async function request(method, path, json) {
    const key = getKey();
    if (!key) {
      const err = new Error("חסר מפתח");
      err.code = "auth";
      throw err;
    }
    let res;
    try {
      res = await fetch(`${apiBase()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: json !== undefined ? JSON.stringify(json) : undefined,
      });
    } catch (err) {
      err.code = "network";
      throw err;
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text.slice(0, 200) };
      }
    }
    if (!res.ok) {
      const plan = planAzuraError(res.status, data || text);
      const err = new Error(plan.message);
      err.status = res.status;
      err.code = plan.code;
      err.recovery = plan.recovery;
      throw err;
    }
    return data;
  }

  function canTouch(pl, knownIds) {
    if (!pl || isProtectedName(pl.name)) return false;
    if (!String(pl.name || "").startsWith(MANAGED_PREFIX)) return false;
    const marked = String(pl.description || "").includes(MANAGED_MARKER);
    return marked || (knownIds instanceof Set && knownIds.has(Number(pl.id)));
  }

  async function uploadBase64(destPath, base64, onProgress) {
    const key = getKey();
    const body = JSON.stringify({ path: destPath, file: base64 });
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${apiBase()}/station/1/files`);
      xhr.setRequestHeader("Authorization", `Bearer ${key}`);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Accept", "application/json");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
      };
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText || "null");
        } catch {
          data = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else {
          const plan = planAzuraError(xhr.status, data || xhr.responseText);
          const err = new Error(plan.code === "unknown" ? "הקובץ לא עלה לשרת. הקמפיין לא משודר." : plan.message);
          err.code = plan.code;
          err.recovery = plan.recovery;
          reject(err);
        }
      };
      xhr.onerror = () => {
        const err = new Error("ההעלאה נעצרה");
        err.code = "network";
        reject(err);
      };
      xhr.send(body);
    });
  }

  async function setFilePlaylists(fileId, desiredIds, knownIds) {
    const media = await request("GET", `/station/1/file/${fileId}`);
    const existing = Array.isArray(media?.playlists) ? media.playlists : [];
    const election = new Set(existing.filter((pl) => isProtectedName(pl.name)).map((pl) => Number(pl.id)));
    const keep = existing
      .map((pl) => Number(pl.id))
      .filter((id) => !knownIds.has(id) || election.has(id));
    const desired = desiredIds.map(Number).filter((id) => knownIds.has(id) && !election.has(id));
    await request("PUT", `/station/1/file/${fileId}`, { playlists: [...new Set([...keep, ...desired])] });
  }

  return {
    origin,
    request,
    canTouch,
    station: () => request("GET", "/station/1"),
    playlists: () => request("GET", "/station/1/playlists"),
    updatePlaylist: (id, body) => request("PUT", `/station/1/playlist/${id}`, body),
    createPlaylist: (body) => request("POST", "/station/1/playlists", body),
    deletePlaylist: (id) => request("DELETE", `/station/1/playlist/${id}`),
    uploadBase64,
    setFilePlaylists,
    history: (start) => request("GET", `/station/1/history?start=${encodeURIComponent(start)}`),
    quota: () => request("GET", "/station/1/quota"),
    async nowPlaying() {
      const res = await fetch(`${apiBase()}/nowplaying/1`);
      if (!res.ok) throw new Error("nowplaying");
      return res.json();
    },
  };
}
