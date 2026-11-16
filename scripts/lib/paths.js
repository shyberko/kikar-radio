import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const DATA = path.join(ROOT, "data");
export const TMP = path.join(ROOT, "tmp");
