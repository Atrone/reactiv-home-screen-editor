import type { Config } from "@react-router/dev/config";

export default {
  // Server rendering is required: the configuration loader and save action run on the server.
  ssr: true,
} satisfies Config;
