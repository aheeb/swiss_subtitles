/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
 * This is especially useful for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  webpack: (config, { isServer }) => {
    /* — enable top‑level await used by @ffmpeg/ffmpeg — */
    config.experiments = { ...config.experiments, topLevelAwait: true };

    /* — bundle the ESM web‑worker from @ffmpeg/ffmpeg — */
    config.module.rules.push({
      test: /@ffmpeg\/ffmpeg\/dist\/esm\/worker\.js$/,
      use: [
        {
          loader: "worker-loader",
          options: {
            filename: "static/ffmpeg-[contenthash].worker.js",
            esModule: false,
          },
        },
      ],
    });

    /* — copy the WASM core so the worker can fetch it — */
    config.module.rules.push({
      test: /@ffmpeg\/core\/.*\.wasm$/,
      type: "asset/resource",
      generator: {
        filename: "static/wasm/[contenthash][ext]",
      },
    });

    /* — web‑workers run in self, not window — */
    if (!isServer) config.output.globalObject = "self";

    return config;
  },
};

export default config;
