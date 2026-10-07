import type { NextConfig } from "next";
const onVercel = process.env.VERCEL === "1";
const config: NextConfig = {
  output: onVercel ? undefined : "standalone",
  devIndicators: false,
  outputFileTracingExcludes: {
    "/api/*": [
      "**/AppData/Local/Temp",
      "**/AppData/Local/Temp/**",
      "/tmp",
      "/tmp/**",
      ...(onVercel
        ? [
            "./runtime/**",
            "./public/models/**",
            "./node_modules/@tensorflow/**",
            "./node_modules/@spotify/basic-pitch/**",
          ]
        : []),
    ],
  },
  outputFileTracingIncludes: {
    "/api/*": [
      "./node_modules/pdfkit/js/data/**/*",
      ...(!onVercel
        ? [
            "./runtime/transcription-worker.cjs",
            "./public/models/**/*",
            "./node_modules/@tensorflow/tfjs-backend-wasm/dist/*.wasm",
            "./node_modules/@spotify/basic-pitch/cjs/**/*",
            "./node_modules/@tensorflow/**/*",
          ]
        : []),
    ],
  },
  serverExternalPackages: [
    "firebase-admin",
    "@google-cloud/firestore",
    "@google-cloud/storage",
    "@google-cloud/tasks",
    "fluent-ffmpeg",
    "ffmpeg-static",
    "verovio",
    "pdfkit",
    "svg-to-pdfkit",
    "@tensorflow/tfjs",
    "@tensorflow/tfjs-backend-wasm",
    "@spotify/basic-pitch",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
