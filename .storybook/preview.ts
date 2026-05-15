import type { Preview } from "@storybook/react";
import "../app/globals.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "dashboard",
      values: [
        { name: "dashboard", value: "#0a0c12" },
        { name: "paper",     value: "#f8fafc" },
      ],
    },
  },
};

export default preview;
