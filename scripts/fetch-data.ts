// Télécharge les données de la version la plus récente du jeu (Dofus 3, release "main").
// Sources : API dofusdude (équipements, panoplies) + fichiers bruts du jeu publiés par
// dofusdude/dofus3-main pour la même version (classes, sorts, effets, monstres).
//   npm run data:fetch            -> ne télécharge que si la version a changé
//   npm run data:fetch -- --force -> retélécharge tout
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";

const RAW = join(import.meta.dirname, "..", "data", "raw");
const API = "https://api.dofusdu.de/dofus3/v1";
const GH_REPO = "dofusdude/dofus3-main";

const API_FILES: Record<string, string> = {
  equipment: `${API}/fr/items/equipment/all`,
  sets: `${API}/fr/sets/all`,
};
const GAME_FILES = [
  "breeds",
  "spells",
  "spell_levels",
  "spell_variants",
  "spell_states",
  "effects",
  "characteristics",
  "item_types",
  "items",
  "monsters",
  "fr",
];

interface VersionInfo {
  version: string;
  update_stamp: string;
  fetched_at: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "user-agent": "stuff-dofus" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json() as Promise<T>;
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "user-agent": "stuff-dofus" } });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

async function main() {
  const force = process.argv.includes("--force");
  mkdirSync(join(RAW, "api"), { recursive: true });
  mkdirSync(join(RAW, "game"), { recursive: true });

  const meta = await getJson<{ version: string; update_stamp: string }>(`${API}/meta/version`);
  const release = await getJson<{ tag_name: string }>(
    `https://api.github.com/repos/${GH_REPO}/releases/latest`,
  );
  console.log(`API dofusdude : ${meta.version} (${meta.update_stamp})`);
  console.log(`Fichiers jeu  : ${release.tag_name}`);
  if (release.tag_name !== meta.version) {
    console.warn(
      `⚠ Versions différentes entre l'API (${meta.version}) et la release GitHub (${release.tag_name}).` +
        ` On prend les fichiers jeu de la release ${meta.version} si elle existe.`,
    );
  }

  const versionFile = join(RAW, "version.json");
  if (!force && existsSync(versionFile)) {
    const prev = JSON.parse(readFileSync(versionFile, "utf8")) as VersionInfo;
    if (prev.version === meta.version && prev.update_stamp === meta.update_stamp) {
      console.log("Données déjà à jour, rien à télécharger (--force pour forcer).");
      return;
    }
  }

  for (const [name, url] of Object.entries(API_FILES)) {
    console.log(`↓ api/${name}.json`);
    await download(url, join(RAW, "api", `${name}.json`));
  }

  let tag = meta.version;
  const probe = await fetch(`https://github.com/${GH_REPO}/releases/tag/${tag}`, { method: "HEAD" });
  if (!probe.ok) tag = release.tag_name;
  for (const name of GAME_FILES) {
    console.log(`↓ game/${name}.json (${tag})`);
    await download(
      `https://github.com/${GH_REPO}/releases/download/${tag}/${name}.json`,
      join(RAW, "game", `${name}.json`),
    );
  }

  const info: VersionInfo = {
    version: meta.version,
    update_stamp: meta.update_stamp,
    fetched_at: new Date().toISOString(),
  };
  writeFileSync(versionFile, JSON.stringify({ ...info, game_files_tag: tag }, null, 2));
  console.log(`✓ Données ${meta.version} téléchargées.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
