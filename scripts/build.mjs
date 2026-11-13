import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildStaticSite({ outputDirectory = resolve(projectDirectory, "dist") } = {}) {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  await build({
    bundle: true,
    entryPoints: [resolve(projectDirectory, "app.js")],
    minify: true,
    define: {
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""),
    },
    outfile: resolve(outputDirectory, "app.js"),
  });

  await Promise.all([
    copyFile(resolve(projectDirectory, "style.css"), resolve(outputDirectory, "style.css")),
    copyFile(resolve(projectDirectory, "index.html"), resolve(outputDirectory, "index.html")),
  ]);

  const indexPath = resolve(outputDirectory, "index.html");
  const index = await (await import("node:fs/promises")).readFile(indexPath, "utf8");
  await (await import("node:fs/promises")).writeFile(
    indexPath,
    index.replace('./build/app.js', './app.js'),
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await buildStaticSite();
}
