import { StrictMode } from "react";                 // dev-only wrapper that flags common mistakes
import { createRoot } from "react-dom/client";      // React's entry point for the browser
import App from "./App.jsx";                        // the UI file I gave you

// Find <div id="root"> from index.html and render the app inside it
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);