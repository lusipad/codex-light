import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { HotkeyWindow } from "./components/HotkeyWindow";
import "./styles.css";

function RootRouter() {
  const isHotkeyWindow =
    window.location.pathname.startsWith("/hotkey-window") ||
    window.location.hash.includes("hotkey-window");

  if (isHotkeyWindow) {
    return (
      <div
        style={{
          padding: "20px",
          height: "100vh",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        <HotkeyWindow
          onClose={() => {
            window.close();
          }}
          onOpenMainApp={(tid) => {
            window.location.href = tid ? `/#/local/${tid}` : "/";
          }}
        />
      </div>
    );
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootRouter />
  </React.StrictMode>
);
