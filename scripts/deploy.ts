// Met l'optimiseur en ligne (GitHub Pages) : compile le site pour son sous-dossier puis pousse dist/ sur la
// branche gh-pages du dépôt.
//   npm run deploy        → https://<compte>.github.io/<dépôt>/ (une à deux minutes plus tard)

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");
const git = (args: string, cwd = root) => execSync(`git ${args}`, { cwd, encoding: "utf8" }).trim();

const remote = git("remote get-url origin");
const repo = remote.replace(/\.git$/, "").split("/").pop();
execSync("npm run build", { cwd: root, stdio: "inherit", env: { ...process.env, BASE_PATH: `/${repo}/` } });
// sans ce fichier, GitHub Pages passe le site dans Jekyll, inutile ici
writeFileSync(join(dist, ".nojekyll"), "");

// dist/ devient un dépôt jetable dont l'unique commit remplace la branche gh-pages
const who = `-c user.name="${git("config user.name")}" -c user.email="${git("config user.email")}"`;
git("init -q -b gh-pages", dist);
git("add -A", dist);
git(`${who} commit -q -m "Déploiement du ${new Date().toISOString().slice(0, 16).replace("T", " ")}"`, dist);
git(`push -f -q ${remote} gh-pages`, dist);
console.log(`\nEn ligne d'ici une à deux minutes : https://${remote.split("/")[3].toLowerCase()}.github.io/${repo}/`);
