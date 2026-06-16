import App from "@medusajs/dashboard";
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

import plugin0 from "@medusajs/draft-order/admin"
import plugin1 from "medusa-plugin-wishlist/admin"

let root = null

if (!root) {
  root = ReactDOM.createRoot(document.getElementById("medusa"))
}


root.render(
  <React.StrictMode>
    <App plugins={[plugin0, plugin1]} />
  </React.StrictMode>
)


if (import.meta.hot) {
    import.meta.hot.accept()
}