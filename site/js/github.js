const REPO = "shyberko/kikar-radio";
const BRANCH = "main";

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64ToUtf8(b64) {
  const clean = String(b64 || "").replace(/\n/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function readError(res) {
  let message = `${res.status}`;
  try {
    const data = await res.json();
    message = data.message || message;
  } catch {
    /* keep status */
  }
  const err = new Error(message);
  err.status = res.status;
  return err;
}

export function createGithub(getToken) {
  function headers(json) {
    const token = getToken();
    const h = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) h.Authorization = `Bearer ${token}`;
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async function read(path) {
    const token = getToken();
    if (!token) {
      const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}?t=${Date.now()}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("לא הצלחנו לקרוא את הנתונים");
      return res.json();
    }
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${BRANCH}`, {
      headers: headers(false),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw await readError(res);
    const data = await res.json();
    return JSON.parse(b64ToUtf8(data.content));
  }

  async function put(path, json, message) {
    const token = getToken();
    if (!token) throw new Error("חסר טוקן GitHub");
    const url = `https://api.github.com/repos/${REPO}/contents/${path}`;
    let last = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await fetch(`${url}?ref=${BRANCH}`, { headers: headers(false) });
      let sha;
      if (cur.status === 404) sha = undefined;
      else if (!cur.ok) throw await readError(cur);
      else sha = (await cur.json()).sha;
      const res = await fetch(url, {
        method: "PUT",
        headers: headers(true),
        body: JSON.stringify({
          message,
          content: utf8ToB64(`${JSON.stringify(json, null, 2)}\n`),
          sha,
          branch: BRANCH,
        }),
      });
      if (res.status === 409) {
        last = await readError(res);
        continue;
      }
      if (res.status === 403 || res.status === 429) {
        const err = await readError(res);
        err.code = "github";
        throw err;
      }
      if (!res.ok) throw await readError(res);
      return;
    }
    throw last || new Error("השמירה נכשלה");
  }

  async function dispatch(workflow, inputs) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ ref: BRANCH, inputs: inputs || {} }),
    });
    if (res.status === 204) return;
    const err = await readError(res);
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      err.code = "dispatch";
    }
    throw err;
  }

  async function verify() {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, { headers: headers(false) });
    if (!res.ok) throw await readError(res);
    const data = await res.json();
    const contents = data.permissions?.contents;
    const actions = data.permissions?.actions;
    const workflows = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows`, { headers: headers(false) });
    return {
      name: data.full_name,
      contents,
      actions,
      workflowsOk: workflows.ok,
      ok: contents === "write" && actions !== "read" && workflows.ok && actions !== undefined ? actions === "write" || actions === "admin" : contents === "write" && workflows.ok,
    };
  }

  async function runs(workflow) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/runs?per_page=5`, {
      headers: headers(false),
    });
    if (!res.ok) throw await readError(res);
    const data = await res.json();
    return data.workflow_runs || [];
  }

  return { read, put, dispatch, verify, runs, repo: REPO };
}
