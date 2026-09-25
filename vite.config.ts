import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// .env is loaded into process.env for the running server, but not before this
// config file is evaluated — and the host allow-list below is needed at config
// time. Loading it here explicitly is idempotent and safe if the file is absent.
try {
  process.loadEnvFile();
} catch {
  // No .env yet (fresh clone). Defaults below still give a working local server.
}

// Inbound webhooks (Unipile) and outbound media fetches (Buffer) arrive through
// a tunnel, so Vite has to accept that Host header or it answers 403 with a
// message only visible in the response body. Derived from PUBLIC_APP_URL so
// a new tunnel URL needs one edit in .env, not two files.
function tunnelHost(): string[] {
  const raw = process.env.PUBLIC_APP_URL?.trim();
  if (!raw) return [];
  try {
    return [new URL(raw).hostname];
  } catch {
    console.warn(`[vite.config] PUBLIC_APP_URL is not a valid URL: ${raw}`);
    return [];
  }
}

// Single source of truth for the dev/preview port: the APP_PORT env var,
// read here, in scripts/cron-tick.sh, scripts/install-cron.sh and the
// `tunnel` script in package.json, so all four always agree. Falls back to
// 5173 (the same default baked into .env.example and supabase/config.toml)
// when APP_PORT is unset, so a fresh clone still works with zero setup.
//
// supabase/config.toml's `site_url` / `additional_redirect_urls` cannot read
// this env var — the Supabase CLI only supports env() substitution for a
// fixed list of secret-like fields, site_url is not one of them — so that
// file hard-codes the same 5173 default and carries its own comment telling
// you to edit it by hand if you change APP_PORT. See that comment for why.
//
// strictPort makes a port clash an explicit failure instead of a silent move
// to another port, which would break PUBLIC_APP_URL and the OAuth/reset
// redirect allow-list without saying so.
function readAppPort(): number {
  const raw = process.env.APP_PORT?.trim();
  if (!raw) return 5173;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`[vite.config] APP_PORT is not a valid port number: ${raw}. Using 5173.`);
    return 5173;
  }
  return parsed;
}

const serverConfig = {
  port: readAppPort(),
  strictPort: true,
  allowedHosts: ["localhost", "127.0.0.1", ...tunnelHost()],
};

export default defineConfig(async ({ command }) => ({
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Hard error if server-only modules leak into the client bundle.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // Redirect TanStack Start's bundled server entry to src/server.ts (our
      // SSR error wrapper). nitro/vite builds from this.
      server: { entry: "server" },
    }),
    // Nitro packages the production server; not needed for the dev server.
    // Self-hosted, so the build targets a plain Node server rather than an
    // edge preset: `npm run build` produces .output/server/index.mjs, runnable
    // with `node .output/server/index.mjs`. Override with
    // NITRO_PRESET=cloudflare-module to build for Workers.
    //
    // noExternals: the node-server preset otherwise externalizes dependencies
    // and traces them with @vercel/nft, which the pinned nitro beta cannot
    // import — and a self-contained .output is what we want for self-hosting
    // anyway. This project has no native modules that would object.
    ...(command === "build"
      ? [
          (await import("nitro/vite")).nitro({
            preset: process.env.NITRO_PRESET || "node-server",
            noExternals: true,
          } as { preset?: string }),
        ]
      : []),
    viteReact(),
  ],
  server: serverConfig,
  preview: serverConfig,
}));
