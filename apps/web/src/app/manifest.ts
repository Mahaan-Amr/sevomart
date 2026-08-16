import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "سوو",
    short_name: "Sevo",
    description: "پلتفرم فروشگاهی فارسی",
    start_url: "/",
    display: "standalone",
    background_color: "#F4F0F1",
    theme_color: "#A41439",
    lang: "fa",
    dir: "rtl",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
